# Provider capability check

Fecha local: 2026-10-13, America/Guayaquil. Inicio UTC: 2026-10-14T00:16:20.069Z.

**Decisión: NO-GO para ejecutar el piloto real.** Se realizaron exactamente **3 solicitudes HTTP** sin retries, redirects ni paginación. La cuenta permite consultar el catálogo de Premier League 2024/25, pero todavía no se ha probado la lectura de fixtures históricos ni estadísticas de un fixture. No se ejecutó ingesta ni backfill.

## Evidencia local antes del HTTP

Codebase Memory MCP: `get_architecture` sobre `src/providers/football`; `search_graph` para `rawRequest`, `cachedRequest`, `fetchJsonWithResilience`, `reserveApiRequest`; `trace_path` sobre el método cualificado API-Football `rawRequest`. La primera búsqueda no cualificada fue ambigua; se resolvió con el nombre cualificado. La traza estática no mostró callers del método privado, por lo que se validaron sus llamadas en los fragmentos del cliente; no se interpretó el vacío del grafo como ausencia de uso.

Fragmentos consultados: `apiFootball.ts` (constructor, endpoints, debugStatus y rawRequest), `performance.ts` (retries), `historical/scope.ts`, esquema de `ApiFootballBudget`/`HybridApiCache`, referencias al cache del processor y los informes previos de activación/cierre. Se leyó el informe del piloto anterior. No se imprimió `.env` ni ninguna credencial.

- La clave se carga de `process.env.API_FOOTBALL_KEY`, con trim. El diagnóstico usó `@next/env` en la raíz del proyecto. Archivo de entorno encontrado: `.env`; clave configurada.
- Host del cliente: `v3.football.api-sports.io`; header `x-apisports-key`. No RapidAPI.
- `debugStatus()` ya utiliza `/status`, pero pasa por cache/resiliencia con hasta dos intentos. Para respetar el máximo global y evitar hooks LIVE se creó un diagnóstico separado de un solo intento, sin modificar el cliente.
- Endpoints presentes en el cliente: `/status`, `/fixtures`, `/fixtures/statistics`, `/fixtures/events`, `/fixtures/lineups`, `/fixtures/players`, `/odds`, `/odds/live`. Su presencia no prueba entitlement de la cuenta.
- Cache local de `/fixtures` por fecha: directorios 2026-10-08 (149 entradas), 2026-10-09 (467), 2026-10-12 (214), incluyendo resultados FT explícitos. Es evidencia de uso anterior de fixtures por fecha, no de acceso a temporadas antiguas.
- `HybridApiCache` no conserva headers de respuesta. `ApiFootballBudget` conserva `remoteLimit=100` y reservas de días anteriores; no permite inferir cuota remota actual. Solo se leyó, no se reconcilió ni actualizó.
- IDs previamente verificados de la allowlist: 39, 140, 135, 78, 61, 71, 128, 242, 239, 262. Se mantuvo ID **39** en todas las comprobaciones de liga, sin matching por nombre. No se intentaron IDs pendientes de verificación.

## Solicitudes reales y respuestas

Antes de ejecutarlas se mostraron endpoint, propósito, coste esperado 1 y máximo global 3. La tercera se adaptó al rechazo explícito de 2025: se anunció la consulta de 2024 antes de ejecutarla. No se consumió una cuarta solicitud para probar fixtures.

| # | Endpoint | Propósito | HTTP | Resultado |
|---|---|---|---|---|
| 1 | `/status` | Plan, estado, cuota | 200 | Free, active=true, errors=[] |
| 2 | `/leagues?id=39&season=2025` | Entitlement Premier League 2025/26 | 200 | Error de plan explícito |
| 3 | `/leagues?id=39&season=2024` | Alternativa finalizada con el mismo ID verificado | 200 | Catálogo disponible, errors=[] |

Error exacto de la segunda respuesta:

```text
Free plans do not have access to this season, try from 2022 to 2024.
```

La indicación 2022–2024 procede del proveedor. No se probaron todas esas temporadas ni todas las competiciones. No se descargaron fixtures, páginas adicionales ni una temporada completa.

## Quota observada

| Dato | Observación |
|---|---|
| Proveedor / plan | API-Football / Free |
| Cuenta activa | Sí |
| Límite diario | 100 |
| `/status`: requests.current | 0 |
| `/status`: daily remaining | 100 |
| Última respuesta: daily remaining | **98** |
| Usados derivados del último header | 2 = 100 − 98; no es un contador explícito de requests.current final |
| Límite por minuto | 10 |
| Remaining por minuto: primera / última respuesta | 9 / 8 |
| Reset | UNKNOWN: no recibido |
| HTTP realizados por esta fase | **3** |

Headers de la última respuesta:

```text
x-ratelimit-limit: 10
x-ratelimit-remaining: 8
x-ratelimit-requests-limit: 100
x-ratelimit-requests-remaining: 98
```

La respuesta rechazada de 2025 no incluyó headers de rate limit. No se equipara número de HTTP a consumo facturado: se reportan por separado las tres solicitudes y los valores observados del servidor. La cuota es una foto temporal, puede cambiar por uso externo y no se reservó para el piloto. No se modificó `ApiFootballBudget` LIVE.

## Capacidades: metadata versus endpoint probado

| Capacidad | Estado | Evidencia y alcance |
|---|---|---|
| Premier League 2025/26, season=2025 | **NOT_AVAILABLE** | Rechazo explícito del plan en `/leagues` |
| Catálogo Premier League 2024/25, season=2024 | **AVAILABLE** | Liga 39, season 2024 en respuesta sin errors |
| Fixtures históricos de la alternativa | **UNKNOWN** | No se consultó `/fixtures` para season 2024 |
| Fixture statistics históricos | **UNKNOWN** | `coverage.fixtures.statistics_fixtures=true`, endpoint no probado |
| Events históricos | **UNKNOWN** | `coverage.fixtures.events=true`, endpoint no probado |
| Lineups históricos | **UNKNOWN** | `coverage.fixtures.lineups=true`, endpoint no probado |
| Players statistics históricos | **UNKNOWN** | Metadata true, endpoint no probado |
| Estadísticas desglosadas por periodo | **UNKNOWN** | No acreditadas por la metadata obtenida |
| Odds históricas 2024/25 | **NOT_AVAILABLE según metadata** | `coverage.odds=false`; `/odds` no consultado |
| Odds live | **UNKNOWN** | Endpoint existe en código, no probado en esta fase |
| Otras competiciones / temporadas completas | **UNKNOWN** | No se extrapola del ID 39 |

La temporada alternativa declara inicio **2024-08-16** y fin **2025-05-25**. Está finalizada por fecha. Cobertura declarada no garantiza datos por cada fixture ni autoriza asumir que un endpoint de detalle devolverá datos. La disponibilidad histórica tampoco implica acceso a odds.

## Coste aproximado para 20 fixtures

Estimación estructural usando endpoints reales del cliente, **no solicitudes ejecutadas ni cobertura garantizada**. Supone un listado `/fixtures` que alcanza 20 fixtures, una llamada por fixture y endpoint de detalle, cero retries/cache y ninguna página extra. Ventanas separadas o paginación aumentarían el coste y requerirían otro plan; esta fase no las ejecuta.

| Escenario | Endpoints | Requests estimados |
|---|---|---:|
| MINIMAL | 1 listado `/fixtures` + 20 `/fixtures/statistics` | **21** |
| STANDARD | MINIMAL + 20 `/fixtures/events` | **41** |
| FULL hipotético | STANDARD + 20 `/fixtures/lineups` + 20 `/odds` | **81**, si odds existieran y bastara una página |
| FULL sin odds no disponibles | STANDARD + 20 `/fixtures/lineups` | **61**, cobertura incompleta respecto a FULL |

Para esta alternativa, **FULL con odds no es ejecutable según la metadata**. No se sustituye `/odds` por `/odds/live`, ni se infieren odds antiguas. El número 81 es solo un escenario condicional, no una capacidad verificada. Que el último header indique 98 restantes no reserva esa cuota ni reemplaza la cuota histórica persistente pendiente. Se conserva el NO-GO.

## Integridad y pruebas

El diagnóstico no importa Prisma, worker, normalizadores con escritura, clientes LIVE ni budget híbrido. Conserva solo un resumen seguro en `provider-capability-observations.json`; no guarda información personal de cuenta ni clave. El ledger se crea de forma exclusiva y bloquea una segunda ejecución accidental. La continuación de la tercera llamada partió del contador persistido 2; lo incrementó y guardó antes del HTTP. No se borró ni reinició ese contador.

Comparación de BD antes/después en `capability-check-integrity.json`:

| Tabla | Antes | Después |
|---|---:|---:|
| Fixture | 503 | 503 |
| TeamPeriodStats | 0 | 0 |
| HistoricalMarketOutcome | 0 | 0 |
| HistoricalIngestionState | 0 | 0 |
| LiveSnapshot | 4353 | 4353 |
| LiveMarketSnapshot | 17 | 17 |
| HybridScout | 47 | 47 |
| ApiFootballBudget | 3 | 3 |

Hashes de LMS/PIT, budget y checkpoints idénticos antes/después. Los 92 archivos protegidos conservan sus hashes. Cero fixtures históricos insertados, cero period stats, cero outcomes y cero checkpoints de ejecución real. No hubo escrituras DB desde esta fase.

**50/50 pruebas ejecutadas, 0 fallos:** 42 existentes de foundation/adapter y 8 nuevas del diagnóstico. Nuevas: UNKNOWN no soportado, máximo concurrente global 3, continuidad del contador, fallos sin retries, cuota desconocida bloquea backfill, cuota conservadora, odds no inferidas y ausencia de dependencias LIVE/budget con redirects deshabilitados. Evidencia: `provider-capability-tests.txt`.

Las 201 pruebas de la fase previa no se vuelven a presentar como ejecutadas aquí; el catálogo suma 209 al añadir estas ocho. Se validó sintaxis del CLI con `node --check`. No se ejecutaron build/Prisma nuevamente porque solo se añadieron herramientas CJS, pruebas y reportes; no cambió código de aplicación, schema ni migraciones. El build y Prisma previamente OK siguen siendo evidencia de la fase anterior, no una nueva ejecución.

## Entrega y decisión

Archivos añadidos: `scripts/lib/provider-capability-check.cjs`, `scripts/historical-capability-check.cjs`, `tests/historical/capabilities.test.cjs` y reportes/evidencias de esta fase. Sin modificaciones a schema, migraciones, package.json, cliente LIVE, BET_SCORE, ENTRY/NO_ENTRY, thresholds, radar, PIT o budget. Sin polling adicional, backtesting ni ML.

**Alternativa recomendada para la siguiente verificación:** Premier League, provider ID 39, **2024/25 (season=2024)**. Se recomienda verificar un fixture y su estadística antes de plantear ingesta, no ejecutar el piloto ahora. El transporte histórico y la cuota persistente independiente siguen pendientes de la fase anterior.

**NO-GO para piloto real.** Entitlement 2025/26 rechazado; alternativa encontrada en catálogo, pero fixtures históricos y detalle aún UNKNOWN. Se alcanzó el máximo de 3 HTTP y se detuvo la verificación sin ingerir datos.
