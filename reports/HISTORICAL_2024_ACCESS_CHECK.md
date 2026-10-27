# Verificación mínima de acceso histórico 2024

Fecha local: 2026-10-13, America/Guayaquil. Inicio UTC: 2026-10-14T00:52:05.586Z.

**Decisión: GO_FOR_20_FIXTURE_PILOT**, para un piloto MINIMAL de fixtures y estadísticas, limitado a 20 fixtures y como máximo 21 intentos HTTP (un listado y hasta 20 estadísticas). Esta decisión verifica acceso del proveedor; **no ejecuta ingesta**, no activa el adapter offline ni acredita que su transporte/cuota persistente pendientes estén implementados. No autoriza una temporada completa, eventos, alineaciones ni odds.

## Solicitudes reales

Exactamente **2 HTTP**, ambos GET al host `v3.football.api-sports.io`, autenticación `x-apisports-key` cargada privadamente con `@next/env`. Sin retries, redirects ni páginas adicionales. Sin `/status` extra.

| # | Endpoint | HTTP | errors | Resultado |
|---|---|---:|---|---|
| 1 | `/fixtures?league=39&season=2024` | 200 | `[]` | 380 fixtures recibidos; 380 FT de liga 39 y season 2024 |
| 2 | `/fixtures/statistics?fixture=1208021` | 200 | `[]` | Estadísticas de los dos equipos esperados |

Premier League **2024/25 fixtures: AVAILABLE**. Statistics del fixture seleccionado: **AVAILABLE**. La respuesta de fixtures declaró paging current=1, total=1; no se hizo otra llamada. El proveedor devolvió 380 registros en la única consulta autorizada: se inspeccionaron en memoria y no se guardó el listado ni se ingirió la temporada.

No se solicitó events, lineups u odds. Tampoco se extrapola esta prueba al acceso de Premier League 2025/26, rechazado en la fase anterior.

## Fixture real utilizado

- Provider fixture ID: **1208021**.
- League ID: **39**; provider season: **2024**.
- Manchester United, team ID **33**, vs Fulham, team ID **36**.
- Kickoff: **2024-08-16T19:00:00+00:00**.
- Estado proveedor: **FT**.
- HT: **0–0**; FT: **1–0**.

Se eligió el primer registro devuelto que cumplía FT y coincidencia exacta de league ID/season, con ID numérico real. La segunda respuesta contiene los IDs 33 y 36. No hubo matching por nombre, datos sintéticos ni persistencia del fixture en PostgreSQL.

## Cobertura de campos devueltos

Valores tal como los entrega el proveedor; no se transformaron ausencias en cero. `AVAILABLE` significa valor presente en este fixture, no garantía de cobertura de toda la temporada. `NOT_SUPPORTED` exigiría una declaración explícita del proveedor; no se observó para estos campos. Un valor NULL no demuestra falta de soporte general.

| Campo API | Manchester United | Fulham | Estado |
|---|---:|---:|---|
| Total Shots | 14 | 10 | AVAILABLE |
| Shots on Goal (SOT) | 5 | 2 | AVAILABLE |
| Ball Possession | 55% | 45% | AVAILABLE |
| Corner Kicks | 7 | 8 | AVAILABLE |
| Fouls | 12 | 10 | AVAILABLE |
| Yellow Cards | 2 | 3 | AVAILABLE |
| Red Cards | NULL | NULL | **NULL/MISSING** |
| Shots off Goal | 7 | 4 | AVAILABLE |
| Blocked Shots | 2 | 4 | AVAILABLE |
| Shots insidebox | 7 | 6 | AVAILABLE |
| Shots outsidebox | 7 | 4 | AVAILABLE |
| Offsides | 3 | 1 | AVAILABLE |
| Goalkeeper Saves | 2 | 4 | AVAILABLE |
| Total passes | 482 | 384 | AVAILABLE |
| Passes accurate | 408 | 306 | AVAILABLE |
| Passes % | 85% | 80% | AVAILABLE |
| expected_goals | 2.43 | 0.44 | **AVAILABLE** |
| goals_prevented | 1.07 | 1.07 | AVAILABLE |

**xG sí está disponible** mediante `expected_goals`; sus valores originales son strings `"2.43"` y `"0.44"`. No se calcularon ni imputaron. Las dos cifras iguales de goals_prevented se reproducen sin corregir al proveedor. La respuesta contiene 18 campos por equipo, 17 con valor y uno NULL. No acredita estadísticas por periodo ni permite inferir rojas=0.

## Cuota y consumo observado

| Request | Remaining before | Remaining after, header | Diferencia observada |
|---|---|---:|---|
| 1, fixtures | **98**, última observación de la fase anterior, no medición fresca | **98** | 0 entre observaciones; consumo individual exacto UNKNOWN |
| 2, statistics | **98**, header recibido en request 1 | **97** | 1 entre respuestas consecutivas |

Headers completos de rate limit recibidos:

| Header | Request 1 | Request 2 |
|---|---:|---:|
| x-ratelimit-requests-limit | 100 | 100 |
| x-ratelimit-requests-remaining | 98 | 97 |
| x-ratelimit-limit | 10 | 10 |
| x-ratelimit-remaining | 9 | 8 |

No se recibieron reset, requests-used ni un `requests.current` actualizado. Los números diarios restantes son observaciones del proveedor; no se reetiquetan como contador local. Se desconoce si reflejan consumo anterior/posterior a la llamada o algún otro comportamiento de contabilización. **No se concluye que el primer request sea gratuito**, ni que `/status` o un error de entitlement expliquen por sí solos la diferencia observada en la fase previa. No se gastó una tercera llamada para intentar resolverlo.

El consumo se entiende suficientemente para limitar un piloto de forma conservadora, aunque su instante exacto de descuento no esté demostrado:

- Contar **1 por cada intento enviado**, incluidos errores/timeouts, aunque el header no disminuya. Esta fase cuenta localmente **2**.
- Para el piloto MINIMAL: tope duro **21 intentos**, sin retries ni paginación, y máximo 20 IDs seleccionados del listado.
- Último saldo observado **97**, con amplio margen frente a 21; no es una reserva ni garantiza ausencia de consumo externo posterior. Revalidar vigencia de cuota antes de ejecutar, mantener margen conservador para la petición actual y detener nuevas llamadas si la cuota recibida deja de ser suficiente.
- Respetar límite de **10/minuto**, sin suponer que 21 solicitudes caben en un minuto. La cuota histórica deberá gestionarse separadamente y dentro de la cuota compartida de cuenta; no modificar `ApiFootballBudget`.
- El futuro runner debe implementar esas restricciones antes de ingerir. El GO es de acceso para el alcance MINIMAL, no una afirmación de que ese runner pendiente ya esté operativo.

## Integridad antes/después

Se compararon conteos y SHA-256 de **todas las filas** de cada tabla indicada, ordenadas por clave primaria. No solo conteos. Todas las comparaciones coincidieron.

| Tabla | Antes | Después |
|---|---:|---:|
| Fixture | 503 | 503 |
| Season | 0 | 0 |
| TeamPeriodStats | 0 | 0 |
| HistoricalMarketOutcome | 0 | 0 |
| ProviderEntityMapping | 0 | 0 |
| HistoricalIngestionState | 0 | 0 |
| LiveSnapshot | 4353 | 4353 |
| LiveMarketSnapshot | 17 | 17 |
| ApiFootballBudget | 3 | 3 |

Cero escrituras históricas, outcomes, checkpoints o snapshots. Hash LMS/PIT conservado: `54b085e1ade5c99bb663a242015985307132b94845fe5b3baaa340242d0f10e5`. Hash budget conservado: `dc4372b6bdc127fc75ff902b7eb62a5789b1e085e4c37b290389e34dbc4ae885`. Los 92 archivos protegidos mantienen sus hashes. Sin cambios de schema ni migraciones, BET_SCORE, LIVE, PIT, radar, thresholds o budget híbrido. Sin polling, backtesting ni ML.

## Inspección, cambios y evidencias

MCP primero: `search_graph` para `createProbe`, `quota` y `normalizeApiFootballFixture`. El índice no devolvió los helpers CJS nuevos; se validó directamente el fragmento del helper, la evidencia segura de la fase anterior y nombres de modelos históricos. No se abrieron credenciales ni se alteró código de aplicación.

Único cambio reusable: `createProbe` acepta `maxRequests` entre 1 y 3, mantiene 3 por defecto para la fase anterior y aplica **2** en esta fase. Se añadió una prueba que impide el tercer HTTP y rechaza ampliar el máximo por encima de tres. **9/9 pruebas del diagnóstico OK**; no se presenta la suite completa como reejecutada. No se necesitó nueva validación Prisma/build para este ajuste CJS aislado.

Evidencias locales:

- `historical-2024-access-evidence.json`: resumen seguro de las dos respuestas, fixture seleccionado, campos y headers; no contiene la respuesta completa de la temporada ni la key.
- `historical-2024-before.json`: conteos/hashes iniciales.
- `historical-2024-integrity.json`: comparación antes/después.
- `scripts/lib/provider-capability-check.cjs` y `tests/historical/capabilities.test.cjs`: límite configurable y prueba.

Se creó un ledger propio de fase de forma exclusiva; el contador se guardó antes de cada HTTP y la segunda solicitud retomó el contador 1. Total final **2/2**, sin reiniciar el contador ni reutilizar el presupuesto LIVE.

**GO_FOR_20_FIXTURE_PILOT**: fixtures accesibles, al menos un FT real, estadísticas presentes y un límite conservador de consumo viable. La ejecución del piloto queda fuera de esta verificación y no se inició.
