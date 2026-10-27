# Auditoría técnica de arquitectura y PostgreSQL — FUT

Fecha: 13 de octubre de 2026. Alcance: código actual y PostgreSQL local existente `fut_analytics_history`, PostgreSQL 16.15. **Solo auditoría y diseño; no se implementa histórico ni ML.**

## 1. Conclusión y método

**Conservar la PostgreSQL actual y evolucionar como monolito modular con procesos workers independientes.** La familia `Fixture` es la base operativa adecuada; no hace falta crear otra base ni duplicar fixtures para cada periodo o mercado. Antes del entrenamiento, la prioridad es corregir y versionar el contrato temporal, la normalización de odds y la clasificación de competiciones.

Hallazgos prioritarios:

1. La familia A no es completamente legacy: `/api/alerts/sync` sigue escribiendo `Match` y `Alert`, aunque ambas tablas están vacías en la base auditada. No eliminarla sin migrar esa dependencia.
2. Existe recolección real de familia B: 367 fixtures, 2.955 snapshots LIVE y 17 snapshots de mercado. Estos últimos pertenecen a **solo tres fixtures**, no a 17 partidos independientes.
3. Odds es ya el principal volumen: 580.321 filas y unos 240 MiB con índices. Hay problemas de timestamp, identidad del bookmaker LIVE, extracción de líneas y deduplicación temporal que impiden asumir una serie válida para pricing.
4. `LiveMarketSnapshot` es una buena base especializada, pero **no demuestra aún point-in-time estricto**: 3/17 confirmaciones híbridas son posteriores a `capturedAt`, hasta 11,482 segundos. No hay `availableAt`/timestamp propio de inserción en ese modelo.
5. No existe clasificación estructurada masculino senior ni estadísticas persistidas por 1T/2T/tramos. La base mezcla categorías y conserva estados LIVE antiguos.
6. No existe entrenamiento persistente, registro de modelos ni ledger de predicciones. Los scores/probabilidades del motor actual no son un feature store ni un modelo entrenado versionado.

### Evidencia y límites

- MCP primero: `get_architecture` (dependencies, entry_points, layers), `search_graph` sobre Prisma/persistencia/odds/dataset, y `trace_path` bidireccional de `persistMatchDetail`, `saveLiveSnapshot` y `persistLiveMarketSnapshot`. Se contrastó además `detect_changes(scope=impact,direction=both)`: incluye el trabajo previo no committeado y no representa cambios realizados por esta auditoría.
- Después se leyeron los bloques relevantes del schema, persistencia, normalizadores AllSports/API-Football, captura/features/outcomes/híbrido, alertas y consumidores. El schema se revisó por familias para cubrir los **21 modelos**, no solo los nombrados en la solicitud.
- SQL mediante Prisma en transacciones `READ ONLY`, con `RepeatableRead` en los bloques de inventario. Se comprobó `transaction_read_only=on`. Sin ejecutar métodos de providers ni endpoints de aplicación.
- Corte del inventario: **2026-10-13 15:32:16 UTC**. Las consultas posteriores de calidad pueden observar nuevas filas de la aplicación existente; se distinguen del inventario. Cada bloque es consistente dentro de su transacción, no un único snapshot global durante toda la auditoría.
- «Activo» significa ruta de código operativa y/o escritura observada en esta base. No se dispone de telemetría de un despliegue remoto para afirmar actividad productiva fuera de este entorno. Una tabla vacía no prueba código muerto.
- El grafo tiene límites con llamadas indirectas/Prisma y SQL tagged templates. Los resultados negativos de MCP se contrastaron con búsquedas y código. El nombre TypeScript `MatchDetail` o `OddsQuote` no implica uso de las tablas Prisma homónimas.
- Se consultaron únicamente documentos públicos de PostgreSQL para las recomendaciones de particionamiento/BRIN; **cero requests a API-Football o AllSports originados por la auditoría**.

### Referencias principales de código

| Ref. | Evidencia |
|---|---|
| S | `prisma/schema.prisma:10–487`: modelos, relaciones y constraints Prisma |
| P1 | `src/services/persistence/footballPersistence.ts:20–140`: syncFixture, persistMatchDetail, histórico bajo demanda y capturas |
| P2 | `footballPersistence.ts:142–216`: históricos locales; `:282–425`: lecturas, momentum y fixtures |
| P3 | `footballPersistence.ts:466–637`: stats, lineups, eventos, jugadores, odds e identidades |
| P4 | `footballPersistence.ts:668–744`: fixtureInclude y reconstrucción de MatchDetail |
| A | `src/providers/football/allSportsApi.ts:405–495`: getAnalysisContext e ingestión histórica; `:534–564`: odds/observación estricta; `:1162–1220` y `:1379`: normalizadores |
| F | `src/providers/football/apiFootball.ts`: getMatch, getPeriodFixtures, rawRequest y mappers |
| D | `src/services/training/liveMarketSnapshots.ts:15–148`: capturas/resolución; `:172`: trainingSummary |
| X | `src/services/training/features.ts:19–130`: elegibilidad, ventanas, hash y features |
| O | `src/services/training/observation.ts:66–139`: observaciones/recepción/odds de 1T |
| H | `src/services/training/hybrid/{policy,scout,processor,budget,activation,trigger,status}.ts` |
| L | `src/app/api/alerts/sync/route.ts:26–41`; `src/lib/pushNotifications.ts:23–55` |
| R | `src/app/api/debug/live-goal-radar/route.ts`; `src/components/LiveGoalRadarMonitor.tsx`; `src/services/analysis/liveGoalRadar.ts` |
| T | `src/app/api/analytics/training/over05-first-half/route.ts`; `scripts/dataset-status.cjs`; `src/services/training/monitoring.ts` |

## 2. Diagrama textual actual

```text
Navegador Next/React
  dashboard / partido / análisis / live-goal-radar
  └─ refrescos existentes, normalmente cada 120 s en el radar
      └─ rutas Next -> providers -> AllSports principal
          ├─ Fixtures / Livescore / detalle / odds / histórico bajo demanda
          ├─ persistMatchDetail
          │   ├─ League -> Fixture <- Team (home/away)
          │   ├─ TeamMatchStats                    [upsert: último estado]
          │   ├─ Player -> Lineup / PlayerMatchStats
          │   ├─ MatchEvent                       [upsert por hash]
          │   ├─ LiveSnapshot                     [observaciones LIVE/HT]
          │   ├─ Bookmaker -> OddsSnapshot        [dedup por valores/minuto]
          │   └─ observeLiveMarketDataset
          │       ├─ HybridScout                 [cola + mapping + último estado]
          │       ├─ LiveMarketSnapshot           [features OVER_0_5 FIRST_HALF]
          │       └─ resolutores HT / FT          [actualizan labels]
          └─ listados ya recibidos -> resolveObservedMarketResults

Ruta live-goal-radar -> after(response) -> scheduleHybridBatch
  └─ runHybridBatch
      ├─ lease/cache/mapping + presupuesto diario/sesión persistidos
      ├─ API-Football /fixtures [solo si corresponde, flag y cupos]
      └─ certificación periodo/outcomes -> captura híbrida

REVISAR AHORA / HYBRID_ELIGIBLE / filtros / Web Notifications
  └─ exclusivamente UI; sin conexión nueva al procesador o budget

Familia A, rama separada:
  /api/alerts/sync -> detectAlerts -> Match -> Alert
                                  └─ NotificationSubscription -> Web Push
  Match -> MatchSnapshot / OddsQuote / AnalysisPick [sin uso operativo encontrado]

Lectura dataset:
  endpoint analytics + dataset:status -> LiveMarketSnapshot + monitoreo/cola/budget

Una PostgreSQL compartida. No hay workers independientes ni cola genérica de jobs.
```

`persistMatchDetail` no engloba toda la ingestión en una única transacción: puede quedar un fixture actualizado antes de completar stats, odds o dataset. Hay transacciones específicas para reserva, deduplicación de odds y captura híbrida. Esto requiere contratos de reintento/idempotencia antes de escalar a workers.

## 3. Inventario completo y estado ACTIVE / PARTIAL / LEGACY / UNKNOWN

Definiciones: ACTIVE = camino operativo con datos observados; PARTIAL = uso condicional, cobertura incompleta o ausencia de datos pese a implementación; LEGACY = sin escritor/consumidor funcional encontrado en este repositorio y vacío; UNKNOWN = actividad externa no verificable. Los posibles procesos externos quedan UNKNOWN, no se infiere su ausencia. El inventario contiene **14 ACTIVE, 4 PARTIAL y 3 potencialmente LEGACY** bajo estas definiciones.

En volumen esperado, F = fixtures recogidos; Q = combinaciones de bookmaker/mercado/selección/línea; O = observaciones por combinación. No son compromisos de cuota API.

| Modelo / filas al corte | Estado | Propósito real y relaciones | Escritor concreto | Lectores reales | Crecimiento / límites |
|---|---|---|---|---|---|
| **Match — 0** | PARTIAL | Padre de la familia A, identidad externa única sin namespace provider separado; FK para alertas | `/api/alerts/sync`, upsert solo si detecta alertas de actividad | Ese upsert consulta identidad; no lector de UI de esta tabla encontrado | Hasta un registro por partido que produzca alertas; no inventario general |
| **MatchSnapshot — 0** | LEGACY potencial | Stats antiguas por Match/capturedAt, muchos campos obligatorios | Ninguno encontrado en src/scripts | Solo auditorías de conteo; `getPreviousLiveStats` usa LiveSnapshot, no esta tabla | Si se reactivara: Match × capturas. No reutilizar sus ceros para imputar ausencias |
| **OddsQuote — 0** | LEGACY potencial | Cuota por Match, bookmaker texto, sin columna line | Ninguno encontrado | Ninguno funcional; el tipo TS OddsQuote alimenta **OddsSnapshot** | No crece actualmente |
| **AnalysisPick — 0** | LEGACY potencial | Recomendación con confidence/clasificación/reasons; no prediction ML | Ninguno encontrado | Ninguno funcional; análisis actuales se calculan en memoria | No crece; no sustituye ModelVersion/Prediction |
| **Alert — 0** | PARTIAL | Evento deduplicado por fingerprint; FK Match | `/api/alerts/sync` create | Dedupe por constraint; el envío push usa alertas en memoria, no un SELECT histórico de Alert | Una fila por fingerprint; endpoint vigente aunque no observado en esta DB |
| **NotificationSubscription — 0** | PARTIAL | Suscripción Web Push con endpoint/keys; independiente del partido | `savePushSubscription`, endpoint subscribe | `notifyNewLiveAlerts`; elimina endpoints 404/410 | Una por suscripción. No almacena los avisos nativos HYBRID_ELIGIBLE |
| **League — 84** | ACTIVE | Competición provider-specific; padre Fixture | `upsertLeague` desde syncFixture | joins en histórico, fixtureInclude, UI/debug/análisis | Catálogo acotado; country/season existen pero ambos tienen 0 valores |
| **Team — 393** | ACTIVE | Equipo provider-specific; home/away en Fixture, stats/lineups/player | `upsertTeam` | histórico por equipo, mappings internos, joins | Catálogo creciente; fallback de ID por slug puede colisionar |
| **Player — 1.366** | ACTIVE | Jugador y equipo actual; relaciones Lineup/PlayerMatchStats | `upsertPlayer` por lineups/stats | reconstrucción de lineups/playerStats | Actual writer usa fallback teamId+slug(nombre); traspasos pueden duplicar identidad |
| **Fixture — 367** | ACTIVE | Agregado central con resultado/status actual, IDs de liga/local/visitante | syncFixture, reconciliación de desaparecidos | providers/histórico, páginas/debug, momentum, dataset, análisis y servicio de backtest existente | O(F), unique(provider,externalId). No es registro de revisiones de resultados |
| **TeamMatchStats — 734** | ACTIVE | Dos filas por fixture, último acumulado recibido | saveTeamStats upsert(fixtureId,teamId) | mapFixtureRecord, histórico y análisis | ~2F; se sobrescribe, sin periodo ni as-of |
| **PlayerMatchStats — 0** | PARTIAL | Stats de jugador/fixture, columnas amplias | savePlayerMatchStats, condicionado a playerStats del proveedor | fixtureInclude/mapFixtureRecord/análisis de jugadores | O(jugadores × F); código existente, ninguna fila observada |
| **Lineup — 2.441** | ACTIVE | Alineación por fixture/team/player | saveLineups upsert | fixtureInclude -> UI/análisis de alineaciones | Decenas/F; writer guarda starter=true para todos los elementos suministrados; no versiona cambios |
| **MatchEvent — 2.810** | ACTIVE | Goles/tarjetas/cambios, FK fixture/team, dedup por sourceHash | saveEvents | mapFixtureRecord, timelines, momentum, estadísticas por tramo derivadas | Eventos/F; 837 goles, 734 tarjetas, 1.239 cambios. providerEventId no poblado |
| **LiveSnapshot — 2.955** | ACTIVE | Estado LIVE/HT por fixture; métricas nullable, score obligatorio | saveLiveSnapshot | getPreviousLiveStats, trends/momentum/coverage/freshness; dataset enlaza FK; backtest existente lo lee | O(F × capturas), unique(fixtureId,sourceHash). 183 fixtures cubiertos |
| **HybridScout — 28** | ACTIVE | Cola de periodo, último payload normalizado y mapping AllSports↔API | recordHybridScout, invalidateHybridEvidence, processor | processor, validación de captura, outcomes/status | Máximo una fila por Fixture; IDs de ambos providers únicos. 4 mappings; 17 cerrados y 11 pendientes al corte |
| **ApiFootballBudget — 3** | ACTIVE | Contadores diarios y límite remoto conocido | reserveApiRequest/reconcileApiBudget | processor y status | Una fila/día UTC; contador de reservas, no ledger completo por petición |
| **HybridApiCache — 60** | ACTIVE | JSON heterogéneo: directorios, lease, admisiones, sesión, dedup de telemetría | processor/budget/activation | mismos módulos/status | 51 telemetry, 1 lease, 1 sesión, 4 admissions, 3 directory en consulta posterior; no política general de purga encontrada |
| **LiveMarketSnapshot — 17** | ACTIVE | Features de decisión especializadas + labels posteriores, FK Fixture y LiveSnapshot | persistLiveMarketSnapshot; resolutores actualizan solo outcomes | trainingSummary, monitoring, histórico de ventanas del propio dataset, API analytics, CLI | O(fixtures elegibles × capturas); actualmente 3 fixtures, un único mercado 1T |
| **Bookmaker — 11** | ACTIVE | Catálogo por nombre único, padre OddsSnapshot | saveSingleOddSnapshot upsert(nombre) | joins de odds y reconstrucción MatchDetail | Catálogo pequeño; no provider ID; el LIVE agregado no identifica necesariamente una casa real |
| **OddsSnapshot — 580.321** | ACTIVE | Observaciones de cuota por Fixture/Bookmaker | saveOddsSnapshot -> saveSingleOddSnapshot | fixtureInclude, getTodaysBettableFixtures, freshness, oddsHistory y análisis | O(F×Q×O); hoy domina tamaño. Sin revisión/event ID ni fase explícita |

### Relaciones y riesgos de identidad

- Familia A y B no tienen una FK que las unifique. `Match.externalId` suele recibir el ID de dominio prefijado; `Fixture` usa provider y externalId separados. No unir solo por texto de equipos.
- `League`, `Team`, `Player`, `Fixture` tienen unique(provider,externalId): permiten varias representaciones del mismo objeto deportivo entre proveedores. HybridScout resuelve una asociación concreta de fixtures, no es un catálogo universal de IDs.
- `HybridScout.liveSnapshotId` es un string opcional, sin FK declarada. `LiveMarketSnapshot.liveSnapshotId` sí tiene FK. No asumir las mismas garantías en ambas.
- Borrar Fixture cascada hacia stats, eventos, snapshots, odds y scout. Borrar LiveSnapshot cascada hacia LiveMarketSnapshot. Una política de retención ingenua podría borrar features **y labels**.

## 4. Duplicidad entre familias A y B

**Ambas siguen alcanzables desde código**, pero solo B tiene datos en el corte auditado. La rama de alertas puede poblar A en el futuro sin cambiar el schema. El GET de sync primero usa el provider, que puede persistir B, y luego escribe Match/Alert: existe duplicidad potencial del partido dentro de un mismo flujo.

No se encontró uso funcional de MatchSnapshot/OddsQuote/AnalysisPick en src/scripts; son candidatos fuertes a deprecación. Los nombres similares en tipos de dominio no son evidencia de escritura Prisma. Tampoco hay que confundir `matchAlertRegistry.ts`, que usa estado en memoria, con persistencia en Alert.

**No es seguro eliminar A hoy.** Para deprecar en otra fase: inventariar consumidores externos/jobs del endpoint, mover la referencia de Alert a Fixture mediante mapping explícito, preservar fingerprint y comportamiento push, migrar cualquier dato que aparezca, mantener compatibilidad temporal y observar ausencia de usos. Solo después evaluar retirar las tablas no usadas. No hace falta duplicar datos B ni reiniciar PostgreSQL.

## 5. Cobertura actual de necesidades históricas y ML

Los estados siguientes describen capacidad útil, no solo presencia de una columna.

| Bloque / dato | Estado | Evidencia y limitación |
|---|---|---|
| Competición/equipos/fixture/local-visitante | YA EXISTE | League/Team/Fixture, FK y IDs por provider; falta identidad canónica multifuente general |
| Temporada | PARCIAL | League.season vacío; Fixture.season lleno con `kickoff.getFullYear()`, no temporada oficial tipo 2025/26 |
| Resultado actual/FT | PARCIAL | Fixture.homeScore/awayScore/status y outcomes finales del dataset; sin revisiones/confianza de resultado universal |
| Venue/round/país | PARCIAL | Columnas existen. Venue/round 0/367; country 0/84 en League. Normalizadores descartan metadata disponible |
| Goles, tiros, SOT, corners, tarjetas, faltas, posesión, ataques/peligrosos | PARCIAL | TeamMatchStats soporta todas; cobertura irregular, último acumulado. SOT 610/734, faltas/posesión 212/734, ataques peligrosos 602/734 en consulta posterior |
| xG | PARCIAL | Columnas/mappers existen, pero xG 0/734 TeamMatchStats, 0 homeXg LiveSnapshot y 0/17 totalXg dataset |
| Big chances / tiros en área | PARCIAL | Dataset los admite: 0/17 big chances y 12/17 tiros en área combinados. No columnas equivalentes en TeamMatchStats/LiveSnapshot |
| Stats 1T/2T/FT por periodo | FALTA | TeamMatchStats no tiene dimension periodo. FT solo puede ser el último estado si efectivamente se recogió el final |
| Tramos 0–15 / 16–30 / 31–45+ / 46–60 / 61–75 / 76–90+ | PARCIAL | `periodForMinute`/`hasGoalInPeriod` derivan frecuencia de goles de eventos en memoria; no tabla de stats por tramo ni prueba de cobertura completa |
| Minuto/marcador LIVE | YA EXISTE | LiveSnapshot/Fixture; en el dataset se exige confirmación; el modelo general no conserva esa evidencia |
| Ventanas 5/10/15 | PARCIAL | Momentum sobre LiveSnapshot y deltas en LiveMarketSnapshot. Dataset: SOT last5=2/17, last10=1/17, last15=0/17 |
| Roja/eventos/sustituciones | PARCIAL | Rojas en stats; eventos goal/card/substitution. Sin period/extraTime/event revisions robustos; providerEventId vacío |
| Bookmaker/mercado/selección/línea/cuota/minuto/timestamp | PARCIAL | OddsSnapshot contiene columnas, pero identidad LIVE, línea y reloj requieren corrección; no fase/suspensión/origen/observedAt uniforme |
| Apertura/prematch/live/closing | PARCIAL | Algunas cuotas y minuto; no cobertura programada ni definición de apertura/cierre, no phase registrada |
| Resultado de mercado HT/FT | PARCIAL | Labels de goalBeforeHt/goalBeforeFt y marcador FT del dataset específico. No settlement genérico por selección/línea ni void/push/medias ganancias |
| Features point-in-time | PARCIAL | LiveMarketSnapshot es un subconjunto útil; falta disponibilidad estricta, lineage/versiones y soporte de múltiples mercados |
| Model version / entrenamiento | FALTA | No modelo Prisma ni proceso de entrenamiento/registro |
| Probability / edge | PARCIAL | Cálculos en servicios de análisis/probabilityEstimators; no predicciones persistidas vinculadas a modelo/versión/cuota |
| Prediction timestamp / outcome de cada predicción | FALTA | No ledger Prediction; los labels existentes pertenecen al snapshot 1T, no a una predicción genérica |
| Dataset version / feature set / train split | FALTA | `dataQualityDetails.version=1` no constituye versión reproducible de dataset ni feature builder |

Hay un servicio de backtest y endpoints debug en el repositorio, pero **no se ejecutaron**. No son entrenamiento ML ni garantizan por sí solos disponibilidad temporal de cada dato histórico. `syncHistoricalTeamData` existe como helper; el flujo vivo encontrado de AllSports ingiere histórico desde getAnalysisContext bajo demanda. No existe un recolector histórico completo por liga/temporada con checkpoint independiente.

## 6. LiveMarketSnapshot como base point-in-time

### Qué hace correctamente

- Captura observaciones numéricas reales, fresh <=180 s, marcador confirmado 0-0 y FIRST_HALF con evidencia confirmada; rechaza demo y periodo desconocido. AllSports numérico por sí solo no confirma 1T.
- Vincula Fixture y LiveSnapshot, verifica proveedor/fixture y, en híbrido, revalida certificado persistido con bloqueo de fila antes de insertar.
- `capturedAt=observation.observedAt`; conserva provenance de periodo/stats/odds y detalle de faltantes frente a ceros observados.
- Ventanas consultan solo snapshots del mismo fixture/mercado anteriores a capturedAt y en los últimos 20 minutos. No extrapolan ni convierten gaps/resets a cero.
- El selector de odds del dataset exige mercado 1T correcto y timestamp no futuro, con antigüedad <=180 s. No sustituye cuota FT.
- Los resolutores HT/FT requieren evidencia del periodo y timestamp posterior; no sobreescriben labels ya resueltos en la operación normal.

### Por qué aún no es un PIT estricto universal

1. **Disponibilidad posterior a capturedAt, observada:** 3 de 17 filas tienen `dataQualityDetails.hybridEvidence.observedAt > capturedAt`; diferencia máxima 11,482 s. `hybridObservation` admite certificación hasta 30 s posterior al recibo AllSports. Es razonable para alineación de ingesta, pero esa evidencia no estaba disponible en el instante original. No afirmar que un sistema habría podido seleccionar ese caso exactamente a capturedAt.
2. **Falta un reloj de disponibilidad/inserción:** no hay createdAt/ingestedAt propio en LiveMarketSnapshot. CapturedAt es recibo de estadísticas, no necesariamente momento de cálculo o publicación. Un backfill futuro también necesitará distinguir evento, recepción y disponibilidad de features.
3. **Labels mutables en la misma fila:** goalBeforeHt, goalBeforeFt, finalHomeScore, finalAwayScore, htResolvedAt, ftResolvedAt, resultResolvedAt se completan después. `trainingSummary(limit)` puede devolver filas completas. Exportar `SELECT *` para entrenar sería una fuente directa de leakage.
4. **Joins a tablas actuales:** TeamMatchStats, Fixture, Lineup y Player se actualizan. Reconstruir features pasadas con sus valores actuales puede inyectar estadísticas finales/alineaciones corregidas. `getLocalAnalysisHistory` ordena fixtures FINISHED pero no impone cutoff anterior al fixture objetivo; no es una API as-of para entrenamiento.
5. **Sesgo de selección:** solo OVER_0_5 FIRST_HALF, LIVE 0-0 confirmado, observaciones disponibles y prioridades/cupos híbridos. No representa todos los partidos ni todos los mercados. Deben registrarse población, elegibilidad y missingness; no extrapolar resultados a FT o a todas las ligas.
6. **Muestra mínima:** 17 filas de 3 fixtures, todas con HT/FT label; no evidencia suficiente para entrenar ni para medir ventaja de pricing, y todas sin cuota de mercado.

### Separación futura de features y labels

Crear una proyección/exportador con allowlist explícita de features y un label separado por mercado. Excluir resultados futuros, timestamps de resolución, flags «resolved» y cualquier derivado posterior. Mantener identificadores para joins/splits, no introducir IDs/hash como señal predictiva. Usar `availableAt <= decisionAt` por cada fuente, no solo `eventAt <= decisionAt`.

La feature row futura debería registrar al menos observedAt, availableAt, computedAt/ingestedAt, featureSetVersion y manifest de fuentes. Para una captura híbrida, decisionAt no puede anteceder al máximo timestamp de disponibilidad de stats/certificado/odds usados. **No reescribir capturedAt ni inventar tiempos históricos ahora.** Las filas existentes se etiquetarían por calidad temporal antes de una exportación.

Separar folds por fixture y cronológicamente; todas las observaciones/mercados del mismo fixture deben pertenecer a un único fold. Validar madurez de labels, revisiones de resultados y ausencia de partidos futuros en históricos. Missing outcome sigue NULL; no equivale a pérdida ni a 0.

### Hash y reproducibilidad

`snapshotSourceHash` incluye fixture provider ID, bucket temporal, periodo/minuto/añadido/score/stats y precio/bookmaker. Canonicaliza claves JSON en observaciones híbridas. Es idempotencia útil, **no identidad completa del cálculo**: no incluye versión del builder, manifest de históricos, oddsQuotedAt ni todo el certificado/provenance. Ventanas dependen de historia disponible y refreshSeconds; el hash no fija toda esa entrada. Un mismo input futbolístico puede producir features distintas si cambia historia/código. No existen raw payloads inmutables completos que permitan reproducir todo.

### Índices y constraints

Los índices (matchId,capturedAt), liveSnapshotId y providerFixtureId sirven para trayectorias/joins. Los compuestos actuales priorizan HT label/minuto y dataQuality/capturedAt; no cubren de forma ideal un export temporal global sin filtro de calidad. Evaluar con planes reales un índice (marketType,marketPeriod,capturedAt,matchId) y parciales de outcomes pendientes; no añadirlos por duplicado automáticamente.

PostgreSQL contiene además CHECKs no evidentes mirando solo los defaults: marketType=OVER_0_5, marketPeriod=FIRST_HALF, 0-0, goalsNeeded=1 y minuto 0..45; calidad/cobertura 0..100; resultResolvedAt requiere labels HT/FT y marcador final. El código de captura restringe minuto 1..45. **Cambiar defaults no habilitaría FT**: una generalización requeriría diseño explícito de constraints y consumidores. No se modifica nada ahora.

## 7. Clasificación masculino senior

**Hoy no hay información persistida suficiente para una separación confiable.** League solo tiene provider/externalId/name/country/season; Team tampoco guarda género, edad o nivel de plantilla. No hay campos gender/ageCategory/squadLevel/isFriendly en el modelo.

Los tipos AllSports usados incluyen country_name, league_key/name, pero no clasificación estructurada de género/edad/reservas. El mapper/persistencia no guarda ni siquiera country_name en League.country. No se afirma que la API completa carezca de metadata: solo que el flujo inspeccionado no la conserva.

En los directorios API-Football **ya almacenados**, las claves de league son id, name, country, season, round, standings, logo, flag; no apareció metadata estructurada gender/age en ese bloque. Hay temporada/país/round aprovechables sin basarse en nombres. El caché es temporal, no una dimensión histórica de competición.

Nombres observados: `Friendlies Women - Group Stage`, `Liga Revelacao U23`, `U19 league`, `Reserve League - Clausura`, `Cup U20 - 1/16-finals`, entre otros. Esto evidencia que no existe un alcance homogéneo senior masculino; **no se propone usar esos regex como clasificador definitivo**.

Lugar propuesto: atributos normalizados en League/CompetitionSeason, con sourceProvider, sourceReference, confidence/status, verifiedAt y vigencia; Team puede necesitar ageCategory/squadLevel para reservas o equipos juveniles dentro de calendarios compartidos. Separar ejes: género, categoría de edad, primer equipo/reserva y tipo de competición. «Amistoso» no implica femenino ni juvenil.

Preferir metadata estructurada de catálogo; si no existe, una allowlist de provider league IDs revisada y versionada, no inferencia agresiva por nombre. Mantener UNKNOWN y excluirlo de la recolección especializada hasta verificación. Preservar datos ya recogidos; el alcance futuro no autoriza borrarlos. Para amistosos masculinos senior definir una decisión de producto independiente (incluir/excluir), no confundirla con edad/género.

## 8. Históricos por periodos sin duplicar Fixture

TeamMatchStats guarda **último acumulado recibido**, no necesariamente FT confirmado. Su unique(fixtureId,teamId) impide coexistencia de filas 1T/2T y no hay campo period. El refresco reemplaza métricas anteriores; no existe una serie histórica de esta tabla.

LiveSnapshot conserva estados acumulados con timestamp/minuto, pero no periodo confirmado/stoppage estructurado/provenance de score. Con muestreo incompleto no se puede derivar de forma exacta 1T, 2T ni intervalos fijos. Las ventanas móviles 5/10/15 y el dataset 1T son conceptos distintos de tramos oficiales de 15 minutos.

MatchEvent permite derivar conteos de goles/tarjetas/cambios si existe cobertura suficiente, pero carece de periodo explícito, segundo/addedTime y estado de revisión. `parseMinute` toma el primer número; no garantiza semántica de 45+2 frente a minuto 47. Ausencia de eventos tampoco demuestra cero goles en un tramo.

Solución mínima futura: mantener Fixture y TeamMatchStats como proyección actual, añadir **TeamPeriodStats** asociado a fixtureId/teamId/provider, con periodKey (FIRST_HALF/SECOND_HALF/FULL_TIME/intervalo), límites, métricas nullable, source/observedAt/availableAt, cobertura y tipo de derivación. Para correcciones conservar revision/version o historial de observaciones; unique debe identificar periodo y revisión, no volver a sobrescribir toda la historia. No calcular 2T=FT−HT si falta un término o si los acumulados son incompatibles/corregidos.

Añadir resultado por periodo separado (**FixturePeriodResult**) preservaría score HT/FT explícito, provider, estado de confirmación y revisiones para todos los fixtures, no solo aquellos con LiveMarketSnapshot. Los labels de un mercado se derivarían de esa evidencia y de una política de settlement versionada.

## 9. Odds y bookmaker

### Tabla a continuar

**OddsSnapshot**, por su FK a Fixture/Bookmaker, su uso real y la columna line. OddsQuote está vacía, no se escribe y pertenece a una familia secundaria. No transportar cientos de miles de filas a OddsQuote.

### Problemas observados que preceden al pricing/ML

1. **Reloj:** en una consulta posterior al inventario, 575.199 filas tenían timestamp más de cinco minutos después de createdAt. La mediana global timestamp−createdAt fue 24.949 s (~6 h 56 min), p95 25.173 s (~6 h 59 min). La anomalía está observada; su causa exacta requiere validar zona/proveedor/host, no asumir un offset fijo para reparar todo.
2. **Normalización dispar:** OddsLive se pide con America/Bogota; la ruta general llama a `parseAllSportsDate`, que usa `new Date` sin fijar offset cuando el texto no lo trae. La rama estricta del dataset sí añade -05:00 a un formato conocido. Por tanto, no tienen el mismo contrato temporal. En prematch `mapOdds` usa hora de ingesta como quotedAt; no es hora real de apertura.
3. **Bookmaker LIVE agregado:** `mapLiveOdds` fija `AllSportsApi Live` como bookmaker. Es un proveedor/agregado, no prueba de una casa concreta. La mayor parte de las filas provienen de esa identidad genérica; no sirven directamente para comparar closing line por bookmaker real.
4. **Línea extraída del texto:** `extractLine` toma el primer número de market+selection. Se observaron `1x2 (1st Half)` con line=1, `3-Way Handicap` con line=3 y `Asian Handicap (1st Half)` con line=1. Son números del nombre, no evidencia de handicap real. Asian Handicap Home/Away también aparece con line NULL. Normalizar a futuro desde los campos estructurados y conservar el raw market/selection/line.
5. **Suspensiones omitidas:** se filtran cuotas suspendidas al mapear; no queda una transición suspendido/reabierto ni intervalo de ausencia. Esto sesga una reconstrucción de disponibilidad de precio.
6. **Carga excesiva en lecturas:** fixtureInclude carga todas las odds de cada fixture y mapFixtureRecord las asigna tanto a odds como a oddsHistory. Hay un fixture con >28.000 filas de odds. Un límite a la consulta de fixtures no limita las relaciones hijas; riesgo de latencia/memoria/N+1 de ingestión antes de requerir particiones.

### Frecuencia y restricción unique

No existe odds-collector independiente ni calendario de apertura/cierre. La frecuencia real depende de visitas, refrescos, caché y vida del proceso. El minuto se toma del estado del partido asociado al fetch, no necesariamente del instante de la cuota.

Unique actual: **(fixtureId,bookmakerId,market,selection,line,odds,minute)**. No incluye timestamp. Además, el writer toma advisory lock y hace findFirst por la misma tupla antes de crear, **incluso si line/minute son NULL**. No basta estudiar únicamente el comportamiento SQL de NULL en UNIQUE.

Consecuencias: cotización sin cambios en otro timestamp se pierde; con minute=NULL se pierde un regreso a una cuota histórica durante prematch; secuencia A→B→A dentro del mismo minuto puede perder el segundo A. El cambio de precio puede conservarse, pero no se conservan todos los cambios ni cada observación. El timestamp posterior no rescata una tupla descartada.

**timestamp + minute no bastan:** faltan reloj de disponibilidad, fase prematch/live, periodo/addedTime, identificación real de bookmaker, mercado/selección/línea canónicos, estado suspendido, fuente y revisión/ID de quote. Apertura = primera observación válida cubierta, no necesariamente apertura real; closing = última cuota válida antes del cutoff definido, no última fila global ni una cuota LIVE.

Diseño siguiente: una serie append-only normalizada con dedup por provider quote/event ID o por batch+sourceHash+observedAt; permitir reaparición de precio. Mantener eventAt/providerUpdatedAt y receivedAt/availableAt separados. Calcular apertura/cierre como vistas derivadas con cobertura y reglas versionadas. No se cambian constraints ni datos en esta auditoría.

## 10. Volumen y escalabilidad

### Estado medido

- OddsSnapshot: **251.510.784 bytes (~240 MiB)** con índices, 580.321 filas en el inventario y 171 fixtures con odds. Es aproximadamente dos órdenes de magnitud mayor que las otras tablas de captura.
- LiveSnapshot: ~1,44 MiB con índices, 2.955 filas; fila heap promedio posterior ~201 bytes.
- LiveMarketSnapshot: ~280 KiB con índices, 17 filas; fila promedio ~1.720 bytes por columnas/JSON. A esta escala los tamaños físicos no extrapolan con precisión.
- MatchEvent: ~1,43 MiB, 2.810 filas. HybridApiCache: ~352 KiB al corte.
- 58 fixtures todavía LIVE tenían kickoff hace más de un día en consulta posterior. El cierre/reconcile depende del flujo atendido; no dar por finalizado el inventario de partidos sin resolverlos.

### Escenario de planificación, no tráfico solicitado ni backtest

Supuesto ilustrativo: 10.000 fixtures/temporada, captura cada 2 min durante 90 min (~45 puntos), 5 bookmakers ×20 combinaciones mercado/selección/línea ×60 observaciones. No incluye límites ni disponibilidad contractual de providers.

| Tabla | Orden estimado por temporada | Principal multiplicador |
|---|---:|---|
| LiveSnapshot | ~450.000 | F×45; más con añadido/HT y cambios dentro del bucket |
| LiveMarketSnapshot actual | ~75.000 si 50% elegibles ×15 puntos | Depende fuertemente del 0-0/cobertura/cupos; no se garantiza |
| Features futuras para múltiples mercados | ~450.000×M mercados | Evitar duplicar métricas base en cada mercado si pueden referenciarse |
| OddsSnapshot | ~60.000.000 | F×5×20×60; domina almacenamiento/escrituras |
| MatchEvent | ~500.000 si 50 eventos/F | Depende de granularidad; aquí no son todos los eventos de tracking |
| TeamPeriodStats | ~180.000 para 9 periodos×2 equipos | Más si conserva revisiones |

Usando solo la huella media actual de odds (~433 bytes/fila con índices), 60 M filas serían ~26 GB; esquema ampliado, índices, JSON y bloat pueden elevarlo mucho. WAL, backups, staging y replicación requieren presupuesto adicional. Es una estimación de capacidad, no medición futura.

### Medidas mínimas recomendadas

1. **Primero lecturas acotadas e ingestión por lotes:** no cargar oddsHistory completo para todas las pantallas, seleccionar último precio por clave y paginar la serie. Reducir transacciones por cuota cuando se extraiga el collector; mantener idempotencia.
2. **Índices a evaluar con EXPLAIN y cargas representativas:** Fixture(leagueId,kickoff) y seasonId/kickoff futuro; MatchEvent(fixtureId,minute); export temporal de LiveMarketSnapshot; outcomes pendientes con índices parciales; OddsSnapshot con la clave canónica de cotización y receivedAt. No duplicar índices ya cubiertos.
3. **Particionamiento futuro:** candidato principal OddsSnapshot por fecha de recepción/observación normalizada, luego LiveSnapshot/feature facts si el volumen lo justifica. No particionar hoy por cada liga o fixture. Por temporada requiere una dimensión fiable y complica temporadas solapadas. PostgreSQL 16 exige que PK/UNIQUE de una tabla particionada incluyan todas las columnas de partición; el diseño actual de IDs/uniques/FKs no se convierte sin planificación. [Documentación PostgreSQL 16](https://www.postgresql.org/docs/16/ddl-partitioning.html).
4. **BRIN condicional:** considerar índices de fecha compactos cuando el orden físico esté correlacionado con el tiempo, no como reemplazo de B-tree para la consulta puntual de un fixture. Backfills desordenados y clocks corruptos reducen esa ventaja. [BRIN PostgreSQL 16](https://www.postgresql.org/docs/16/brin-intro.html).
5. **Retención:** definir antes de purgar; ejemplo a evaluar: temporada en curso caliente y temporadas cerradas en almacenamiento comprimido verificable. Preservar fuentes de datasets/modelos y revisiones. Con las cascadas actuales no eliminar LiveSnapshot o Fixture sin proteger/referenciar los snapshots de mercado dependientes.
6. **Compresión/agregados:** exportaciones analíticas inmutables comprimidas, manifests/checksums y agregados derivados; no requieren otra PostgreSQL transaccional. No reducir odds a OHLC si se necesitan transiciones/suspensiones exactas. Medir autovacuum y bloat de las tablas actualizadas.
7. **Workers con límites independientes:** pools de conexión y concurrencia pequeños, backpressure, prioridades para LIVE/outcomes, jobs idempotentes, reintentos con backoff/checkpoints; dataset/training no deben competir sin límites con la web.

No se recomienda una extensión de series temporales ni microservicios solo por 240 MiB de odds. Los defectos semánticos y la carga de relaciones completas son más urgentes.

## 11. Arquitectura de procesos: monolito modular + workers

| Proceso futuro | Qué existe hoy | Estado / mínima evolución |
|---|---|---|
| web | Next UI, rutas, consultas y side effects de ingestión | YA EXISTE; separar adaptadores web de servicios de dominio y devolver datos persistidos cuando corresponda |
| live-radar | React refresh -> GET -> AllSports/context/análisis | CONCEPTUAL; convertir recolección en job independiente para que no dependa de una pestaña abierta; conservar motor de decisión |
| historical-collector | histórico bajo demanda por equipos/H2H | PARCIAL; nuevo entrypoint por provider/league/season, cobertura/checkpoints, sin duplicar Fixture |
| odds-collector | map/detail/saveOddsSnapshot dentro de llamadas web | PARCIAL; extraer scheduler/entrypoint, cuotas/fases/cobertura y normalización corregida |
| hybrid-worker | runHybridBatch, cola HybridScout, lease y budget | CONCEPTUAL fuerte; extraer del after(response) conservando autorización, cupos persistidos, exclusión mutua y matching |
| outcome-resolver | resolveObservedMarketResults, resolutores HT/FT y prioridad de outcomes en processor | PARCIAL; proceso con cola/reintentos y cierre de fixtures, sin repetir fetches innecesarios |
| feature-builder | buildSnapshotFeatures inline y ventanas del dataset | PARCIAL; función versionada + job as-of reproducible, consumiendo solo observaciones disponibles |
| training-worker | no existe; scripts debug no entrenan modelos | NUEVO en fase posterior, con dataset manifests, modelo/artefactos/evaluación |

```text
Un repositorio / módulos de dominio compartidos / contratos versionados
  ├─ proceso web (Next)
  ├─ proceso collectors (roles LIVE / histórico / odds configurables)
  ├─ proceso híbrido / outcomes (pueden separarse al crecer)
  ├─ proceso feature-builder
  └─ proceso training-worker [futuro]
         │
         ├─ misma PostgreSQL existente: hechos, jobs, checkpoints, manifests
         └─ artefactos versionados fuera de tablas calientes si su tamaño lo requiere
```

Los roles pueden empezar en pocos ejecutables, sin ocho despliegues obligatorios. Reinicios independientes requieren entrypoints y supervisor/containers separados; funciones en archivos diferentes dentro de Next **no** cumplen eso. Cada job necesita ownership/lease con expiración, fencing o claim seguro, reintentos e idempotencia. El lease híbrido global de 120 s y el `findMany` de toda la cola son un punto de partida, no una cola distribuida general. Persistir progreso/outbox para evitar la ventana commit-sin-publicación. No ejecutar HTTP prolongado dentro de transacciones generales de DB.

El presupuesto debe seguir siendo común y persistido entre procesos. El cache en memoria de cada web worker no coordina cuotas. ApiFootballBudget usa reserva atómica diaria y la sesión vive en HybridApiCache con bloqueo; fallos consumen reserva. En la base se observaron 3+2+5 solicitudes automáticas reservadas en tres días, pero no se reautenticó la cuenta ni se recalculó su plan en esta auditoría. Una futura cola no debe saltarse esos controles ni resetear la sesión al reiniciar.

## 12. Lista exacta de cambios recomendados para una siguiente fase

Todo lo siguiente es **propuesta pendiente**, no DDL ejecutado. Aplicar evoluciones aditivas y verificables sobre la misma PostgreSQL, manteniendo compatibilidad con la web y el motor actual.

### Fase siguiente prioritaria: contrato de datos antes de ML

1. **Corregir el contrato temporal de ingesta** en AllSports/odds/kickoff: zona explícita, rawTimestamp, eventAt, receivedAt/availableAt. Auditar el desfase medido antes de cualquier reparación; no sumar/restar siete horas masivamente por suposición. Registrar qué filas históricas no pueden reconstruirse.
2. **Extender League/Team y añadir CompetitionSeason**: género, ageCategory, squadLevel, competitionKind/friendly, estado/provenance de clasificación; season oficial/start/end. Añadir seasonId opcional en Fixture, poblar desde metadata estructurada y mantener season heredado durante transición. No tratar kickoff.year como temporada oficial.
3. **Extender Fixture** para resultado confirmado/provenance y venue/round/metadata ya disponible; no inventar NULL como 0. Revisar parseScore general que actualmente convierte score ausente a 0-0, sin cambiar las decisiones de apuestas en este trabajo de auditoría. Separar el contrato de evidencia del dataset del display heredado.
4. **Añadir FixtureProviderId** para mappings explícitos provider+externalId -> Fixture canónico, con método/confianza/verificación; migrar/compatibilizar el mapping HybridScout sin borrar esa tabla ni importar duplicados API-Football. Team/League provider mappings se incorporarían solo cuando se requiera fusión multifuente verificada.
5. **Añadir TeamPeriodStats y FixturePeriodResult** ligados al Fixture existente. Periodos y revisiones explícitos, métricas nullable, coverage/método/origen/availableAt. Mantener TeamMatchStats como proyección del último total para lectores actuales.
6. **Extender MatchEvent/Lineup cuando el provider lo permita**: ID real, periodo, minuto base+añadido/segundo, eventAt/receivedAt, revisiones/retiradas; IDs estables de jugador y procedencia de starter/bench. No usar una corrección de texto como un segundo evento deportivo sin revisión.
7. **Rediseñar la identidad temporal de OddsSnapshot y Bookmaker**, conservando filas originales: provider/casa real, marketKey/period/selectionKey/line estructurados, fase y suspensión, clocks e ID/hash de observación. Añadir catálogo MarketDefinition si se van a soportar varios mercados, con reglas de settlement versionadas. Probar A→B→A y NULL en claves antes de cambiar unique. No continuar entrenando sobre líneas extraídas del ordinal del nombre.
8. **Añadir IngestionBatch/ProviderObservation y CollectionJob**: manifests de recepción/raw payload o URI+hash, parserVersion, source IDs y estado de cobertura; jobs/checkpoints/lease/retries con claves idempotentes. No convertir HybridApiCache en una bolsa de jobs de todos los dominios. Redactar credenciales en cualquier metadato de requests.
9. **Extender LiveSnapshot/LiveMarketSnapshot** con periodo/evidencia y clocks disponibles, featureBuilderVersion/lineage/createdAt, manteniendo los campos originales. Definir inmutabilidad de features y export as-of con allowlist. Añadir índice temporal/pendientes solo tras examinar planes. Mantener el CHECK especializado de 1T hasta una decisión explícita de evolución.
10. **Extraer workers como entrypoints del mismo monolito**, empezando por collector y outcome-resolver, después híbrido. Preservar los servicios existentes y controles; instrumentar cobertura, retraso, reintentos, writes/seg y consumo de API. No cambiar cadence o presupuestos sin planificación/permiso de esa fase.

### Posterior, solo al tener datos temporales confiables

11. **MarketOutcome + FeatureSnapshot/DatasetVersion** para multimerccado: outcomes genéricos versionados, feature rows inmutables por fixture/market/decisionAt, referencias a observaciones y manifest de corte/splits. LiveMarketSnapshot sigue siendo la fuente especializada 1T; no se duplica Fixture ni se relajan sus constraints para forzar todos los casos. Evitar duplicación inútil: un feature set común puede compartirse por múltiples mercados.
12. **ModelVersion y Prediction**: training dataset/version, feature schema/code, artifact URI/hash, calibración/métricas/scope; probability, cuota exacta referenciada, cálculo versionado de edge y predictionAt/availableAt. Prediction se vincula al settlement posterior sin convertir outcome en feature. No usar confidence/BET_SCORE como probabilidad calibrada por definición.
13. **Escalabilidad y deprecación con evidencia**: acotar lecturas odds, medir índices/retención; planificar particiones si se justifica. Migrar consumidores de Match/Alert antes de declarar deprecada la familia A. Mantener copias/reversibilidad y compatibilidad; ninguna eliminación por estar vacío en un solo corte.

## 13. Riesgos y criterios de aceptación del siguiente diseño

| Prioridad | Riesgo observado | Qué debe probar la fase futura |
|---|---|---|
| P0 datos | Timestamps de odds futuros respecto a inserción | Conversión UTC reproducible por proveedor y ausencia de cotizaciones disponibles en el futuro |
| P0 datos | Línea extraída de 1st/3-Way/1x2 | Round-trip market/selection/line estructurados y fixtures de pruebas por mercado |
| P0 PIT | Confirmación híbrida posterior al capturedAt | Ninguna feature/elegibilidad usa evidencia con availableAt posterior a decisionAt |
| P0 leakage | Labels en fila + joins a stats finales | Export allowlist, tests as-of y splits por fixture/tiempo |
| P1 cobertura | Categorías mixtas, xG/odds del dataset ausentes | Allowlist verificada y reporte de missingness; no imputación silenciosa ni entrenamiento prematuro |
| P1 resolución | LIVE antiguos, no worker de cierre independiente | Jobs de reconciliación/outcomes idempotentes con cobertura y retries |
| P1 serie | Dedupe elimina revisitas de precio/suspensiones | Conservación de A→B→A y fases/cutoffs verificables |
| P1 operación | Toda oddsHistory en contexto y escritura por cuota | Límites/paginación, último precio por clave y pruebas de carga |
| P2 legado | Familia A vacía pero endpoint vigente | Migración de consumidor y observación de uso antes de retirar |

## 14. Verificación de no modificación

La única escritura realizada de esta fase es este reporte. No se edita schema, código, radar, processor, BET_SCORE ni configuración. No se generan/aplican migraciones, no db push/reset, no base nueva, no backtest, no entrenamiento y no llamadas a providers. No se ejecutan tests DB que creen fixtures sintéticos: el objetivo es inspeccionar la base existente tal como está.

Se calculó un SHA-256 agregado de `src/`, `prisma/`, `scripts/` y `package.json` antes y después de la auditoría. **Coinciden**: `d1b40f3491bc5759ff9d378bb9ff39d4f0bbbc82668d573cbcd57c484b1d3ebe`.

**Decisión recomendada:** una PostgreSQL existente, familia Fixture como núcleo, contratos temporales y de identidad primero, monolito modular con workers reiniciables después, ML solo cuando la cobertura y el point-in-time sean auditables. No hay justificación actual para recrear la base o dividir el dominio en microservicios.
