# Integridad temporal y point-in-time — FUT

Fecha: 2026-10-13. Continuación de `HISTORICAL_ML_SCHEMA_AUDIT.md`.

## 1. Resultado y alcance

Los **3/17 casos son leakage temporal real de elegibilidad/confirmación del periodo** si se utilizan como decisiones tomadas a `capturedAt`. No eran un enriquecimiento posterior correctamente separado: el certificado posterior autorizaba crear una fila cuyo `capturedAt` seguía siendo el recibo anterior de AllSports. No se observó sustitución de estadísticas históricas por estadísticas finales ni se ejecutó entrenamiento.

Se implementó una barrera estricta para nuevas capturas y una proyección verificable `pointInTimeFeatures`. La regla es **availableAt <= capturedAt** para cada evidencia utilizada. No se añadieron columnas, tablas ni migraciones. Los 17 registros originales no se modificaron.

La garantía tiene un límite explícito: corresponde a la ruta de captura y a la proyección verificada de **LiveMarketSnapshot**. No convierte automáticamente todo PostgreSQL, `LiveSnapshot`, `OddsSnapshot`, los joins actuales de Fixture o la respuesta de `trainingSummary` en un dataset PIT. Ningún futuro consumidor debe usar `SELECT *` o ese resumen de monitoreo como matriz de features.

## 2. MCP, archivos e impacto

Consultas ejecutadas antes de editar:

- `get_architecture(project=FUT, aspects=[dependencies,entry_points,layers])`: 1.847 nodos, 5.620 aristas; proveedores → persistencia → training/hybrid; rutas API como entradas.
- `search_graph`: `hybridObservation`, `buildSnapshotFeatures`, `persistLiveMarketSnapshot`, `resolve*Outcomes`, `saveLiveSnapshot`, `saveSingleOddSnapshot`, `alignedApiFootballObservation`; segunda búsqueda de `rawRequest`, `mapLiveOdds`, `selectFirstHalfOdds`, `extractLine`.
- `trace_path(direction=both, depth=2)`: `hybridObservation`, `buildSnapshotFeatures`, `alignedApiFootballObservation`, `resolveFinalSnapshotOutcomes`, `saveSingleOddSnapshot`. Se revisaron callers y callees.
- `detect_changes(scope=impact, direction=both, depth=1)`: el diff global incluía 151 archivos de fases anteriores; **no se atribuyó ese diff completo a esta fase**. El impacto concreto se acotó con trazas y fragmentos.

Flujos comprobados:

```text
AllSports/API-Football rawRequest (respuesta ya solicitada)
  → rememberTrainingReceipt
  → adaptador TrainingObservation
  → persistMatchDetail → saveLiveSnapshot
  → observeLiveMarketDataset → recordHybridScout
  → persistLiveMarketSnapshot → buildSnapshotFeatures

runHybridBatch.receive → certificado persistido → hybridObservation
  → persistLiveMarketSnapshot (solo si la observación no precede al certificado)

listMatches / observeLiveMarketDataset / processor.applyOutcomes
  → resolveFirstHalfSnapshotOutcomes / resolveFinalSnapshotOutcomes
  → actualizaciones exclusivas de labels

mapOdds / mapLiveOdds → saveOddsSnapshot → saveSingleOddSnapshot
  (persistencia general de cuotas, no se cambió)
```

Archivos existentes abiertos por fragmentos o búsquedas: `reports/HISTORICAL_ML_SCHEMA_AUDIT.md`, `prisma/schema.prisma`, `package.json`, `src/services/training/{observation,features,liveMarketSnapshots}.ts`, `src/services/training/hybrid/{policy,processor}.ts`, `src/providers/football/{allSportsApi,apiFootball}.ts`, `src/services/persistence/footballPersistence.ts`, `tests/training/{features.test,hybrid.test,hybrid.persistence.test,persistence.test,hybrid-fixtures}.cjs`. También se leyó la solicitud adjunta. Los archivos protegidos se leyeron como bytes para comparar huellas, no para cambiar su lógica.

Impacto: capturas inicialmente pendientes deberán esperar la siguiente observación AllSports recibida después del certificado. Algunas cuotas antes aceptadas por timestamp del proveedor quedarán NULL si llegaron tarde o no tienen recibo comprobable. Las ventanas nuevas no usarán filas antiguas sin prueba PIT. No hay nuevo scheduling, endpoint HTTP, petición, reserva de presupuesto ni cambio del motor de apuestas.

## 3. Flujo temporal real

| Concepto | Representación actual y significado |
|---|---|
| Provider event time | Minuto/estado del fixture y scores describen el partido; no son una hora absoluta de disponibilidad. `fixture.date`/kickoff es el inicio, no la fecha de actualización de stats. No se inventa un timestamp de evento que el payload no aporta. |
| Provider quote timestamp | AllSports `odd_last_updated` y API-Football `update`; llegan a `quotedAt`/`OddsSnapshot.timestamp`. Deben distinguirse del recibo. |
| Fetch start | No se conserva de forma uniforme. No es necesario añadirlo para esta barrera: iniciar un request no hace disponibles sus datos. |
| Local receipt | `rememberTrainingReceipt` marca la respuesta parseada en cache misses. Un cache hit conserva el recibo original mediante WeakMap. Se amplió esa marca a OddsLive y `/odds/live`, sin nueva llamada. |
| observedAt | En AllSports, recibo del payload que contiene reloj, score y stats. En API-Football alineada, máximo de recibos de fixture y stats aceptadas; si difieren más de 30 s no se agregan las stats. |
| receivedAt de stats/fixture | Para API-Football separada ahora se conservan ambos en `TrainingObservation.receipts`. Para AllSports comparten `observedAt`. |
| LiveSnapshot.timestamp / createdAt | Defaults de inserción PostgreSQL. No son provider timestamps ni el recibo original. Su hash usa además un bucket de captura local. No se cambió esta tabla. |
| Fixture.providerUpdatedAt | El writer lo asigna con `new Date()` local. Su nombre no demuestra una hora de actualización del proveedor. |
| HybridApiCache.fetchedAt | En directorios de fixtures se guarda el recibo original de la respuesta, no la hora de releer caché ni el inicio del fetch. |
| Certificate.observedAt | Recibo original del fixture API que confirma 1H; en cache de directorio se conserva `fetchedAt`. `expiresAt` expresa vigencia, no disponibilidad inicial. |
| availableAt | No requiere una columna independiente por cada sinónimo. Para fixture/stats es su recibo local; para periodo híbrido es el recibo del certificado; para odds es su recibo local independiente. Estos relojes se conservan en el JSON PIT. |
| LiveMarketSnapshot.capturedAt | Instante de la observación seleccionada. No se desplaza al futuro para justificar una confirmación tardía. |
| htResolvedAt / ftResolvedAt | Recibo de la observación de cierre con score confirmado, no necesariamente el instante físico del pitido. |
| resultResolvedAt | Recibo usado para completar la resolución conjunta; es metadata de label futuro, no feature. |

Secuencia nueva permitida: respuesta de stats/score recibida → todos los recibos utilizados <= T → snapshot con capturedAt=T → outcomes posteriores en sus columnas separadas. Un certificado posterior a T queda en `HybridScout.certificate` para auditoría y observaciones posteriores; no convierte la observación antigua en candidata.

API-Football ya usaba `max(fixtureReceipt,statsReceipt)` para evitar backdating de stats: se conservó esa conducta y se hicieron persistibles los dos relojes. La tolerancia de alineación de 30 s entre respuestas **no permite** usar datos recibidos después del `capturedAt` resultante. Es distinta de la tolerancia híbrida de 30 s eliminada.

## 4. Investigación exacta de los tres casos

Consulta read-only con RepeatableRead, sin endpoints de proveedores. Evidencia reproducible en `point-in-time-evidence.json`; corte de la segunda lectura: **2026-10-13T18:57:19.098Z**. Las horas de esta sección están en UTC.

| Fixture (AllSports ↔ API-Football) | Snapshot | capturedAt | Confirmación API | Diferencia |
|---|---|---|---|---:|
| Ceara–Criciuma, 1752104 ↔ 1520912 | cmv057meh06c5c7og464r5teh | 2026-10-08 23:03:24.668 | 2026-10-08 23:03:36.075 | +11,407 s |
| Fluminense–Coritiba, 1727043 ↔ 1492394 | cmv08mwyc71wwc7og9t7rlmk9 | 2026-10-09 00:39:18.286 | 2026-10-09 00:39:28.271 | +9,985 s |
| Fluminense–Coritiba, 1727043 ↔ 1492394 | cmv0911ib810bc7og39g56o7w | 2026-10-09 00:50:16.172 | 2026-10-09 00:50:27.654 | +11,482 s |

| Snapshot | Fuente LiveSnapshot / inserción | Minuto / SOT total | Labels recibidos |
|---|---|---|---|
| cmv057meh06c5c7og464r5teh | cmv057dru026cc7ogkt1ks2zg / 2026-10-08 23:03:25.050 | 32 / 1 | HT 2026-10-08 23:24:14.864; FT 2026-10-09 00:30:15.253 |
| cmv08mwyc71wwc7og9t7rlmk9 | cmv08mpcs6wzpc7og0y39ex7o / 2026-10-09 00:39:18.749 | 9 / NULL | HT y FT 2026-10-12 20:36:25.543 |
| cmv0911ib810bc7og39g56o7w | cmv090sxg7vvyc7ogjal9udw3 / 2026-10-09 00:50:16.564 | 20 / 1 | HT y FT 2026-10-12 20:36:25.543 |

En **cada uno** están afectados la autorización FIRST_HALF, `marketPeriod`, `periodProvider=API_FOOTBALL` y `dataQualityDetails.hybridEvidence`; indirectamente, la pertenencia al dataset 1T y las features/ventanas condicionadas por ese periodo. `statsProvider=ALLSPORTS` y las stats conservan el recibo anterior: no se encontró evidencia de que esos SOT fueran recibidos después. Los tres contaminarían una reconstrucción de elegibilidad en T; no se afirma que se entrenara un modelo con ellos.

Causa en código: `hybridObservation` rechazaba únicamente `certificate.observedAt - observation.observedAt > 30_000`. `processor.receive` podía llamar a persistencia con la última observación AllSports anterior al HTTP; `buildSnapshotFeatures` mantenía `capturedAt=observation.observedAt`. El código crea una fila retrodatada respecto de su confirmación; no necesita hacer un UPDATE de features para producir el leakage. No existe un `createdAt` propio del LMS para fechar exactamente esa inserción histórica.

Se preservaron las filas y sus labels. La huella SHA-256 de los 17 snapshots ordenados, junto con los mismos campos de fixture/fuente seleccionados, fue idéntica antes y después:

`08343fc7a128acd339c692c6d50093efb138871707e6c0020bd1f4abc7b79364`

Los otros 14 no muestran este defecto específico, pero tampoco tienen la nueva prueba de integridad/recibos completa. **Los 17 se consideran legacy no verificados**, no 17 casos demostrados de leakage. No se les fabricó un sello retrospectivo.

## 5. Contrato mínimo implementado

### Captura

1. `hybridObservation` exige `certificate.observedAt <= observation.observedAt` sin tolerancia positiva. Rechaza también fecha de certificado inválida.
2. `candidateSkipReason` valida que fixture, stats y confirmación no sean posteriores a la observación, además de los controles de score/periodo/frescura existentes.
3. `buildSnapshotFeatures` excluye una cuota sin recibo local, con recibo posterior al snapshot, con provider timestamp posterior al recibo o demasiado antigua. La convierte a NULL, junto con su bookmaker/provider/timestamp; nunca a cero. No muta el objeto de entrada.
4. `persistLiveMarketSnapshot` solo usa filas históricas que pasan `pointInTimeIssue` para las ventanas. Esto evita que una ventana nueva herede una fila legacy o alterada sin control.
5. El periodo híbrido sigue proviniendo de API-Football; las stats de AllSports. No se añadió validación remota ni se cambió matching, TTL, cooldown o límites de consumo.

### Evidencia persistida

Se reutiliza `dataQualityDetails.pointInTime`:

- `version=1`: versión del contrato PIT, independiente del `dataQualityDetails.version` existente.
- `capturedAt`: copia comprobable del cutoff.
- `fixtureReceivedAt`, `statsReceivedAt`: disponibilidad de los payloads usados; stats NULL si no se aceptó el payload separado.
- `periodAvailableAt`: recibo de la confirmación de periodo utilizada.
- `oddsReceivedAt`, `oddsProviderTimestamp`: relojes separados; NULL sin cuota elegible.
- `featureHash`: SHA-256 canónico de la proyección explícita, sus vínculos de fixture/proveedores/cuota y los relojes anteriores.

No se añadieron `eventAt`, `fetchStartedAt`, `receivedAt`, `availableAt`, `computedAt` como columnas redundantes. Para eventos sin reloj de proveedor verificable se documenta la ausencia; no se usa kickoff como sustituto. El recibo local es la frontera de conocimiento comprobable.

### Proyección e inmutabilidad

`pointInTimeFeatures(row)` devuelve únicamente la allowlist y un objeto congelado; devuelve NULL si la fila es legacy, tiene relojes inconsistentes, columnas ausentes o una huella inválida. No importa proveedores, clientes HTTP, Prisma runtime ni budget. `pointInTimeIssue` da el motivo de exclusión.

El hash incluye identidad de fixture y provenance para impedir que un payload sea reasignado sin detección. Los labels no se incluyen: HT/FT pueden completarse sin alterar el sello. El control detecta modificaciones fuera de la ruta normal; **no es un trigger SQL ni una firma contra un administrador que reescriba a propósito datos y hash**. La escritura normal sigue siendo insert-only para features y updates separados para labels. La barrera efectiva para futuros consumidores es rechazar toda fila que no pase la proyección, nunca reparar el hash al exportar.

## 6. Clasificación completa de LiveMarketSnapshot

La clasificación executable está en `pointInTime.ts:SNAPSHOT_FIELDS`. Una prueba compara todos los campos, incluidas relaciones, con Prisma DMMF y exige una clasificación única: añadir una columna sin clasificar falla la prueba.

| Categoría | Campos |
|---|---|
| FEATURE_POINT_IN_TIME — reloj/mercado/score | `minute`, `stoppageTime`, `elapsedStoppageTime`, `marketType`, `marketPeriod`, `homeScore`, `awayScore`, `goalsNeeded`, `minutesRemainingMarket` |
| FEATURE_POINT_IN_TIME — tiros y SOT | `homeShots`, `awayShots`, `totalShots`, `homeSot`, `awaySot`, `totalSot` |
| FEATURE_POINT_IN_TIME — xG/ocasiones/área | `homeXg`, `awayXg`, `totalXg`, `homeBigChances`, `awayBigChances`, `totalBigChances`, `homeShotsInsideBox`, `awayShotsInsideBox`, `totalShotsInsideBox` |
| FEATURE_POINT_IN_TIME — corners/ataques/rojas | `homeCorners`, `awayCorners`, `totalCorners`, `homeDangerousAttacks`, `awayDangerousAttacks`, `totalDangerousAttacks`, `homeRedCards`, `awayRedCards` |
| FEATURE_POINT_IN_TIME — ventanas | `sotLast5`, `sotLast10`, `sotLast15`, `xgLast5`, `xgLast10`, `xgLast15`, `bigChancesLast5`, `bigChancesLast10`, `bigChancesLast15`, `cornersLast5`, `cornersLast10`, `cornersLast15` |
| FEATURE_POINT_IN_TIME — historial/odds | `homeOver05FirstHalfRate`, `awayOver05FirstHalfRate`, `homeAvgGoalsFirstHalf`, `awayAvgGoalsFirstHalf`, `homeZeroZeroHtRate`, `awayZeroZeroHtRate`, `marketOdds` |
| LABEL_FUTURE | `goalBeforeHt`, `goalBeforeFt`, `finalHomeScore`, `finalAwayScore`, `htResolvedAt`, `ftResolvedAt`, `resultResolvedAt` |
| METADATA | `id`, `matchId`, `providerFixtureId`, `liveSnapshotId`, `capturedAt`, `sourceHash`, `match`, `liveSnapshot` |
| QUALITY/PROVENANCE | `periodProvider`, `statsProvider`, `oddsProvider`, `oddsBookmaker`, `oddsQuotedAt`, `dataQuality`, `coveragePercent`, `dataQualityDetails` |

Las seis features históricas siguen NULL: clasificarlas como features no autoriza rellenarlas con tablas actuales o partidos posteriores. `marketPeriod` permanece FIRST_HALF en este dataset. `goalBeforeFt` es un label secundario distinto de `goalBeforeHt`, no sustituye al objetivo 1T. Relaciones `match`/`liveSnapshot` e IDs no se proyectan automáticamente.

## 7. Auditoría de odds

### Hallazgos reales

La segunda consulta encontró **646.321 OddsSnapshot**, de las cuales **640.704** tenían `timestamp > createdAt + 5 min`; máximo timestamp−createdAt **25.199,719 s**. `createdAt` es una cota superior del recibo, no el recibo exacto. Una cotización fechada después de la inserción ya demuestra una inconsistencia del reloj almacenado. El volumen creció respecto del informe previo mientras la aplicación existente estaba abierta; esta auditoría no hizo peticiones de ingesta.

Ejemplos conservados en el JSON de evidencia:

- `1x2 (1st Half)`, selección 1/X/2, line=1: el número del mercado se tomó como línea.
- `3-Way Handicap`, selección Home/Draw/Away, line=3: número del nombre, no handicap demostrado.
- La auditoría anterior también observó `Asian Handicap (1st Half)` con line=1 y Asian Handicap sin línea recuperable.

`saveSingleOddSnapshot` llama a `extractLine(market + ' ' + selection)`, cuyo regex toma el primer número y no conserva de forma fiable un signo. Por tanto, un `2.5` puede ser correctamente una línea en una selección simple, pero queda desplazado por un ordinal anterior; tampoco se interpretan correctamente split lines. El precio se toma por separado (`odd_value`/`value.odd` → `price` → `odds`); no se encontró que ese writer use `extractLine` para obtener el precio. Ello no valida el mercado/selección resultante.

Los normalizadores de visualización pueden reducir información de periodo/scope. El dataset ahora revisa también el mercado AllSports **original** antes de normalizar para rechazar equipo, corners, tarjetas, handicap, 2H o FT. No se cambiaron esos normalizadores generales ni el writer que utiliza el radar.

`parseAllSportsDate` general sigue interpretando fechas sin zona mediante Date del host; la rama dataset ya añade -05:00 para el formato bare recibido de OddsLive solicitado con America/Bogota. La anomalía de horas está demostrada, pero **no se probó su causa exacta ni un clock skew tolerable**. No se restaron siete horas, no se asumió un offset de reparación ni se hizo HTTP para investigarlo.

### Parser conservador exclusivo del dataset

`parseGoalTotal` separa mercado, selección, línea, precio, periodo y clase de liquidación descriptiva. No liquida apuestas ni calcula recomendaciones.

| Entrada | Interpretación |
|---|---|
| Goals 1H / Over 0.5, precio 2.75 | TOTAL_GOALS / FIRST_HALF / OVER / line=0.5 / price=2.75 |
| Goals 1H / Over 1.5 o 2.5 | Línea 1.5 o 2.5; no elegible para el dataset OVER 0.5 |
| Goals FT / Over 2 | INTEGER_PUSH; FT explícito, no sustituto de 1H |
| Asian Total goals FT / Over 2.25 | ASIAN_SPLIT; identifica quarter line |
| Asian Total goals FT / Over 2/2.5 | line=2.25; split adyacente de medio gol |
| Over 2/3, handicap, 1x2, selección ambigua | Rechazado; no se adivina |
| Periodo ausente o 1H+FT contradictorios | Rechazado; ausencia de 1H no demuestra FT |

El selector de captura acepta únicamente FIRST_HALF, OVER, línea 0.5, cuota decimal >1 y relojes válidos; no amplía mercados. El parser no pretende cubrir todos los formatos de todos los proveedores. Casos no reconocidos quedan fuera, no mal interpretados.

**Recomendación pendiente para un dataset general de odds:** conservar raw market/selection/line/period y recibo, usar identidad canónica por proveedor, aislar filas existentes con reloj/línea no verificables y revisar la deduplicación que omite timestamp. No exportar `OddsSnapshot.line` o `timestamp` como si estuvieran certificados. Esta fase no reescribe el histórico ni altera su consumo en apuestas.

## 8. Validaciones temporales y límites

| Riesgo | Control |
|---|---|
| Provider quote timestamp futuro al recibo | `timestampIssue` exige providerTimestamp <= receivedAt. Tolerancia cero; no hay skew probado que justifique configuración. |
| Evidencia posterior al snapshot | Rechazo en política híbrida y candidate gate; verificación independiente al proyectar. |
| Odds con timestamp antiguo pero recibidas tarde | Se exige también receivedAt <= capturedAt; el timestamp del proveedor por sí solo no autoriza. |
| Observación/recibo del futuro | Capturas rechazan edad negativa; resolutores rechazan observedAt > Date.now(). |
| Outcome antes del fin lógico | HT solo con HALFTIME/SECOND_HALF/FINISHED y score HT; FT solo con FINISHED y score final. FIRST_HALF no liquida HT aunque haya un campo de score poblado; HALFTIME no liquida FT. Además capturedAt < observedAt. |
| Duración física del partido | No se inventa un fin a minuto 45/90 para categorías/duraciones desconocidas. Se exige el estado del adaptador y score confirmado; no se puede garantizar que un proveedor no se equivoque sobre el estado. |
| Actualización retroactiva | Writer normal no actualiza features; hash + allowlist excluyen una fila alterada de la proyección. No hay trigger nuevo. |
| Leakage por ventanas | El query es del mismo fixture/mercado y anterior al cutoff; solo se admiten baselines con sello PIT válido. |
| Leakage por joins actuales | No se incluyen relaciones, stats finales actuales, labels o campos desconocidos en la proyección. |

Un recibo verifica cuándo esta aplicación recibió información, no cuándo el proveedor o un tercero pudo conocerla. Se presupone un reloj local operativo; una corrección de reloj hacia atrás produce rechazo conservador de evidencias futuras. No se introdujo una tolerancia para ocultarla.

Los outcomes tardíos son válidos como labels separados: los recibidos tres días después en Fluminense–Coritiba no pasan a las features ni se retrofechan a HT. La resolución continúa usando scores explícitos, no el score final como sustituto de HT.

## 9. Pruebas y validación

**146 pruebas: 146 PASS, 0 FAIL, 0 skipped.** 119 anteriores + 27 nuevas (24 unitarias/integración de adaptador y 3 PostgreSQL). Los tests híbridos existentes se ajustaron para esperar una nueva observación tras una confirmación tardía; no para volver a aceptar el backdating.

| Suite | Total |
|---|---:|
| radar-review-now | 14 |
| radar-hybrid-review | 28 |
| training/features | 32 |
| training/hybrid | 17 |
| training/point-in-time | 24 |
| training/persistence PostgreSQL | 12 |
| training/hybrid.persistence PostgreSQL | 19 |

Cobertura añadida: evidencia previa/igual aceptada; posterior por 1 ms rechazada; uso posterior sin cambiar fila antigua; labels excluidos; clasificación completa del esquema; legacy excluido; mutación de features/identidad/provenance detectada; NULL y cero conservados; recibos separados de stats; reloj futuro/inválido; cuota tardía o sin recibo excluida; cuota válida conserva ambos relojes; líneas 0.5/1.5/2.5/enteras/asiáticas separadas de precio/mercado; HT y FT separados; resolución posterior conserva features y sello; outcomes futuros/prematuros rechazados; adaptador AllSports conserva display odds y exactamente sus dos requests ya existentes con respuestas simuladas.

Todos los requests de proveedor se bloquearon con `tests/no-provider-http.cjs`; los tests que ejercitan HTTP usan respuestas simuladas. Las pruebas DB usaron **fut_pit_integrity_test_20261013**, una base temporal con esquema copiado sin datos de producción; los escenarios se ejecutan en rollback. No se vació la cola real para acomodar pruebas.

Comando nuevo: `npm run test:point-in-time`. Ejecución completa con Node 22, register-typescript, guard de HTTP, `--test-concurrency=1` y las siete suites. Log completo: `point-in-time-tests.txt`.

- `prisma validate`: OK.
- `prisma generate`: OK. Primer intento EPERM por Next; se identificaron y detuvieron únicamente procesos de este workspace (22212 y su hijo 5764), y se repitió con éxito.
- `prisma migrate status`: 5 migraciones, schema up to date; incluida `20261008160000_hybrid_period_budget`.
- `npm run build`: OK, compilación, tipos y generación de páginas. Guard HTTP también durante build.
- Migraciones creadas/aplicadas en esta fase: **ninguna**. No reset, db push, borrado ni reescritura de datos reales.

## 10. Archivos de esta fase

Nuevos:

- `src/services/training/pointInTime.ts`: clasificación, sello, controles y proyección.
- `src/services/training/oddsIntegrity.ts`: parser conservador y sanity check de tiempos.
- `tests/training/point-in-time.test.cjs`: 24 pruebas.
- Este informe, `reports/point-in-time-evidence.json` y `reports/point-in-time-tests.txt`.

Modificados:

- `src/services/training/hybrid/policy.ts`: elimina tolerancia de confirmación posterior.
- `src/services/training/observation.ts`: recibos separados y selección segura de cuota.
- `src/services/training/features.ts`: gate temporal, cuota disponible, sello.
- `src/services/training/liveMarketSnapshots.ts`: historial verificado y rechazo de outcomes con recibo futuro.
- `src/providers/football/allSportsApi.ts`: metadata de recibo OddsLive y filtro del mercado original, solo rama training.
- `src/providers/football/apiFootball.ts`: metadata de recibo live odds y paso al selector training.
- `tests/training/features.test.cjs`: recibo explícito de odds en fixtures de test.
- `tests/training/hybrid.persistence.test.cjs`: siguiente observación tras confirmación tardía.
- `tests/training/persistence.test.cjs`: 3 pruebas de integridad persistida/outcomes.
- `package.json`: comando de pruebas PIT.

## 11. Garantía para el futuro y confirmaciones

Una fila nueva aceptada por `pointInTimeFeatures` conserva features reproducibles, vínculos y tiempos comprobables de las fuentes utilizadas, sin labels. Toda confirmación o cuota posterior queda fuera de las features de T. La ausencia de evidencia produce NULL/rechazo, no un cero ni un timestamp inventado. Un futuro feature builder debe consumir esta proyección y unir labels por identidad en un canal separado.

Esto no autoriza todavía entrenar ni rellenar historia. Los registros legacy no tienen prueba suficiente para una exportación certificada. La tabla general de odds y los joins a tablas mutables siguen necesitando la cuarentena/diseño señalado arriba antes de usos nuevos.

BET_SCORE, radar, ALERT/NO ALERT, ENTRY/NO_ENTRY, thresholds de apuestas, UI, processor, trigger y budget no fueron modificados. Se compararon huellas de los archivos protegidos. Se conserva AllSports principal y la configuración híbrida existente; no se activó ni reinició polling. Next quedó detenido tras liberar Prisma.

El presupuesto real persistido continúa con 3/2/5 requests en 2026-10-08/09/12 (10 acumulados de esos días); no se reservó presupuesto real durante la fase. **0 peticiones reales a API-Football o AllSports originadas por este trabajo**, 0 ML, 0 backtesting, 0 recolección histórica masiva. Se detiene la fase aquí.
