# Contexto histórico informativo en LIVE

Fecha: 2026-10-15. Implementación independiente del motor de decisiones. No se asignó peso histórico nuevo, no se entrenó ML y no se crearon mappings automáticamente.

## Arquitectura

El GET existente de `/api/debug/live-goal-radar` conserva la secuencia de lectura del proveedor, `evaluateLiveGoalRadar(context)`, snapshot debug y programación híbrida existente. Después de evaluar añade **historicalContext como campo hermano de candidates**. No pasa perfiles al evaluador ni modifica candidate, totalScore, components, decision, reasons o blockers. El radar ya contenía un historicalScore previo: permanece intacto.

`liveContext.ts` lee exclusivamente PostgreSQL. Reutiliza el Historical Feature Builder mediante una variante de lectura conjunta: por equipo y venue obtiene hasta 20 fixtures una sola vez y calcula 5/10/20 con la misma agregación pura. Se conservó la API individual del builder.

Se generan 12 perfiles por fixture con mapping: local ALL y HOME, visitante ALL y AWAY, cada uno con ventanas 5/10/20. Con mapping válido son cuatro lecturas acotadas de perfiles (12 SQL con las dos relaciones en lote), una consulta de mappings y una de identidades: **14 SQL**, independientes del tamaño total del histórico. Sin mapping: una consulta y N/D. No hay N+1 por partido histórico.

Cache en memoria bajo demanda, máximo 128 entradas, TTL 120 segundos y clave por fixture, proveedor, estado, kickoff e IDs de equipos. Reutiliza promesas para consultas simultáneas de la misma clave. No crea timers, polling ni HTTP. Al reiniciar se vacía; no es un budget ni persistencia. Fallos de lectura devuelven N/D y no eliminan candidatos del radar. La latencia del cache hit se informa como 0; no es una medición de submilisegundos.

## Mapping y seguridad temporal

Solo `ProviderEntityMapping` de tipo TEAM, entre el proveedor LIVE (AllSportsApi/API-Football) y FOOTBALL_DATA, con método VERIFIED_PROVIDER_ID o EXACT_IDENTITY. Se aceptan ambas orientaciones y exactamente un destino. No se hace fuzzy matching, matching por nombre, inferencia de liga ni encadenamiento de proveedores. Un mismo destino para ambos equipos se rechaza. Los destinos deben existir realmente en Team.

El mapping debe existir antes del kickoff. Datos demo, kickoff desconocido/futuro, IDs ausentes, mapping ambiguo o destino ausente producen N/D. No se escriben mappings ni se consume presupuesto para resolverlos. Esta restricción implica que un mapping creado después del inicio será utilizable para siguientes partidos, no retrospectivamente para este.

El corte de todos los perfiles es **kickoff del fixture LIVE**, nunca la hora de consulta. Se reutilizan `kickoff < T`, filtros de recepción/actualización anterior a T y exclusión del mismo día cuando solo se conoce la fecha. El fixture actual y futuros no entran. El builder no reconstruye versiones anteriores a la recepción del backfill. Missing y denominador vacío permanecen NULL; las estadísticas requieren cobertura completa de su muestra.

Los perfiles abarcan la historia disponible de la identidad de equipo, sin filtro de competición adicional. La UI indica localía, muestra, último partido y cobertura para que no se confunda una muestra pequeña o antigua con evidencia actual.

## UI y comparación

Sección plegable **Contexto histórico**, una por fixture visible, separada de las tarjetas LIVE/ALERT y de REVISAR/HYBRID. Selector 5/10/20, columnas Local ALL/HOME y Visitante ALL/AWAY; muestra scoredRate, concededRate, O0.5/O1.5 1H, O0.5/O1.5/O2.5 FT, BTTS, promedios SOT/corners/yellow cards/fouls, rachas, sampleSize, fecha reciente y cobertura por grupo. Las rachas que alcanzan el límite de muestra indican mínimo. Sin mapping: HISTORICAL_CONTEXT = N/D.

Compara visualmente SOT acumulado LIVE ya calculado por el radar con la suma de promedios históricos de SOT por partido completo; advierte explícitamente que **no son ventanas temporales equivalentes**. No extrapola el minuto, no recalcula estadísticas LIVE y no transforma esta diferencia en una señal.

Las etiquetas se refieren a cada mercado O0.5 1H/FT y usan exclusivamente los perfiles HOME/AWAY de **10 partidos** (regla fija, explicada en UI aunque se inspeccione otra ventana):

- Ambos equipos con frecuencia histórica mayor de 50%: HISTÓRICO APOYA.
- Ambos con frecuencia menor de 50%: HISTÓRICO CONTRADICE.
- Frecuencias mixtas o igualdad: HISTÓRICO NEUTRO.
- Menos de 10 partidos o frecuencia NULL de cualquier equipo: N/D, nunca NEUTRO por ausencia.

Es una comparación descriptiva de mayorías históricas, **no probabilidad calibrada, score, señal ENTRY ni recomendación de apuesta**. Los umbrales existentes de BET_SCORE/ENTRY/ALERT no cambian. No hay conexiones de salida desde este campo hacia el motor.

## Validación real de solo lectura

Evidencia: `reports/live-historical-context-check.json`. Script `scripts/live-historical-context-check.cjs`, transacción READ ONLY y fetch bloqueado. No se invocó el endpoint del radar para evitar sus llamadas/sincronizaciones existentes.

| Medida | Resultado |
|---|---:|
| Filas con estado LIVE persistido en BD | 315 |
| Muestra inspeccionada, más recientes primero | 100 |
| Mappings TEAM con FOOTBALL_DATA en BD | 0 |
| Fixtures de la muestra con contexto disponible | 0 |
| Fixtures de la muestra sin mapping | 100 |
| Kickoffs de la muestra en las últimas 6 horas | 0 |
| Latencia añadida media sin mapping | 2.02 ms |
| p95 sin mapping | 3 ms |
| Máxima sin mapping | 8 ms |

Los 100 son **registros persistidos**, no partidos actuales verificados por el proveedor. La ventana de seis horas se usa solo para describir esta auditoría, no es un nuevo threshold del radar. No se inventó una captura LIVE con contexto. Latencia con mapping en tráfico real y valor predictivo/informativo real: **pendientes de medición**. Los casos con mapping se validaron con dobles de datos en memoria, sin persistir identidades artificiales.

| Tabla protegida | Antes | Después | Hash de contenido |
|---|---:|---:|---|
| LiveSnapshot | 4353 | 4353 | idéntico |
| LiveMarketSnapshot | 17 | 17 | idéntico |
| HybridScout | 47 | 47 | idéntico |
| ApiFootballBudget | 3 | 3 | idéntico |

Comparación dentro de la instantánea transaccional de la validación. No hubo escrituras de la funcionalidad ni de los tests en BD.

## Pruebas y build

**59/59 pruebas OK**, conjunto focalizado: team-profile, live-context, live-context-ui, radar-review-now y radar-hybrid-review. Incluyen mapping bidireccional, ambigüedad, mapping futuro, ausencia de mapping sin lectura de perfiles, fuente demo, error de BD aislado, cuatro lecturas acotadas, doce perfiles, entrada inmutable con BET_SCORE/ENTRY/ALERT, NULL y cobertura, clasificación descriptiva, UI N/D, ubicación del campo después del evaluador y regresiones existentes del radar. Las nueve pruebas del builder verifican corte temporal, fixture actual/futuro excluido, recepción posterior, localía y determinismo.

Compilación TypeScript histórica: OK. Build Next/Prisma generate: **OK, exit code 0**, evidencia en `reports/live-historical-build.log`. Sin schema nuevo, migraciones, materialized views ni escrituras de features.

De los 92 archivos del baseline protegido, únicamente cambiaron la ruta y el componente de presentación autorizados. El evaluador, BET_SCORE, ENTRY/NO_ENTRY, ALERT/NO ALERT, thresholds, lógica híbrida, budget y proveedores conservan sus hashes. El refresh existente sigue en 120 segundos; no se añadió una llamada de proveedor ni un proceso periódico.

Codebase Memory fue intentado primero y devolvió Transport closed. Se revisaron fragmentos locales de la ruta, componente, tipos de candidatos/MatchSummary, schema de mappings, helpers de identidad y builder histórico.

## Archivos

Modificados: `src/app/api/debug/live-goal-radar/route.ts`, `src/components/LiveGoalRadarMonitor.tsx`, `src/services/historical/teamProfile.ts` (lector compartido, agregación sin cambios).

Nuevos: `src/services/historical/liveContext.ts`, `src/components/HistoricalContextPanel.tsx`, `tests/historical/live-context.test.cjs`, `tests/historical/live-context-ui.test.cjs`, `scripts/live-historical-context-check.cjs`, este informe y evidencias JSON/logs.

La integración informativa queda implementada. Evaluar su utilidad en partidos actuales requiere primero mappings confiables y muestras reales; **no se recomienda darle peso en las decisiones en esta fase**.
