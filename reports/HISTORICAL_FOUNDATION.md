# Base histórica incremental — FUT

Fecha: 2026-10-13. Continúa `HISTORICAL_ML_SCHEMA_AUDIT.md` y `POINT_IN_TIME_DATA_INTEGRITY.md`.

## 1. Resultado y límite de esta fase

Se implementó una base histórica separada de la web, sobre la **misma PostgreSQL**, con clasificación estructurada, allowlist por IDs, temporadas textuales, estadísticas por periodo, outcomes, mappings y checkpoints persistentes. **186/186 pruebas pasan**; builds web y worker, Prisma validate/generate/migrate status correctos.

El worker actual procesa **lotes normalizados ya disponibles**, mediante archivo y una invocación acotada. Su transporte HTTP no está conectado ni habilitado. Esto permite probar persistencia, reintentos y concurrencia sin consumir cuotas de proveedores. Existe un adaptador puro para payloads API-Football de fixture/statistics; no se presenta esta fase como un descargador de temporadas ya operativo.

Se ejecutó únicamente un dry-run con un fixture sintético y pruebas sobre PostgreSQL temporal. **0 requests reales, 0 ingestiones históricas en la base real, 0 entrenamiento, 0 backtesting, 0 picks.** No hubo scraping ni descarga masiva. El ejemplo sintético está marcado y el worker prohíbe escribirlo incluso con `--write`.

## 2. MCP y arquitectura

Antes de abrir código se consultó Codebase Memory MCP:

- `get_architecture`: dependencies, entry_points y layers de FUT.
- `search_graph`: `syncFixture`, `syncHistoricalTeamData`, `upsertLeague`, `upsertTeam`, `saveEvents`, `pointInTimeFeatures`, `matchFixture`.
- `trace_path`, inbound/outbound, profundidad 2: `syncHistoricalTeamData` y `persistMatchDetail`.
- `detect_changes`, scope impact, profundidad 1. El diff global incluía cambios de fases anteriores; no se atribuyeron a esta fase.

Hallazgo decisivo: `persistMatchDetail` también llama a `saveLiveSnapshot` y `observeLiveMarketDataset`/HybridScout. **No es un writer adecuado para el worker histórico.** Se reutilizan sus entidades, pero no se invocan sus hooks ni los métodos de proveedor que los ejecutan.

Se abrieron fragmentos de `prisma/schema.prisma`, `footballPersistence.ts`, `hybrid/budget.ts`, `tests/register-typescript.cjs`, `package.json`, `.gitignore` y el informe previo. La identificación de IDs se hizo leyendo el directorio API-Football ya persistido; no mediante una consulta nueva al proveedor. Los archivos protegidos se compararon mediante hashes.

```text
Proceso web / Next
  AllSports → persistencia y radar existentes → LIVE / híbrido / PIT
  [sin imports nuevos hacia historical]

Proceso historical-worker, mismo repositorio
  archivo HistoricalBatch ya normalizado
    → validateBatch / scopeBinding / classifyCompetition
    → dry-run (sin DB, sin HTTP)
    o
    → claim persistente por provider + competición + temporada
    → transacción de una página, deduplicación y validación
    → entidades existentes + period stats + outcomes
    → commit del checkpoint junto con los datos

Futuro transporte autorizado
  proveedor configurado → HistoricalPageSource → HistoricalBatch
  [no conectado en esta fase]
```

No hay timers, cron, polling, proceso daemon nuevo ni endpoint web histórico. El proceso separado limita su pool a **2 conexiones** y no bloquea `/live-goal-radar` mediante una dependencia de ejecución. Como cualquier proceso sobre la misma DB, una carga futura comparte recursos PostgreSQL; por eso se acotan páginas y transacciones.

## 3. Schema y migración

Migración aditiva aplicada: **`20261013193000_historical_foundation`**. Primero se aplicó sobre una base temporal con el esquema previo y sus cinco registros de migración; después sobre la PostgreSQL actual. Ahora hay **6 migraciones aplicadas**, sin pendientes.

La migración está en una transacción y usa `lock_timeout=5s`. Solo crea enums, tablas, campos, índices, FKs y checks. No hace UPDATE de historia, DROP, reset ni db push. El índice nullable nuevo de odds no reinterpreta ni rellena las filas antiguas.

### Modelos nuevos

| Modelo | Motivo / identidad |
|---|---|
| `Season` | Dimensión de temporada por League y clave textual; unique `(leagueId,key)` |
| `TeamPeriodStats` | Métricas por fixture/equipo/provider/periodo; unique en esas cuatro columnas |
| `HistoricalMarketOutcome` | Resultado histórico de una especificación de mercado; unique `(fixtureId,provider,marketKey)` |
| `ProviderEntityMapping` | Vínculo externo entre dos proveedores para competition/team/fixture; unicidad uno-a-uno por par de proveedores |
| `HistoricalIngestionState` | Checkpoint, lease y contadores por `(provider,leagueId,seasonId)` |

### Modelos existentes modificados

- `League`: `classification` enum, default UNKNOWN; `classificationSource`, `classificationEvidence`; relaciones de temporadas/ingestión.
- `Fixture`: `seasonId` nullable, relación a Season, relaciones de stats/outcomes e índice `(leagueId,seasonId,kickoff)`.
- `Team`: relación a period stats; no columna nueva en su tabla.
- `OddsSnapshot`: `receivedAt`, `marketPeriod`, `provider`, `sourceHash` nullable; unique de sourceHash. Las filas previas permanecen con NULL en esas columnas.

Se reutilizan **Fixture, League, Team, Player, TeamMatchStats, PlayerMatchStats, Lineup, MatchEvent, Bookmaker y OddsSnapshot**. No se creó una segunda familia de partidos/equipos/eventos. `TeamMatchStats` conserva su unique y sus consumidores actuales; la tabla nueva proporciona periodos/provenance sin cambiar ese contrato. FULL_TIME se refleja en ambas para compatibilidad y consulta uniforme por periodos.

## 4. Clasificación de competición

Enum persistido en League:

`MEN_SENIOR | WOMEN | YOUTH | RESERVE | UNKNOWN`

Orden de decisión en `scope.ts`:

1. Metadata estructurada del proveedor: género femenino, categoría juvenil o reserve=true excluyen la competición.
2. Metadata explícita male + senior/adult + reserve=false puede confirmar MEN_SENIOR.
3. Un nombre con marcadores de mujeres/juveniles/reservas es una exclusión conservadora, incluso ante una identidad configurada contradictoria.
4. Metadata no reconocida produce UNKNOWN; no se ignora para lograr admisión.
5. Fallback positivo únicamente con **binding curado de provider ID + nombre normalizado exacto + país exacto**. Ausencia de palabras como Women/U21 no significa MEN_SENIOR.

Fuente persistida: `PROVIDER_METADATA` o `CURATED_ID_COUNTRY_NAME_FALLBACK` para las competiciones admitidas; se conserva la metadata utilizada en JSON. Las ligas preexistentes no fueron clasificadas masivamente: quedan UNKNOWN por default. Los lotes WOMEN/YOUTH/RESERVE/UNKNOWN se rechazan antes de crear fixtures; no se reetiqueta una liga real a partir de un lote rechazado.

## 5. Allowlist inicial

Configuración explícita: `src/services/historical/scope.ts:HISTORICAL_SCOPE`.

Los diez IDs indicados se observaron en directorios API-Football ya persistidos, con los siguientes nombres y países. El fallback positivo corresponde a las competiciones senior especificadas por el usuario, no a una heurística abierta de nombres.

| Scope | Provider | ID | Nombre / país exactos | Estado de binding |
|---|---|---:|---|---|
| Premier League | API-Football | 39 | Premier League / England | Verificado localmente |
| La Liga | API-Football | 140 | La Liga / Spain | Verificado localmente |
| Serie A | API-Football | 135 | Serie A / Italy | Verificado localmente |
| Bundesliga | API-Football | 78 | Bundesliga / Germany | Verificado localmente |
| Ligue 1 | API-Football | 61 | Ligue 1 / France | Verificado localmente |
| UEFA Champions League | API-Football | NULL | UEFA Champions League / World | Bloqueado: falta verificar ID |
| UEFA Europa League | API-Football | NULL | UEFA Europa League / World | Bloqueado: falta verificar ID |
| Brazil Serie A | API-Football | 71 | Serie A / Brazil | Verificado localmente |
| Argentina Primera División | API-Football | 128 | Liga Profesional Argentina / Argentina | Verificado localmente |
| Ecuador LigaPro | API-Football | 242 | Liga Pro / Ecuador | Verificado localmente |
| Colombia Primera A | API-Football | 239 | Primera A / Colombia | Verificado localmente |
| Liga MX | API-Football | 262 | Liga MX / Mexico | Verificado localmente |

Un ID verificado no activa HTTP. El worker exige simultáneamente binding y clasificación MEN_SENIOR. Un nombre idéntico con otro ID/provider/país no pasa. Dos bindings coincidentes son ambiguos y se rechazan.

No se inventaron los IDs faltantes. Los registros AllSports existentes carecían de país/metadata suficiente para vincularlos con seguridad solo por nombre; por eso no se habilitó ningún binding histórico AllSports. AllSports continúa siendo la fuente principal LIVE, sin cambios.

## 6. Temporadas

Los campos `League.season Int?` y `Fixture.season Int?` no bastan: la ingesta web actual asigna a Fixture el año del kickoff, que no demuestra la temporada oficial.

Se conservaron esos campos y su writer web sin modificaciones. La ruta histórica no deriva ni escribe ese entero a partir del kickoff. Usa `Season.key` y `Season.label` textuales, por ejemplo:

- `2026`
- `2026/27`
- `Apertura 2026`
- `Clausura 2026`

`providerSeasonId` conserva opcionalmente el identificador requerido por el proveedor; no tiene que coincidir con la etiqueta visible. `startsAt`/`endsAt` son opcionales y deben ser fechas coherentes. No se fabrican límites de temporada.

La clave se normaliza NFKC y trim; Apertura/Clausura y temporadas divididas no se colapsan al mismo entero. El fixture debe declarar exactamente la temporada del lote. Los Fixtures antiguos conservan seasonId=NULL; no se reinterpretó historia automáticamente.

## 7. Mapping de proveedores

`mapping.ts` ofrece resolución y persistencia para COMPETITION, TEAM y FIXTURE.

Prioridad:

1. `ProviderEntityMapping` persistido; para fixtures AllSports/API-Football también consulta el mapping ya existente en HybridScout.
2. ID destino conocido y verificado por el llamador, o el mismo provider ID dentro del mismo proveedor.
3. Identidad normalizada exacta: NFKC, minúsculas, trim y espacios. Sin distancia difusa ni eliminación de sufijos de edad/equipo.
4. Fixture: home y away exactos y orientados, misma clave canónica de competición y kickoff con tolerancia máxima **±5 minutos**.
5. Competition: nombre y país exactos. Team: nombre exacto y contexto exacto de competición.

Múltiples candidatos → NO MATCH. Un mapping persistido contradictorio con la identidad actual no autoriza fusionar. La tabla ordena los proveedores de forma canónica y tiene dos restricciones unique, una por cada dirección, evitando un segundo destino para la misma identidad. Se conserva método y evidencia.

La tabla es un registro de IDs externos polimórfico, no una FK a tres tablas a la vez. No elimina ni consolida físicamente entidades de diferentes proveedores. El worker escribe en el namespace original `(provider,externalId)`; una consulta cross-provider futura deberá usar los vínculos explícitos. Esta fase no crea mappings reales ni modifica HybridScout/certificados.

## 8. Datos históricos y period stats

Solo se admiten fixtures normalizados FINISHED, con score FT explícito y conocido, identidad y kickoff dentro del scope/rango del lote. Un fixture existente LIVE/HT/no finalizado se rechaza: el worker no lo cierra, no cambia su score ni dispara hooks. Un payload con recibo anterior al `providerUpdatedAt` persistido también se rechaza.

Periodos soportados:

`FIRST_HALF`, `SECOND_HALF`, `FULL_TIME`, `MIN_0_15`, `MIN_16_30`, `MIN_31_45_PLUS`, `MIN_46_60`, `MIN_61_75`, `MIN_76_90_PLUS`.

Cada fila TeamPeriodStats contiene goals, shots, shotsOnTarget, xg, corners, yellowCards, redCards, fouls, possession y dangerousAttacks, además de provider, source y receivedAt. **Todos los valores pueden ser NULL**. Conteos no negativos; possession entre 0 y 100; xG decimal. No hay decenas de columnas nuevas en Fixture.

- FT stats solo alimentan FULL_TIME; no se copian a HT/2H.
- El adaptador API-Football acepta únicamente estado FT de tiempo reglamentario, no AET/PEN como si fueran 90 minutos.
- Goles FIRST_HALF provienen del score halftime explícito.
- Únicamente los goles de SECOND_HALF pueden derivarse como FT−HT, con ambos scores explícitos, no negativos y source que documenta la derivación. No se resta xG/tiros/corners sin cobertura por periodo.
- Los seis intervalos solo se escriben si el lote los aporta explícitamente. No se inventan distribuyendo el total FT ni usando minutos ambiguos de eventos.
- `N/D`, ausencia, cadena vacía, booleanos y números inválidos se normalizan a NULL mediante la validación compartida. Un cero explícito sigue siendo cero.

Events y players/lineups se suministran ya normalizados en el contrato de lote; el adaptador puro de fixture/statistics no afirma normalizar todos los endpoints del proveedor. Eventos se deduplican por fixture/provider event ID mediante sourceHash. No se crea Lineup con starter=false para representar una titularidad desconocida: sin booleano explícito no se inserta esa alineación.

Las tablas históricas son hechos finales actualizables, no un nuevo almacén universal de revisiones as-of. Sus recibos no demuestran disponibilidad anterior a la recepción local. No deben añadirse como features de una decisión LIVE pasada mediante joins actuales.

## 9. Outcomes genéricos

`HistoricalMarketOutcome` separa market, period, selection, side, line y rules. `marketKey` es la serialización determinista de esas dimensiones. No incluye cuota ni recomendación. Estados: WIN, LOSS, PUSH, VOID, UNKNOWN.

Por defecto se resuelven ocho especificaciones:

- OVER 0.5 y 1.5 FIRST_HALF.
- OVER 0.5, 1.5 y 2.5 FULL_TIME.
- BTTS YES FULL_TIME.
- TEAM OVER 0.5 FULL_TIME para HOME y AWAY.

CORNERS y CARDS se resuelven al aportar una especificación con periodo y línea; no se inventa una línea universal. Para tarjetas se exige regla explícita `YELLOW_ONLY`, `RED_ONLY` o `YELLOW_PLUS_RED`. Si el mercado del proveedor usa otra convención, debe normalizarse/verificarse antes; una regla no soportada da UNKNOWN.

Líneas enteras soportan PUSH; medias líneas WIN/LOSS; quarter lines quedan UNKNOWN porque el enum pedido no incluye HALF_WIN/HALF_LOSS. VOID requiere indicación explícita en la especificación, no una inferencia por dato faltante. Score/estadística ausente → UNKNOWN. HT y FT permanecen separados, sin usar el final como sustituto de halftime.

Estos resultados no generan picks, apuestas, alerts ni modificaciones de labels/features de LiveMarketSnapshot. Se conservan exclusivamente como outcomes históricos independientes.

## 10. Odds

Se reutiliza OddsSnapshot con campos adicionales nullable de trazabilidad. La ruta histórica usa el parser conservador `parseGoalTotal` y `timestampIssue` ya implementados para integridad temporal.

- Solo acepta los formatos de totales de goles con periodo explícito reconocidos por ese parser; otras cuotas se omiten, no se adivinan.
- Línea y precio vienen de dimensiones distintas; no se usa el antiguo `extractLine(market + selection)`.
- provider timestamp <= local receivedAt <= recibo del lote. Una cuota recibida hoy no se vuelve disponible ayer por tener un timestamp de proveedor antiguo.
- sourceHash incluye proveedor/fixture/bookmaker/especificación y ambos relojes, haciendo idempotente la repetición de la misma cotización recibida.
- No se rellenan las columnas nuevas en las 785.057 odds anteriores ni se reparan offsets/líneas históricas.

El writer y las reglas de cuotas consumidas por el radar siguen intactos. Las nuevas cuotas históricas no se presentan como cuotas disponibles en un snapshot LIVE anterior.

## 11. Control de ingestión

Estado persistente por proveedor/League/Season:

- `rangeFrom`, `rangeTo`: último rango de lote reclamado/procesado. En esta fase describe el lote recibido, no acredita un HTTP remoto realizado.
- `cursor`, `lastBatchKey`: progreso y huella de la página.
- `lastRunAt`, `lastSuccessAt`, `lastError` sanitizado.
- `fixturesFound`, `fixturesInserted`, `fixturesUpdated`, `fixturesRejected`: contadores acumulados de páginas confirmadas.
- `status`: READY, RUNNING, SUCCEEDED o FAILED.
- `retryCount`: errores acumulados, conservados tras un éxito y reinicio.
- `leaseToken`, `leaseUntil`: exclusión y recuperación de proceso caído.

Operación:

1. Validación de allowlist, categoría, temporada, rango pasado de máximo **7 días**, máximo **50 fixtures** y límites de detalles por fixture.
2. Advisory lock breve para reclamar el scope; lease persistente de **120 s**.
3. Transacción por página con row lock y fencing del token. Timeout **30 s**; sin HTTP dentro de la transacción.
4. Datos y checkpoint se confirman juntos. Fallo a mitad de página revierte todas sus filas y conserva el cursor anterior; luego se registra FAILED/retryCount sin volcar secretos.
5. Repetir un rango finalizado devuelve ALREADY_DONE. Un cursor antiguo devuelve STALE_CURSOR. Otro proceso con lease activo devuelve BUSY.
6. Un rango nuevo solo avanza después de terminar el anterior y sin solaparlo. Los contadores no se reinician. Un lease expirado puede retomarse desde otra instancia.

No hay reintento automático en bucle ni estado de progreso exclusivamente en memoria. Los upserts y uniques de hechos son una segunda defensa de idempotencia. El recibo de un replay no se utiliza para actualizar hechos más recientes.

## 12. Cómo iniciar y hacer dry-run

Desde el repositorio, con Node 22 y dependencias instaladas:

```powershell
npm.cmd run historical:build
npm.cmd run historical:worker -- --input tests/historical/example-batch.json --dry-run
```

`--dry-run` es el comportamiento predeterminado: se puede omitir. No carga credenciales, no abre Prisma ni hace HTTP. El ejemplo tiene `synthetic=true`; `--write` lo rechaza antes de acceder a la base.

Resultado observado del ejemplo: `fixturesFound=1`, `uniqueFixtures=1`, `accepted=1`, `requests=0`, clasificación MEN_SENIOR por metadata estructurada.

Para un **lote normalizado real ya disponible y autorizado**, el proceso preparado es:

```powershell
npm.cmd run historical:worker -- --input <lote-normalizado-real.json> --dry-run
# Solo cuando corresponda autorizar su persistencia:
npm.cmd run historical:worker -- --input <lote-normalizado-real.json> --write
```

No se ejecutó ese modo sobre datos reales durante esta fase. `--write` carga DATABASE_URL sin imprimirla, usa Prisma y termina al concluir una página. Compilación independiente en `.historical-build`, ignorada por Git; no depende de un loader de tests al ejecutar el worker compilado.

La web puede arrancarse separadamente con su comando habitual. No se añadió un mecanismo que arranque automáticamente ambos procesos. Next quedó detenido después de liberar la DLL de Prisma; no se reinició para evitar tráfico incidental.

## 13. Pruebas y validación

**Total final: 186 pruebas, 186 PASS, 0 FAIL, 0 skipped.**

| Suite | Pruebas |
|---|---:|
| radar-review-now | 14 |
| radar-hybrid-review | 28 |
| training/features | 32 |
| training/hybrid | 17 |
| training/point-in-time | 24 |
| training/persistence PostgreSQL | 12 |
| training/hybrid.persistence PostgreSQL | 19 |
| historical/foundation | 27 |
| historical/persistence PostgreSQL | 13 |

Se conservan las 146 pruebas anteriores y se añaden **40**. Cobertura nueva: MEN_SENIOR admitido; WOMEN/YOUTH/RESERVE/UNKNOWN excluidos; metadata y fallback; allowlist/IDs pendientes; temporadas textuales; N/D/NULL; aislamiento HT/FT e intervalos; goals/BTTS/team/corners/cards; PUSH/VOID/UNKNOWN; deduplicación; ambigüedad/mapping persistido; dry-run sin DB/HTTP; bloqueo de escritura de mocks; rollback parcial; retry/checkpoint/reinicio; concurrencia entre clientes; lease expirado; avance incremental; LIVE no cerrado; snapshot PIT completo sin cambios; cuotas con relojes correctos.

Las suites DB corrieron en `fut_historical_test_20261013`, base temporal con esquema copiado sin datos reales. La suite histórica exige ese prefijo y se niega a ejecutarse sobre la base actual. Las suites anteriores corrieron antes de introducir los registros sintéticos históricos. El log final contiene 173 pruebas del primer grupo y 13 de persistencia histórica: `historical-foundation-tests.txt`.

- `prisma validate`: OK.
- `prisma generate`: OK. Se liberó la DLL deteniendo únicamente Next de FUT, procesos 14488 y 19816 identificados por ruta.
- `prisma migrate status`: 6 migraciones, schema up to date.
- `npm run historical:build`: OK.
- `npm run build`: OK, incluidos tipos y generación de páginas.
- Guard `tests/no-provider-http.cjs` durante pruebas y build web; HTTP de tests simulado.

## 14. Preservación de la base y de LIVE

Comparación antes/después de aplicar la migración en la base real:

| Dato | Antes | Después |
|---|---:|---:|
| LiveMarketSnapshot | 17 | 17 |
| LiveSnapshot | 4.353 | 4.353 |
| Fixture | 503 | 503 |
| OddsSnapshot | 785.057 | 785.057 |
| Season / TeamPeriodStats / HistoricalMarketOutcome / ProviderEntityMapping / HistoricalIngestionState nuevas | No existían | 0 en cada tabla |

SHA-256 de los 17 LMS completos ordenados por id, idéntico:

`54b085e1ade5c99bb663a242015985307132b94845fe5b3baaa340242d0f10e5`

Los contadores API-Football existentes siguen en 3/2/5 requests para los días 2026-10-08/09/12; ningún presupuesto real fue reservado. Se compararon **92 archivos protegidos** en providers, training/PIT/hybrid, análisis, librerías, rutas y componentes: **0 cambios**. Evidencia: `historical-foundation-verification.json` y manifest de hashes previo.

Por tanto: BET_SCORE, ALERT/NO ALERT, ENTRY/NO_ENTRY, thresholds, radar, AllSports principal, presupuesto, processor LIVE y contrato PIT permanecen intactos. El worker no llama ni actualiza LiveSnapshot/LiveMarketSnapshot. Los datos históricos finalizados pueden resolver sus outcomes propios, nunca modificar retrospectivamente features LIVE.

## 15. Archivos de esta fase

Nuevos:

- `src/services/historical/scope.ts`
- `src/services/historical/types.ts`
- `src/services/historical/normalize.ts`
- `src/services/historical/mapping.ts`
- `src/services/historical/outcomes.ts`
- `src/services/historical/validation.ts`
- `src/services/historical/persistence.ts`
- `src/services/historical/worker.ts`
- `scripts/historical-worker.cjs`
- `tsconfig.historical.json`
- `tests/historical/fixtures.cjs`, `foundation.test.cjs`, `persistence.test.cjs`, `example-batch.json`
- `prisma/migrations/20261013193000_historical_foundation/migration.sql`
- Este informe, log de pruebas, verificación DB y manifests de evidencia previos.

Modificados: `prisma/schema.prisma`, `package.json` (scripts) y `.gitignore` (salida compilada del worker). No se modificó código de los flujos protegidos.

## 16. Siguiente paso para una primera carga real

1. Elegir **una** competición vinculada y una temporada oficial; verificar cobertura histórica de fixture/statistics/eventos y permisos del plan. Resolver IDs pendientes solo mediante metadata confiable, no por nombre ambiguo.
2. Preparar un transporte `HistoricalPageSource` para el proveedor configurado, fuera de los métodos web con side effects. El adaptador actual normaliza respuestas suministradas; **la descarga HTTP sigue pendiente y deshabilitada**.
3. Antes de habilitarlo, definir/reservar un cupo histórico persistente coordinado con la cuenta real. No crear otro contador que permita superar el límite compartido ni consumir la reserva LIVE/outcomes. Estimar endpoints y requests del piloto; no asumir que todos los detalles vienen en una llamada.
4. Ejecutar dry-run de un rango pequeño y revisar categoría, temporada, IDs, NULL, periodos, timestamps, mappings y número de fixtures.
5. Tras autorización del piloto, escribir una sola página, comprobar conteos/provenance/outcomes y replay idempotente. Solo después plantear expansión incremental.

Esta fase termina sin iniciar esos pasos de red, sin ML, sin backtesting y sin recolección masiva.
