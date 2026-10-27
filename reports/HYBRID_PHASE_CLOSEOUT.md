# Cierre de la estrategia híbrida — 8 de octubre de 2026

Implementación y validación terminadas. API-Football automático DESACTIVADO. Cero solicitudes reales a API-Football durante implementación, simulación y cierre. No se inicia un servidor, timer, cron ni procesador al terminar.

## MCP y alcance

Se usaron `get_architecture`, `search_graph`, `search_code`, `trace_path` (inbound/outbound), `detect_changes`, `check_index_coverage`, `get_code_snippet` e `index_repository`. Fue necesario reindexar porque el índice inicial no conocía los módulos nuevos. El grafo muestra el hook local desde `persistMatchDetail` a `observeLiveMarketDataset` y `recordHybridScout`. `runHybridBatch` no tiene caller de producción; se comprobó también con búsqueda textual. El grafo no resuelve todos los enlaces de callbacks/inyección de dependencias.

MCP marca un parseo parcial en la línea 18 de `hybrid/budget.ts` (SQL etiquetado). Se revisó ese fragmento directamente; las pruebas PostgreSQL, TypeScript y el build verifican su ejecución. Migraciones, `.env` y reportes están excluidos del índice por configuración; no se tomó ausencia de nodos como prueba de ausencia de código.

Archivos consultados por símbolos, fragmentos o búsquedas puntuales:

- `src/providers/football/apiFootball.ts`, `src/providers/index.ts`, `src/types/domain.ts`.
- `src/services/persistence/footballPersistence.ts`.
- `src/services/training/observation.ts`, `features.ts`, `periodEvidence.ts`, `liveMarketSnapshots.ts`, `monitoring.ts`, `telemetry.ts`.
- `src/services/training/hybrid/policy.ts`, `scout.ts`, `budget.ts`, `processor.ts`, `simulation.ts` (nuevos).
- `prisma/schema.prisma` y la migración `20261008160000_hybrid_period_budget/migration.sql` (nueva).
- `package.json`, `.env.example`, `scripts/dataset-status.cjs`, `scripts/simulate-hybrid.cjs` (nuevo).
- `tests/register-typescript.cjs`, `tests/training/features.test.cjs`, `persistence.test.cjs`, los tres archivos `hybrid*` nuevos y `tests/no-provider-http.cjs`.
- Logs de validación y este reporte. Los archivos de apuestas/radar se comprobaron por hash, sin reescribirlos.

El diff del repositorio ya contenía muchas modificaciones antes de esta fase. No se atribuye ese diff completo a la implementación híbrida.

## Flujo y tablas

AllSports conserva el proveedor principal y sus solicitudes existentes. El hook de dataset recibe su observación estricta: score explícito, datos recientes y estadísticas con ausencias NULL. Los potenciales LIVE 0-0 entre minutos 8 y 40 se guardan en `HybridScout` como `PENDING_PERIOD_CONFIRMATION`. Esto no convierte `event_status="17"` en FIRST_HALF ni cambia una decisión de apuesta.

`HybridScout` conserva identidad, observación, referencia a LiveSnapshot, prioridad, mapping uno-a-uno, certificado, invalidación irreversible y contadores de intentos. `ApiFootballBudget` conserva las reservas de consumo por día UTC. `HybridApiCache` conserva directorios de fixtures, admisiones diarias y el lock temporal del batch. Son tablas aditivas; no se borraron datos de aplicación.

La ingestión local no hace HTTP. Solo puede reutilizar un certificado ya persistido. `runHybridBatch` es una función bajo invocación explícita, sin ruta, cron ni timer. Requiere además `API_FOOTBALL_HYBRID_ENABLED=true`, `authorized=true` y una proyección dentro del presupuesto. El switch efectivo es falso; no existe invocación automática. No basta con reiniciar la app para activar el procesador.

El cliente mínimo reutiliza el cliente API-Football y solo permite parámetros `date` o `id` sobre `/fixtures?timezone=UTC`. No solicita statistics, events, lineups, players, odds ni odds/live. Su cache HTTP dura 3 minutos y no renueva el receipt al leerlo; el certificado de periodo tiene una política distinta. Los errores no provocan reintentos automáticos.

## Matching final

1. Se prefiere `apiFootballFixtureId` persistido para el `allSportsFixtureId`/fixture local. Se vuelve a validar que la identidad recibida sea compatible.
2. Sin mapping, se consulta un directorio por fecha UTC de kickoff; se conserva 15 minutos. Los directorios antiguos sirven para identidad, no para extender evidencia vencida.
3. Home y away deben coincidir exactamente, en el mismo orden, tras NFKC, minúsculas, trim y compactación de espacios. No se eliminan FC, U21, femenino, reservas, puntuación ni tokens; no hay fuzzy matching.
4. Kickoff debe estar dentro de ±5 minutos y la liga normalizada también debe coincidir exactamente.
5. Más de un fixture API compatible significa NO MATCH. Dos scouts AllSports compatibles con la misma identidad también se rechazan antes de gastar una consulta. Los índices únicos impiden asignar un fixture API a dos fixtures AllSports.
6. Cambios posteriores de identidad invalidan la evidencia; no se reasigna el mapping silenciosamente.

La mayor cobertura de estadísticas AllSports tiene prioridad. Es una prioridad de consumo API, independiente de BET_SCORE y de los thresholds de apuestas.

## TTL y continuidad

Se eliminó la combinación incoherente de TTL 3 minutos y cooldown 15 minutos. La regla final es:

- TTL máximo de periodo: **10 minutos** desde el receipt API original.
- Próxima validación: **ese mismo receipt +10 minutos**, incluso si el certificado procede de un directorio cacheado. Leer el cache nunca renueva el reloj.
- Máximo de **4 intentos de validación por fixture** y **10 fixtures nuevos admitidos por día UTC**. Las admisiones sobreviven al reinicio.
- Vencimiento anticipado al alcanzar la proyección del minuto **43**. No se captura con minuto AllSports >=43 ni se admiten scouts nuevos después del 40. Este corte deliberado próximo al descanso puede dejar una ventana sin captura, pero no crea el hueco generalizado de 12 minutos.
- AllSports debe seguir LIVE, 0-0 confirmado, con receipt de como máximo 3 minutos; reloj y avance deben ser compatibles con el certificado. Se rechazan reloj congelado, regresiones/saltos incompatibles, score desconocido y observaciones futuras.
- HT, 2H, FT, gol, identidad contradictoria o estado no LIVE invalidan el certificado. Una respuesta antigua no lo puede reabrir.

La política mantiene continuidad para los fixtures admitidos si el procesador se invocara a tiempo y la API respondiera. No promete cobertura continua ante presupuesto agotado, fallos, ambigüedad o falta de datos. El batch sigue desactivado.

## Presupuesto exacto

El plan real comprobado previamente es Free: **100 requests/día**. Este cierre no volvió a consultar la cuenta.

- `API_FOOTBALL_DAILY_BUDGET`: **80 por defecto**, limitado por código a un máximo de 80. Valores inválidos bloquean consumo; 0 lo deshabilita.
- Las validaciones se detienen cuando el consumo conocido llega a **60** (80 menos reserva de 20). No pueden gastar la reserva.
- Los outcomes pendientes tienen prioridad y pueden utilizar el presupuesto restante hasta **80**. Los 20 son una reserva mínima protegida frente a validaciones, no un techo separado para outcomes.
- Quedan **20 del plan fuera del presupuesto automático** para uso manual/diagnóstico. Las llamadas de otros procesos o aplicaciones no están bajo control de esta cola; los headers recibidos reconcilian el uso remoto conocido de forma conservadora, sin reducir contadores locales.
- La reserva se registra ANTES del HTTP con un único `INSERT ... ON CONFLICT ... WHERE ... RETURNING` atómico. Errores y requests fallidos consumen su reserva; no se reembolsa ni se reintenta a escondidas.
- Cache hits no reservan HTTP. El día se identifica por fecha UTC; reiniciar el proceso no lo cambia ni elimina el contador.
- El lease de batch persistido evita dos procesadores simultáneos. Cada batch permite como máximo 2 solicitudes de validación y 2 de outcomes. Un índice único protege mappings, y locks transaccionales serializan captura con invalidación de evidencia.
- Se probó competencia real entre dos clientes Prisma por la última plaza: solo uno la obtiene. El segundo cliente ve el consumo persistido. También se comprobó el límite tras reconstruir el procesador sin cache en memoria.

Logs sin credenciales: `API_BUDGET_USED`, `API_BUDGET_REMAINING`, `API_REQUEST_SKIPPED_BUDGET`, `API_PERIOD_CONFIRMED`, `API_PERIOD_CACHE_HIT`, más causas acotadas de fallo/no-match/admisión diferida.

## Captura, provenance y outcomes

La captura sigue usando `persistLiveMarketSnapshot` y un `LiveSnapshot` AllSports existente. La verificación de evidencia se repite bajo lock antes de insertar. Un certificado en memoria que ya se invalidó en PostgreSQL no autoriza captura. Se corrigió el hash para que el orden de claves de JSONB no genere duplicados híbridos.

Campos reales añadidos a `LiveMarketSnapshot`:

- `periodProvider = API_FOOTBALL` para captura híbrida.
- `statsProvider = ALLSPORTS` para captura híbrida.
- `oddsProvider = ALLSPORTS` solo si existe una cuota AllSports válida del mercado exacto; sin cuota, NULL. Las observaciones puras API-Football conservan su fuente real.
- `dataQualityDetails.hybridEvidence` conserva API fixture ID, receipt, expiry e identidad del certificado.

N/D permanece NULL; cero confirmado sigue siendo cero. No se sustituye una cuota FT por OVER 0.5 FIRST_HALF. Los registros antiguos no reciben provenance inventado.

Para HT/FT se usan primero resultados ya recibidos. Solo un outcome pendiente, con mapping y presupuesto, puede solicitar `/fixtures?id=...`; hay como máximo un intento HTTP HT y uno FT por fixture. Un rechazo por presupuesto no consume ese intento. El procesador exige `score.halftime` explícito para HT y `score.fulltime` explícito para FT: FT sin halftime resuelve únicamente FT. Los resultados se asocian a fixture e ID correctos y nunca etiquetan otro partido.

## Simulación sin HTTP

Ejecutada con `npm run dataset:simulate-hybrid`; salida en `reports/hybrid-simulation.json`. El script prohíbe fetch y usa transacción PostgreSQL READ ONLY. Es simulación de solicitudes, no backtesting de resultados ni ML.

| Muestra | potentialCandidates | uniqueFixtures | periodValidationRequests | cacheHits | htResolutionRequests | ftResolutionRequests | estimatedDailyRequests |
|---|---:|---:|---:|---:|---:|---:|---:|
| Scouts reales verificables de las últimas 24 h | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Escenario en memoria de 10 fixtures | 150 | 10 | 30 | 120 | 10 | 10 | **50** |
| Escenario en memoria de 40 fixtures | 600 | 40 | 30 | 120 | 10 | 10 | **50** |

El escenario de 40 difiere 30 fixtures mediante el límite de admisión; sin admisión ni presupuesto demandaría 200 requests. La cuota dura sigue limitando a 80 incluso ante volumen no modelado, errores o outcomes de días anteriores.

Los escenarios suponen matching inequívoco y outcomes no disponibles localmente; no representan capturas reales. La simulación es una proyección de tráfico agregado, no una promesa de latencia ni un scheduler. Se encontraron **311 LiveSnapshot antiguos** AllSports en 24 horas, pero no preservan score/receipt crudos suficientes para reconstruir una observación confirmada; se excluyeron en lugar de convertir desconocido en cero. Hace falta muestra real representativa antes de autorizar actividad automática.

## Validación final

- `npx prisma validate`: OK.
- `npx prisma generate`: OK. Se detuvo únicamente el Next de este workspace que retenía la DLL; no se reinició. Build y pruebas DB se ejecutaron secuencialmente para evitar otro bloqueo de DLL.
- `npx prisma migrate status`: OK, schema al día. Consulta a `_prisma_migrations`: `20261008160000_hybrid_period_budget` aplicada y sin rollback.
- No se ejecutó `migrate reset`, `db push` ni borrado de datos de aplicación. Los fixtures de pruebas se revierten con rollback; únicamente el contador sintético futuro creado por la prueba de dos conexiones se limpia al terminar.
- `npm run build`: **OK**. Windows bloqueó el SWC nativo; Next utilizó automáticamente WASM y terminó compilación, tipos, páginas y trazas. No se alteró la política de seguridad.
- **74/74 pruebas aprobadas**: 32 unitarias existentes, 9 PostgreSQL existentes, 16 unitarias híbridas y 17 PostgreSQL/cliente híbridas. Las pruebas de cliente usan HTTP simulado; no hubo HTTP real al proveedor. Los casos cubren las restricciones solicitadas, reserva, reinicio, concurrencia, expiración, HT/FT, NULL y aislamiento entre fixtures.
- `tests/no-provider-http.cjs` bloqueó HTTP de proveedores durante build y validaciones. Los logs `DATASET_CAPTURED` en pruebas son sintéticos y sus filas se revierten.

## Estado real del dataset

Se ejecutó exactamente `.\fut.cmd dataset:status`:

| Campo | Valor |
|---|---:|
| totalSnapshots | 0 |
| todaySnapshots (UTC) | 0 |
| queuedCandidates | 0 |
| confirmedMappings | 0 |
| resolvedHt | 0 |
| unresolvedHt | 0 |
| health | EMPTY / NO_SNAPSHOTS |

No se interpreta el cero como fallo: no se activó el procesador ni se fabricaron observaciones reales. Los contadores de cola/mapping son globales, independientes de filtros de snapshots.

## Confirmación

Hashes SHA-256 idénticos al inicio de la fase para `matchAnalyzer.ts`, `liveGoalRadar.ts`, `opportunityRadar.ts`, `allSportsApi.ts` y `providers/index.ts`. BET_SCORE, ENTRY/NO_ENTRY, thresholds y lógica de apuestas intactos. AllSports sigue principal. API-Football automático DESACTIVADO; cero HTTP real durante esta fase. AllSports numérico no confirma FIRST_HALF. N/D != 0. Sin backtesting ni ML. La siguiente activación requiere autorización expresa; no se ejecutó ni quedó programada.
