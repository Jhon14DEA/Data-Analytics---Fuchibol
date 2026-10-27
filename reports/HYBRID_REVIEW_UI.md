# HYBRID_ELIGIBLE, filtro y avisos de revisión — 2026-10-13

## Resultado

Implementados clasificación visual por mercado, filtro compartido de competición y elegibilidad, y notificaciones nativas de revisión. Ninguno de estos pasos llama a API-Football, encola scouts, consume budget o añade polling. La activación híbrida previamente existente queda intacta; esta clasificación nueva no está conectada al procesador.

Archivos de aplicación modificados/añadidos:

- `src/components/LiveGoalRadarMonitor.tsx`: estados de filtros, badges y conexión de notificaciones; reutiliza botón de permiso existente.
- `src/lib/radarHybridReview.ts`: clasificación pura, nombres de competición, opciones y proyección de filtros.
- `src/lib/radarReviewNotifications.ts`: deduplicación y adaptador Web Notifications.
- `tests/radar-hybrid-review.test.cjs`: 28 pruebas nuevas.
- `package.json`: comando `test:radar-hybrid-review`.

`radarReviewNow.ts` se reutiliza sin modificaciones. Las tarjetas inferiores y el manejador de alertas original no se modifican.

## Clasificación exacta

Función: `classifyHybridEligibility(candidate, live = true)` en `src/lib/radarHybridReview.ts`. Devuelve `{ state, missingCritical }`, sin mutaciones ni efectos externos. Se ejecuta por mercado; un mismo fixture puede tener distinto estado en 1H y FT.

Orden de evaluación:

1. No LIVE, score no confirmado 0-0: REVIEW_ONLY. También se utiliza para un mercado no soportado. No se introduce otra categoría.
2. SOT combinado ausente, no numérico/finito o <4: INSUFFICIENT_SOT. No convierte strings ni N/D a cero.
3. OVER05_1H fuera de 20–40 o OVER05_FT fuera de 45–75, extremos incluidos: OUTSIDE_TIME_WINDOW. Minuto ausente tampoco autoriza elegibilidad.
4. Dentro de ventana, SOT>=4 y algún dato crítico ausente: HYBRID_ELIGIBLE. Datos completos: HYBRID_NOT_NEEDED.

`combinedSot` sigue siendo `candidate.accumulated.shotsOnTarget`, ya calculado por el motor. Se leen xg, bigChances y shotsInsideBox del mismo objeto. Cero explícito es un dato válido; NULL/undefined/N/D/no finito/negativo se considera ausente, sin reemplazarlo.

Para momentum se reutiliza `candidate.recentDataStatus`, ya calculado por `recentProductionGate` con las ventanas y cobertura existentes. INSUFFICIENT_RECENT_DATA o estado ausente se considera sin cobertura útil, al igual que Recent Live score ausente. VALID_RECENT_DATA y RECENT_DEAD cuentan como observaciones: inactividad observada no equivale a datos faltantes. No se copian thresholds de cobertura ni se recalculan ventanas.

El motor actual entrega bigChances y shotsInsideBox acumulados como NULL; por tanto los casos reales dentro de ventana y SOT suficiente tenderán a ser elegibles. Esta fase hace visible ese faltante, sin obtener esos datos ni reinterpretarlos.

Badges: SOLO REVISAR, HÍBRIDO ELEGIBLE, HÍBRIDO NO NECESARIO, FUERA DE VENTANA y SOT INSUFICIENTE. La elegibilidad usa tono violeta y un texto que la separa de ALERT/ENTRY. Se conserva decisión original, motivo, scores, Data Quality y los mercados por tarjeta.

## Competición y filtros

`radarCompetition(match)` lee `payload.matches[].competition` (la ruta lo obtiene de `context.match.competition`); como fallback usa la competición del candidato y finalmente N/D. Solo recorta espacios de presentación, sin matching fuzzy.

`listRadarCompetitions` usa fixtures LIVE, elimina duplicados y ordena alfabéticamente en español. El select arranca en Todas las competiciones. Selección y toggle permanecen en `useState` mientras el componente esté montado, sin localStorage. Si desaparece una liga seleccionada, se conserva como opción deshabilitada «sin partidos LIVE»; no cambia la selección silenciosamente.

`filterRadarMatches` produce `visibleMatches`, compartido por REVISAR AHORA y el radar inferior. El toggle Solo HYBRID_ELIGIBLE muestra exclusivamente mercados elegibles; desactivado mantiene los mercados originales. No modifica payload ni parámetros de la petición. Los contadores globales de escaneo conservan su significado original.

## Notificaciones

Se reutiliza Web Notifications del radar y su botón explícito. Nunca se solicita permiso al cargar. `requestReviewNotificationPermission` llama a requestPermission solo cuando el permiso actual es default y el usuario pulsa el botón. Con denied se muestra el estado bloqueado y no se vuelve a solicitar. Granted y unsupported tienen estado visible.

`notifyHybridEligible` reutiliza `selectReviewNow` y la clasificación pura. Deduplica con `JSON.stringify([fixtureId, market])` en un Set de useRef, separado de las alertas existentes. Una notificación por fixture/mercado durante el montaje, incluso si sale de elegibilidad y vuelve. FT puede avisar una vez después de 1H. Recargar/remontar inicia una nueva visita. Denegar permiso no consume la clave: al concederlo puede avisar sobre candidatos actuales. Solo se registra envío después de construir la notificación; un fallo se contiene y puede reintentarse con un payload posterior.

Los avisos consideran todos los fixtures recibidos, independientemente del filtro visual. Cambiar filtros no repite ni dispara peticiones. El título es «FUT Analytics — Revisar partido» y el cuerpo incluye competición, equipos, minuto, SOT y mercado. No contiene una recomendación de apuesta. Las etiquetas de notificación tienen prefijo `hybrid-review:` para no reemplazar avisos antiguos del radar.

Click: enfoca la pestaña y desplaza/focaliza la tarjeta si está visible; si el filtro la oculta, focaliza REVISAR AHORA. Se queda en el radar montado, sin navegación, prefetch ni HTTP nuevo. No se intenta controlar la posición de la notificación del sistema operativo.

Pruebas del adaptador con Notification/window/document simulados; no se concedieron permisos ni se generaron avisos reales en el escritorio durante la validación. La presentación física depende del navegador y Windows.

## MCP, trazas e impacto

Se consultó Codebase Memory MCP antes de editar:

- get_architecture: dependencias, entry_points y layers.
- search_graph: página/componente, candidatos, notificaciones y funciones híbridas.
- get_code_snippet: RadarCandidate, handleAlertNotifications, isUsableRecentWindow.
- trace_path: callers/callees de LiveGoalRadarMonitor, selectReviewNow, runHybridBatch y reserveApiRequest.
- detect_changes: impacto bidireccional del diff global, que incluye trabajo previo y no debe confundirse con esta fase.
- check_index_coverage detectó metadatos viejos y archivos no indexados. index_repository en modo fast actualizó correctamente el grafo a 1847 nodos / 5620 relaciones antes de editar.

Cadena de UI: página -> LiveGoalRadarMonitor -> proyección de filtros -> REVISAR AHORA / tarjetas; payload -> efecto de notificación -> clasificación -> Notification. No hay enlace desde estos módulos a queue/procesador/budget.

Limitación MCP: sigue sin resolver como caller la llamada indirecta `run` cuyo valor por defecto es runHybridBatch; se validó el fragmento real de trigger.ts y la importación de la ruta. Budget tiene parse parcial de SQL tagged template. No se infirió ausencia de ejecución del procesador a partir de «0 callers».

Fragmentos abiertos: adjunto; LiveGoalRadarMonitor; radarReviewNow (selector completo, pequeño); página y ruta del radar; liveGoalRadar (tipos, cobertura/estado reciente); trigger híbrido; pruebas UI existentes; package.json. Los demás archivos protegidos se verificaron por hash, sin imprimir secretos ni abrir .env. Se consultaron logs de validación.

## Validación y controles

| Suite | Pasan |
|---|---:|
| Nuevas HYBRID review/filter/notifications | 28 |
| REVISAR AHORA existentes | 14 |
| Dataset unitarias | 32 |
| Híbridas unitarias | 17 |
| Dataset DB | 9 |
| Híbridas DB | 19 |
| Total | 119/119 |

Se cubren ventanas, 3/4 SOT, NULL/N/D, datos completos y cero observado, separación de markets, filtros únicos/ordenados, sincronización de ambas secciones con renderizado del monitor, permisos, deduplicación, reentrada, FT posterior, texto/click y contención de fallos. Inputs congelados y comprobaciones de dependencias verifican que la presentación no muta decisiones ni accede al presupuesto/cola. HTTP real a proveedores bloqueado en tests y build.

Prisma validate: OK. Generate: OK. Migrate status: cinco migraciones, esquema actualizado. La primera consulta de status falló con Docker apagado; tras arrancar el Docker local y PostgreSQL, pasó. No se generó ni aplicó ninguna migración nueva.

Build: OK (`reports/hybrid-review-build.txt`). Las suites DB corrieron en `fut_hybrid_review_test_20261013`, base temporal con copia solo del esquema, sin copiar datos reales; eliminada al terminar.

Integridad de UI (`reports/hybrid-review-ui-integrity.json`): un fetch antes/después, un setInterval antes/después; función refresh, handleAlertNotifications y RadarCard idénticas. Hashes del motor, reglas, proveedores, ruta, selector anterior, todo training y schema sin cambios.

Integridad DB (`reports/hybrid-review-db-integrity.json`): filas de presupuesto, contadores persistidos de sesión y cantidades de scouts/snapshots reales idénticos antes/después de pruebas.

Confirmación: BET_SCORE, ALERT/NO ALERT, ENTRY/NO_ENTRY y thresholds intactos. N/D != 0. Processor, queue, budget y polling no modificados. 0 requests adicionales a API-Football y 0 consumo adicional de budget por esta funcionalidad y su validación. No se ejecutó el endpoint del radar, no se inició un nuevo ciclo automático ni se hizo backtesting/ML.
