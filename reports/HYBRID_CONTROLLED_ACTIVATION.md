# Activación controlada del dataset híbrido — 2026-10-08

La solicitud adjunta autoriza la activación local. Se conserva AllSports como proveedor principal y se reutiliza el refresco existente de `/live-goal-radar`. No hay cron, timer, polling independiente ni ejecución del procesador al arrancar el servidor.

## Ejecución y límites

`GET /api/debug/live-goal-radar` termina sus consultas y análisis habituales de AllSports, y registra `scheduleHybridBatch` con `after()` de Next. La respuesta del radar no espera a API-Football. El callback contiene sus errores; el lease persistido del procesador evita lotes simultáneos. Sin la página del radar abierta no hay refrescos periódicos. Solo candidatos estrictamente elegibles o snapshots con outcomes pendientes pueden originar solicitudes.

Flag preferido: `HYBRID_DATASET_PROCESSOR_ENABLED`; un `false` explícito prevalece sobre el flag antiguo. `.env.example` lo deja desactivado. Proyección revisada existente: 50 requests/día, sin ejecutar nuevas simulaciones sobre datos reales.

Plan previamente autenticado: Free, 100/día. Límite automático 80, validaciones hasta 60, reserva de 20 para outcomes y margen de 20 fuera del automático. Las variables nuevas solo permiten reducir estos límites. Máximo 10 fixtures nuevos/día y cuatro validaciones por fixture. TTL/revalidación siguen en 10 minutos, con vencimiento adelantado cerca del descanso y rechazo inmediato de observaciones contradictorias. No se alteran reglas de captura.

La sesión `controlled-20261008` comparte un máximo de 10 reservas entre validaciones y outcomes. Se almacena en `HybridApiCache`, con clave estable `activation-session:<id>`; no se reinicia por proceso, despliegue ni cambio de día. La fila se bloquea en PostgreSQL y su incremento se confirma en la misma transacción que `ApiFootballBudget`. No se creó otra tabla ni fue necesaria otra migración. Cambiar el ID inicia otra sesión: no debe hacerse para eludir el límite sin autorización.

El contador es conservador: reserva antes de HTTP, no devuelve consumo ante fallos y puede contar una reserva cuyo envío fue interrumpido. Cada petición híbrida permite un solo intento; un cache hit no reserva. Los contadores muestran reservas, no una medición independiente del servidor remoto. El presupuesto remoto conocido solo puede endurecerse. No se consulta `/status` durante esta activación.

## Matching, provenance y telemetría

Mapping persistido en `HybridScout.apiFootballFixtureId`, con unicidad. Sin mapping: equipos exactos en el mismo orden tras NFKC, minúsculas y normalización de espacios; liga exacta normalizada; kickoff con tolerancia de cinco minutos. Ningún fuzzy. Más de una coincidencia o conflicto local no fusiona. Se consulta únicamente `/fixtures` por fecha para descubrir IDs o por ID para confirmar/resolver.

Captura híbrida: `periodProvider=API_FOOTBALL`, `statsProvider=ALLSPORTS`; `oddsProvider=ALLSPORTS` solo si existe la cuota real del mercado requerido, de lo contrario NULL. N/D permanece NULL.

Se registran candidatos, matching confirmado/no encontrado/ambiguo, confirmación de periodo, cache hit y rechazo de presupuesto mediante claves de telemetría persistidas, una vez por evento/fixture o causa/día/sesión. `HYBRID_API_REQUEST` se registra por reserva. `DATASET_CAPTURED` conserva la telemetría existente. Los contadores de candidatos y estados de matching son acumulados, no necesariamente estados mutuamente excluyentes.

## Revisión MCP y archivos

Consultas usadas: `get_architecture`, `search_graph`, `trace_path` (callers y callees de radar, procesador y reserva), `search_code`, `get_code_snippet` y `detect_changes` con impacto. El grafo inicial mostraba cero callers del procesador. Impacto de esta activación: ruta del radar, procesador, reserva, hook local y resumen del dataset. El diff global también contiene trabajo previo; no representa solo esta fase. Un intento de reindexación devolvió `index worker could not be started`; los nuevos enlaces se validan además mediante código, compilación y pruebas.

Archivos consultados para esta fase: adjunto del usuario; fragmentos de `prisma/schema.prisma`, `package.json`, `.env.example`, `fut.cmd`, `scripts/dataset-status.cjs`, `src/services/training/liveMarketSnapshots.ts`, `hybrid/{policy,scout,budget,processor}.ts`, `src/app/api/debug/live-goal-radar/route.ts`, `src/components/LiveGoalRadarMonitor.tsx`, `src/providers/football/apiFootball.ts`, `src/lib/performance.ts`, pruebas híbridas y declaraciones/implementación local de `next/server` para `after()`. Budget y processor se leyeron completos por ser las unidades afectadas. `.env` se procesa solo para actualizar flags explícitos, sin imprimir sus valores sensibles. Se consultan también los logs de validación.

## Validación previa

- Prisma validate y generate: OK. Migrate status: cinco migraciones, esquema actualizado, incluida `20261008160000_hybrid_period_budget`.
- Pruebas: 77/77 (17 unitarias híbridas, 19 híbridas con DB/cliente, 32 dataset unitarias, 9 dataset con DB).
- Pruebas con HTTP real de proveedores bloqueado. Fixtures sintéticos y presupuestos de prueba se revierten o limpian exclusivamente por sus claves de prueba.
- Concurrencia: dos clientes compiten por el último cupo diario y por el último cupo de sesión; reconectar no recupera cupos. Outcomes también consumen sesión y cambiar de día no la reinicia.
- Hashes de matchAnalyzer, liveGoalRadar, opportunityRadar, allSportsApi e índice de proveedores coinciden con el cierre anterior: BET_SCORE, ENTRY/NO_ENTRY, thresholds y selección principal intactos.

## Resultado de activación real

Build OK (`reports/activation-build.txt`). FUT quedó escuchando en `http://127.0.0.1:3000`, proceso Next 21616, con el flag preferido en true y los límites 80/60/10/10 configurados. El cliente API-Football y las credenciales no se imprimieron ni modificaron.

Un ciclo manual del endpoint existente del radar terminó el 2026-10-08 a las 22:53:45 UTC (17:53:45 Ecuador): HTTP 200, cuatro partidos LIVE revisados y dos candidatos del radar. Estos candidatos del radar no equivalen a candidatos del dataset. Dos detalles fallaron; los otros dos eran AllSports 1847904 (minuto 45, 0-0, fuera de la ventana scout) y 1752107 (minuto 19, 0-2). Ninguno elegible para captura híbrida. No se relajan los filtros ni se fabrican observaciones.

Estado PostgreSQL después del ciclo, mediante `fut.cmd dataset:status`:

| Métrica | Resultado |
|---|---:|
| Candidatos dataset detectados / encolados | 0 / 0 |
| Mappings / ambiguos / no encontrados | 0 / 0 / 0 |
| Solicitudes sesión / límite | 0 / 10 |
| Solicitudes automáticas del día | 0 |
| Validaciones / outcomes | 0 / 0 |
| Presupuesto automático restante | 80 |
| Snapshots total / hoy / nuevos reales | 0 / 0 / 0 |
| Última solicitud híbrida / última captura | NULL / NULL |
| Health | EMPTY: NO_SNAPSHOTS |

Captura real: NO; no hay fixture capturado ni provenance real que mostrar. EMPTY es compatible con no haber candidatos elegibles. Evidencia del ciclo: `reports/activation-live-cycle.json`; estado completo: `reports/activation-status-after.txt`. Cero HTTP real a API-Football en esta sesión; las consultas normales a AllSports sí se ejecutaron mediante el radar.

El servidor sigue corriendo. La apertura del navegador con `Start-Process` fue rechazada por revisión automática con «blocked by policy», sin detalle adicional. Se ejecutó únicamente un ciclo manual; para mantener el refresco existente debe abrirse `http://127.0.0.1:3000/live-goal-radar`. No se creó un bucle alternativo. Sin esa página abierta, tener el servidor encendido no implica procesar periódicamente.

BET_SCORE, ENTRY/NO_ENTRY y thresholds intactos; AllSports principal; sin polling independiente; AllSports numérico no confirma FIRST_HALF; N/D != 0. No se inició backtesting ni ML.
