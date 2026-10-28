# Diagnóstico del flujo LIVE → Chat IA

Fecha: 2026-10-28. Repositorio local FUT. No se inspeccionó ni desplegó AWS.

## Causa exacta

La pantalla etiquetada **Partidos** corresponde a `/`, no a una ruta `/partidos` en este checkout (`src/components/MainNav.tsx`). Su carga inicial (`src/app/page.tsx`) llama `footballProvider.listMatches()`. Las actualizaciones de `DashboardClient` llaman `GET /api/matches`, que usa ese mismo método.

Con AllSports configurado, `src/providers/index.ts` selecciona `AllSportsApiProvider.listMatches()`. Este solicita los endpoints existentes `Fixtures` del día y `Livescore`, reconcilia resultados y devuelve resúmenes. Antes de esta corrección no escribía esos resultados en `Fixture` / `LiveSnapshot`. Sí ejecutaba la resolución existente de resultados del dataset; esa resolución no sustituye la persistencia de snapshots LIVE generales. `listAllMatchesToday()` tenía el mismo hueco.

La persistencia `persistMatchDetail()` estaba en rutas de detalle/histórico. Por tanto, ver el listado no garantizaba que existiese un registro reciente en PostgreSQL. El `lastUpdatedAt` del listado es la hora de respuesta del dashboard y tampoco demuestra que haya un snapshot guardado.

El otro recorrido es `/ai-chat` → `/api/ai-chat/live` → llamada interna autenticada a `/api/ai/live` → `createAiReader().live()` en `src/services/ai/reader.ts`. No llama a proveedores ni actualiza datos.

El lector exige:

- `Fixture.status = LIVE`, proveedor AllSportsApi o API-Football.
- `Fixture.providerUpdatedAt` de los últimos 180 segundos.
- Snapshot de hasta 240 segundos, sin fechas futuras ni `staleReason`.
- Minuto y marcador del último snapshot alineados con `Fixture`.

No se relajaron estos filtros. El fallo estaba en el enlace de escritura desde el listado, no en la autenticación o el modelo Gemini/OpenAI.

## Evidencia local, solo lectura

Consulta directa al PostgreSQL local `fut-postgres`, base `fut_analytics_history`:

| Dato | Resultado |
|---|---:|
| Fixture LIVE | 413 |
| Fixture UPCOMING | 1 |
| Fixture FINISHED | 42981 |
| Fixture STALE_PROVIDER_DATA | 2 |
| LiveSnapshot total | 5378 |
| Último timestamp LiveSnapshot | 2026-10-27 18:02:44.520 |
| Fixture LIVE con providerUpdatedAt en últimos 3 minutos | 0 |

El estado almacenado LIVE por sí solo no significa LIVE fresco. Estos resultados corresponden a la base local, no prueban las cantidades actuales de AWS. No se hicieron llamadas reales adicionales a AllSports/API-Football para obtener un ejemplo.

## Corrección aplicada

`src/services/persistence/liveListPersistence.ts` añade `persistAllSportsLiveList()`. Se invoca en `listMatches()` y `listAllMatchesToday()` de AllSports, dentro del productor de caché, después del mapeo de la respuesta reconciliada y antes de devolverla.

- Reutiliza los objetos recibidos, las identidades y los datos existentes. No hace fetch, detalle, odds ni consultas históricas al proveedor.
- Reutiliza `trainingReceipt()` registrado al recibir la respuesta HTTP. Una lectura de caché no cambia `providerUpdatedAt` ni el timestamp del snapshot.
- Guarda Fixture y LiveSnapshot en una transacción serializable; crea League/Team cuando faltan.
- La misma recepción es idempotente. Una recepción HTTP nueva puede guardar una observación nueva aunque el marcador no haya cambiado.
- No sustituye observaciones más recientes, ni reactiva fixtures terminales/stale. Conflictos y fallos revierten la transacción; el dashboard conserva su respuesta y se registra un aviso sin secretos. El siguiente flujo normal puede volver a intentar guardar una observación nueva.
- Omite filas sin identidad, recepción válida, fecha válida o marcador confirmado. Un marcador ausente nunca se convierte en 0-0.
- Los campos estadísticos ausentes son NULL. No rellena estadísticas usando datos antiguos. No crea eventos, alineaciones, histórico ni ventanas recientes inexistentes.
- El kickoff de esta respuesta solicitada en America/Bogota se interpreta con UTC-05:00, independientemente de la zona del servidor.
- Un reloj numérico LIVE no implica prueba de FIRST_HALF. Se conserva esa separación; no se modificó `periodEvidence.ts`. HALFTIME se guarda como HALFTIME y no se incluye en `/api/ai/live`, cuyo contrato sigue siendo LIVE.

## Tablas

Escrituras nuevas: **League, Team, Fixture, LiveSnapshot**. Sin cambios de schema ni migraciones nuevas. No se llama `persistMatchDetail()` desde este enlace para evitar ejecutar además ingesta de entrenamiento, odds u otros procesos de detalle.

Lecturas de `/api/ai/live`: Fixture con League, Team, TeamMatchStats, LiveSnapshot (hasta 80), MatchEvent y Lineup/Player. El contexto histórico consulta las asociaciones de ProviderEntityMapping y el histórico local mediante `createLiveHistoricalContextReader()`. No hay acceso directo del navegador a PostgreSQL.

## Ejemplo comprobado y límite de verificación

**No hay un ejemplo real fresco local verificado.** No se debe presentar un fixture antiguo ni el siguiente ejemplo sintético como un partido real.

La prueba del proveedor usa un payload simulado que pasa por `AllSportsApiProvider.listMatches()`: el listado muestra `allsports-pipeline-test`, Pipeline Home vs Pipeline Away, minuto 30, 1-0. El lector IA devuelve los mismos equipos, minuto y marcador usando el ID interno de Fixture. Se comprueba que el listado hizo únicamente las dos solicitudes ya existentes, Fixtures + Livescore, ambas simuladas; la segunda lectura de caché no añade solicitudes ni snapshots.

Además se ejecutó integración con Prisma/PostgreSQL real en una base desechable `ai_pipeline_test_*`, con las nueve migraciones existentes. El handler autenticado de `/api/ai/live` respondió HTTP 200 con este extracto **sintético**:

```json
{
  "fixtureId": "cmvsezy730004c7uwv6a80mm0",
  "teams": { "home": "Synthetic Home", "away": "Synthetic Away" },
  "minute": 30,
  "score": { "home": 1, "away": 0 },
  "stale": false
}
```

`stale` es aquí un extracto de `dataQuality.stale`. La prueba también confirmó xG NULL, SOT visitante 0 explícito, alineación del snapshot, idempotencia y rollback al provocar un fallo de inserción. La base temporal fue eliminada. No se insertaron fixtures sintéticos en la base habitual.

## Validación

- `npm.cmd run test:ai-live-pipeline`: 10/10.
- Suites `ai-api.test.cjs` + `ai-chat.test.cjs` + `ai-live-pipeline.test.cjs`: **62/62**, sin fallos ni omitidas, con bloqueo de red de proveedores.
- `ai-live-pipeline-db.test.cjs`: **1/1**, PostgreSQL real aislado. Requiere `TEST_AI_PIPELINE_DATABASE_URL` apuntando a una base desechable cuyo nombre empiece por `ai_pipeline_test_`, con migraciones aplicadas. Rechaza bases con otro nombre.
- Total: **63 pruebas aprobadas**.
- `npx.cmd tsc --noEmit`: OK.
- `docker compose build app`: ejecuta `npm run build` (Prisma generate + Next build) en Node 22.23.2. Resultado: OK.
- `git diff --check`: OK. El archivo generado `tsconfig.tsbuildinfo` se restauró a su estado inicial.
- npm informó 10 vulnerabilidades de dependencias durante la construcción; no se actualizaron dependencias en esta corrección.

## Archivos de esta fase

- Modificados: `src/providers/football/allSportsApi.ts`, `package.json` (comando de pruebas).
- Nuevos: `src/services/persistence/liveListPersistence.ts`, `tests/ai-live-pipeline.test.cjs`, `tests/ai-live-pipeline-db.test.cjs`, este reporte.
- El árbol Git estaba limpio antes de empezar.

## Verificación pendiente en AWS

Después de trasladar estos cambios al servidor, reconstruir/recrear la aplicación:

```sh
docker compose up -d --build app
```

No requiere una migración nueva. Durante el uso normal, abrir Partidos (`/`) y dejar que reciba su respuesta habitual. Después actualizar el selector de `/ai-chat` antes de tres minutos. En el servidor, esta consulta utiliza la clave que ya tiene el contenedor sin imprimirla y **solo lee** el endpoint:

```sh
docker compose exec -T app node -e 'fetch("http://127.0.0.1:3000/api/ai/live?limit=50", {headers:{Authorization:"Bearer "+process.env.FUT_AI_API_KEY}}).then(async r=>{console.log(r.status);console.log(await r.text())})'
```

Comparar equipos/minuto/marcador; el ID del dashboard es `allsports-<externalId>`, mientras que `fixtureId` de IA es la clave interna de Fixture. Si el resultado está vacío, revisar frescura, marcador/identidades disponibles y avisos `[live-list-persistence]` en logs.

Solo abrir Chat IA no inicia ingesta LIVE. Si nadie utiliza un flujo existente que obtiene partidos, los datos caducarán: se conserva deliberadamente esa condición y no se añade polling. La corrección está acotada al listado AllSports observado; no cambia la ingesta del fallback API-Football. La disponibilidad de eventos, alineaciones y estadísticas depende de lo ya guardado por los flujos existentes; este enlace añade únicamente el snapshot disponible en la respuesta recibida.

## Confirmación

BET_SCORE, ENTRY, ALERT, thresholds y budgets sin cambios. Sin polling, cron ni llamadas adicionales a proveedores. NULL permanece NULL. Sin cambios de Prisma schema, claves ni configuración de producción. No se desplegó AWS desde esta sesión.
