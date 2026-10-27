# FootballDataCsvProvider: integración y primera temporada real

Fecha de cierre: 2026-10-14. **GO_FOR_FOOTBALL_DATA_BACKFILL**, como recomendación para una siguiente carga controlada y autorizada, con preflight por temporada. **No se inició backfill adicional.** El CLI y el provider siguen limitados a **E0/2425**; no aceptan otras temporadas. Esta validación no acredita automáticamente los formatos de 2000–2024.

Se importó únicamente Premier League 2024/25 en la PostgreSQL existente `fut_analytics_history`. La segunda ejecución real devolvió `ALREADY_DONE` y conservó los mismos registros y hashes. No se creó una nueva base productiva.

## Resultado real

| Entidad | Primera ejecución | Segunda ejecución |
|---|---:|---:|
| Fixtures nuevos | **380** | **0** |
| Fixtures preexistentes reutilizados/actualizados | **0** | 0 actualizados; temporada completa omitida por checkpoint |
| Teams nuevos | **20** | **0** |
| Teams de otros proveedores reutilizados | **0** | 0; no hubo upserts |
| TeamMatchStats | **760** | sin cambios |
| TeamPeriodStats | **1520** | sin cambios |
| Fixtures con referee | **380/380** | sin cambios |
| HistoricalMarketOutcome | **3040** | sin cambios |
| HistoricalOddsQuote | **20606** | sin cambios |
| ProviderEntityMapping en producción | **0** | **0** |
| HistoricalIngestionState | **1**, SUCCEEDED | misma fila, sin cambios |
| Duplicados del CSV | **0** | **0** |

Los 20 equipos se reutilizan entre los 380 partidos: 760 apariciones de equipo, 20 identidades distintas y 740 referencias posteriores a esas identidades. Esto no significa reutilización de 740 equipos preexistentes de otro proveedor. No había fixtures API-Football persistidos para fusionar al importar; por ello no se inventaron mappings productivos.

Salidas reales del CLI:

```json
{"mode":"WRITE","state":"SUCCEEDED","inserted":380,"updated":0}
{"mode":"WRITE","state":"ALREADY_DONE","inserted":0,"updated":0}
```

La comparación entre ambas ejecuciones incluye hashes de fixtures, teams, TeamMatchStats, period stats, outcomes, historical odds, mappings y checkpoint. **Todos idénticos.** No se actualizó siquiera la fecha del checkpoint durante el replay.

## Contrato e infraestructura reutilizada

`HistoricalProvider` expone `provider` y `batches(): Promise<HistoricalBatch[]>`. `FootballDataCsvProvider` implementa ese contrato; `ApiFootballProvider` adapta lotes ya normalizados de API-Football al mismo runner. No se activó nuevo transporte API-Football. StatsBombOpenProvider sigue siendo una implementación futura, no se añadieron llamadas ni un falso adapter funcional.

`runHistoricalProvider` realiza preflight de todos los lotes antes de escribir, delega la persistencia a `runHistoricalBatch` y permite continuar desde el cursor persistido. Se reutilizan League, Season, Team, Fixture, TeamMatchStats, TeamPeriodStats, HistoricalMarketOutcome, Bookmaker, ProviderEntityMapping y HistoricalIngestionState. No se usa el writer LIVE ni sus hooks.

El CSV completo se normaliza en memoria y se divide en **8 lotes de hasta 50 fixtures**. La validación permite ventana anual de hasta 366 días solo para FOOTBALL_DATA; API-Football/AllSports conservan el máximo de siete días. El límite de 50 fixtures por transacción no se relajó. Los cursores incorporan el hash del archivo y el offset. Un archivo modificado durante una continuación o tras completar una temporada se rechaza; no se sobrescribe silenciosamente una temporada cerrada.

El downloader público usa `https://football-data.co.uk/mmz4281/2425/E0.csv`, un intento, sin redirects/retries, timeout y límite de tamaño del contenido parseado. Valida competición/temporada antes de HTTP. La prueba integrada reutilizó la copia pública ya verificada, evitando otra descarga. **HTTP de datos durante esta integración: 0 a Football-Data y 0 a API-Football**; el downloader se probó con transporte simulado. Se consultó el diccionario público de columnas para la implementación.

## CSV, cobertura y anomalías

Archivo: `reports/football-data-E0-2425.csv`, SHA-256 `d0c8ce4a96d886cf60cf101f570f4a3893844226f91c7bd769eb568c49edbfa4`.

- **380/380 filas aceptadas**, 0 rechazos, 0 duplicados, 8 lotes.
- FT/HT, shots/SOT, corners, fouls, yellow/red cards y referee: **380/380 presentes** en esta temporada.
- Cada fixture guarda dos periodos por equipo: FIRST_HALF con goles HT explícitos, FULL_TIME con goles y estadísticas finales. No se infieren estadísticas del primer tiempo ni se copian las FT a HT.
- xG, posesión y dangerous attacks ausentes en este CSV: **NULL**. Estadísticas HT no proporcionadas: **NULL**. Un cero explícito de tarjetas se conserva como cero, distinto de ausencia.
- Columnas opcionales ausentes se mantienen NULL. Cabeceras duplicadas, CSV mal formado, equipos ausentes, identidades ambiguas, scores inválidos y SOT mayor que shots fallan antes de importar.
- Parser soporta campos entre comillas, comas embebidas, comillas escapadas, CRLF y BOM. No se asume una posición fija de columna ni la presencia de estadísticas opcionales.
- Identidad: hash estable de competición/temporada/fecha y equipos ordenados, sin depender de marcador, odds o número de fila. Team IDs son identidades propias del proveedor, no IDs API-Football inventados.
- El kickoff interpreta el reloj del CSV de esta competición en Europe/London, con conversión DST comprobada por round-trip y contraste de los tres fixtures ya validados. Hora ausente/ambigua/inválida bloquea el lote: no se inventa medianoche. Esto debe validarse por temporada antes de ampliar el backfill, especialmente en archivos antiguos sin Time.

No hubo anomalías bloqueantes en E0/2425. Las ausencias parciales de odds ya documentadas permanecen ausencias, no valores cero.

## Odds y migración estrictamente necesaria

La tabla LIVE `OddsSnapshot` exige `timestamp`. El CSV no entrega la fecha exacta de observación de cada cuota. Usar kickoff o fecha de descarga como fecha de cotización sería inventar información, y volver nullable el timestamp alteraría contratos de lecturas existentes.

Se aplicó la migración aditiva **`20261014020000_football_data_archive`**:

1. `Fixture.referee String?`.
2. `HistoricalOddsQuote`, ligada mediante FK a **Fixture y Bookmaker existentes**, con provider, sourceColumn, market, selection, line, price, phase, `quotedAt DateTime?` y receivedAt.
3. Unicidad `(fixtureId, provider, sourceColumn)`, índices y constraint `price > 1`.

No se cambiaron columnas ni timestamps de OddsSnapshot, LIVE/PIT o budgets. La migración se ejecutó primero en la base temporal y luego en la real, en transacción, con lock timeout. Sin reset, db push ni borrado de datos productivos.

Las **20606 cotizaciones** conservan `provider=FOOTBALL_DATA` y **quotedAt=NULL en el 100%**. receivedAt refleja la recepción local del archivo por el proceso, no un instante de cotización previo al kickoff. La columna de origen distingue cotizaciones PRE_CLOSING/CLOSING. Estas odds históricas no se ofrecen al pipeline PIT/LIVE.

Se importan solo columnas seleccionadas del [diccionario oficial](https://football-data.co.uk/notes.txt): 1X2 de Bet365, Bet&Win, Betfair, Pinnacle, William Hill, 1XBet y Betfair Exchange; totales 2.5 y handicap asiático de Bet365/Pinnacle, incluidas sus variantes de cierre. HOME/DRAW/AWAY y OVER/UNDER se distinguen; en handicap la línea de AWAY invierte el signo de la línea HOME. Max/Avg no se presentan como bookmakers y se excluyen, al igual que columnas sin interpretación documentada en la lista implementada. Todos los mercados importados corresponden al partido completo: no se sustituyen mercados FIRST_HALF ni se crean odds 0.5 inexistentes.

## Mappings y prevención de duplicación entre proveedores

La prueba de persistencia temporal importó después los tres fixtures reales previamente verificados de API-Football como lotes suministrados localmente. Resultado: **0 fixtures adicionales, 3 reutilizados**; mappings persistidos **3 FIXTURE + 6 TEAM + 1 COMPETITION**. Las estadísticas canónicas TeamMatchStats del CSV no fueron reemplazadas por NULL de otro proveedor; cada proveedor conserva sus period stats/outcomes separados.

Resolución: mapping persistido primero; si no existe, coincidencia estricta de competición/país, kickoff y equipos orientados. Normalización controlada con único alias explícito Man United → Manchester United. No fuzzy ni inversión local/visitante. Múltiples candidatos o identidad sin resolver bloquean la operación. Un score incompatible también bloquea la fusión. El bloqueo asesor transaccional protege la identidad durante la búsqueda/escritura.

Los mappings de la prueba viven únicamente en la base temporal. **Producción tiene 0 mappings**, porque esta fase no ingirió API-Football ni fabricó sus entidades a partir de una comparación anterior. La ruta queda comprobada para una futura ingesta autorizada. No se modificó HybridScout.

## Conteos reales antes/después

| Tabla | Antes | Después |
|---|---:|---:|
| League | 98 | 99 |
| Season | 0 | 1 |
| Team | 665 | 685 |
| Fixture | 503 | 883 |
| TeamMatchStats | 1006 | 1766 |
| TeamPeriodStats | 0 | 1520 |
| HistoricalMarketOutcome | 0 | 3040 |
| HistoricalOddsQuote | tabla inexistente | 20606 |
| ProviderEntityMapping | 0 | 0 |
| HistoricalIngestionState | 0 | 1 |
| OddsSnapshot | 785057 | 785057 |
| LiveSnapshot | 4353 | 4353 |
| LiveMarketSnapshot | 17 | 17 |
| HybridScout | 47 | 47 |
| ApiFootballBudget | 3 | 3 |

Hashes completos de los **503 fixtures anteriores**, LiveSnapshot, LiveMarketSnapshot, HybridScout y ApiFootballBudget coinciden antes/después. Para los fixtures anteriores la comparación excluye únicamente la nueva columna nullable referee. Los **92 archivos protegidos** mantienen sus hashes. BET_SCORE, ENTRY/NO_ENTRY, thresholds, radar, LIVE/PIT y budgets intactos. No se activaron polling, backtesting o ML.

## Validación técnica

- **232 pruebas distintas aprobadas**, 0 fallos pendientes: conjunto completo de 231 (210 del primer grupo, 13 de persistencia histórica y 8 de persistencia Football-Data), más una regresión final de equivalencia ISO. Para esta última se reejecutaron las 14 pruebas del provider, todas OK; las 13 repetidas no se cuentan dos veces. Incluye **22 nuevas** en esta integración: 14 de parser/provider y 8 de DB. Se ajustó la prueba de allowlist para conservar 12 competiciones únicas con 13 bindings de proveedor.
- Cobertura: 380 filas, HT/FT, estadísticas solicitadas, referee, NULL, odds documentadas y sin timestamps inventados, duplicados, límites de temporada, dry-run sin DB/HTTP, descarga de un intento, persistencia completa, replay con cliente nuevo, cambios de fuente bloqueados, mappings entre proveedores, ambigüedad y protección LIVE/PIT/budget.
- La primera ejecución de persistencia detectó que Prisma no podía deserializar el `void` del bloqueo asesor. Se corrigió la consulta para devolver un entero; las 13 pruebas afectadas y las 8 nuevas de DB se ejecutaron satisfactoriamente después. No se cambió el diseño ni se ignoró el fallo.
- La revisión final normalizó el instante usado para el bloqueo de identidad y comparó rangos por epoch en lugar de representación textual ISO. La regresión adicional comprueba que `+00:00` y `.000Z` no impiden el replay del adapter API-Football. Se repitieron compilación histórica y build después del ajuste.
- Base temporal: `fut_historical_test_csv_20261014`, con esquema copiado y sin datos productivos. Migración, escritura de 380 fixtures, replay y mappings probados allí. Eliminada al finalizar; no se mantuvo otra base productiva.
- `npx prisma validate`: **OK**.
- `npx prisma generate`: **OK**.
- `npx prisma migrate deploy`: **OK**, temporal y real.
- `npx prisma migrate status`: **OK**, siete migraciones, ninguna pendiente.
- `npm run historical:build`: **OK**.
- `npm run build`: **OK**, con bloqueo de HTTP de proveedores durante el build.

## Ejecuciones y evidencias

```powershell
npm.cmd run historical:build
node scripts/football-data-import.cjs --competition=E0 --season=2425 --input=reports/football-data-E0-2425.csv --dry-run
node scripts/football-data-import.cjs --competition=E0 --season=2425 --input=reports/football-data-E0-2425.csv --write
# Misma ejecución, proceso nuevo: ALREADY_DONE
node scripts/football-data-import.cjs --competition=E0 --season=2425 --input=reports/football-data-E0-2425.csv --write
```

Sin `--write` el modo es dry-run. Sin `--input`, el provider puede descargar públicamente ese mismo CSV autorizado; dry-run significa sin escritura DB, no necesariamente sin descarga si no se suministra archivo local.

Evidencias en reports: `football-data-integrated-dry-run.jsonl`, `football-data-integration-tests.txt`, `football-data-foundation-retest.txt`, `football-data-persistence-tests.txt`, `football-data-final-unit-tests.txt`, `football-data-integration-before.json`, `football-data-real-import.jsonl`, `football-data-after-first-import.json`, `football-data-real-replay.jsonl`, `football-data-integration-verification.json`.

## Archivos de código modificados o añadidos

- `src/services/historical/footballDataCsv.ts`: provider, parser, normalización, odds y downloader público.
- `src/services/historical/seasonWorker.ts`: contrato multiproveedor, adapter de lotes API-Football, preflight, continuación y replay.
- `src/services/historical/fixtureIdentity.ts`: identidad y reutilización canónica entre proveedores.
- `src/services/historical/scope.ts`, `types.ts`, `validation.ts`: binding FOOTBALL_DATA y contrato histórico.
- `src/services/historical/mapping.ts`, `persistence.ts`, `worker.ts`: mappings, referee/archivo de odds y fingerprint estable del checkpoint CSV.
- `scripts/football-data-import.cjs`, `package.json`: CLI y comando `historical:football-data`.
- `prisma/schema.prisma`, `prisma/migrations/20261014020000_football_data_archive/migration.sql`: cambios aditivos descritos.
- `tests/historical/football-data.test.cjs`, `football-data.persistence.test.cjs`, `foundation.test.cjs`: cobertura nueva y binding adicional.

MCP usado primero: arquitectura histórica y trazas de `runHistoricalBatch`; revisión de dependencias y fragmentos de contratos, validación, persistencia, mappings y schema. Al terminar se reindexó y trazó `runHistoricalProvider`: caller CLI, delegación al worker existente, sin callers LIVE. Los cambios heredados de fases anteriores en el working tree no se atribuyen a esta integración.

**GO_FOR_FOOTBALL_DATA_BACKFILL**, sujeto a ampliar el alcance de forma explícita y validar cada formato/temporada. El trabajo actual termina con E0/2425 importado una vez y replay comprobado. No se inició ninguna otra temporada.
