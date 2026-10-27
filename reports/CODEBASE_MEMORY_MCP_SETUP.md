# codebase-memory-mcp: instalación y guía final de FUT

Cierre: 2026-10-08. Instalación existente validada; en este cierre NO se reinstaló ni se ejecutó index_repository. No se cambió código funcional, Prisma, PostgreSQL ni AGENTS.md.

## Seguridad e instalación

- Versión fijada: **v0.11.0**, Windows amd64. Release: https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.11.0
- Commit del tag: `8972ea69c6ad94b1ef1d4ffbf0a92d78d2db1798`.
- ZIP oficial: `https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.11.0/codebase-memory-mcp-windows-amd64.zip` (39.858.881 bytes).
- SHA-256 del ZIP, comparado con checksum oficial: `6eb6beaf261b19e419766e78baf93cbc3cf1c6338cff8fb7c0234859f96d1685`.
- Sigstore: **Verified OK**, mediante cosign portable v3.1.3, issuer `https://token.actions.githubusercontent.com`, identidad `https://github.com/DeusData/codebase-memory-mcp/.github/workflows/release.yml@refs/heads/main`. Se verificó la firma del blob; no se afirma verificación SLSA independiente. El EXE no tiene firma Authenticode.
- Instalación nativa previa: `install -y --skip-config --dir=C:\Users\jlabc\AppData\Local\Programs\codebase-memory-mcp`. El directorio instalado contiene el EXE; no se copió un script de actualización automática.
- PATH de usuario contiene `C:/Users/jlabc/AppData/Local/Programs/codebase-memory-mcp`. Las terminales anteriores pueden necesitar reabrirse; abajo se usa ruta absoluta.
- No se instalaron hooks, skills ni instrucciones. Comparación de inventario de hooks/skills: 0 diferencias de rutas/tamaños. Servicios y entradas de inicio: 0 diferencias. No se observan tareas de CBM; entre días cambiaron identificadores de dos tareas Windows SoftLanding (dos altas/dos bajas), no se atribuyen a esta instalación.
- Sin auto-start de Windows. Hay un daemon local iniciado manualmente; esto no es un servicio de Windows.
- `auto_index=false`, `auto_watch=false`, `watcher_enabled=false`; `ui_enabled=true`, puerto 9749. No hay indexación automática global.

## Rutas exactas

| Elemento | Ruta |
|---|---|
| Ejecutable | `C:\Users\jlabc\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe` |
| Índice FUT | `C:\Users\jlabc\.cache\codebase-memory-mcp\FUT.db` |
| Exclusiones | `C:\Users\jlabc\Documents\PP\FUT\.cbmignore` |
| Codex | `C:\Users\jlabc\.codex\config.toml` |
| Backup previo al cambio manual | `C:\Users\jlabc\.codex\config.toml.backup-codebase-memory-20261008-082915` |
| Configuración CBM | `C:\Users\jlabc\.cache\codebase-memory-mcp\_config.db` y `config.json` |
| Logs | `C:\Users\jlabc\.cache\codebase-memory-mcp\logs\cbm-daemon.log` y `activation-events.ndjson` |
| Evidencias y auxiliares externos al repo | `C:\Users\jlabc\AppData\Local\Temp\fut-codebase-memory-audit` |

## Configuración manual Codex

Se conservó el contenido previo byte a byte como prefijo, con backup antes de añadir solamente:

```toml
[mcp_servers.codebase-memory-mcp]
command = 'C:\Users\jlabc\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe'
cwd = 'C:\Users\jlabc\Documents\PP\FUT'

[mcp_servers.codebase-memory-mcp.env]
CBM_ALLOWED_ROOT = 'C:\Users\jlabc\Documents\PP\FUT'
```

Codex CLI 0.155.0-alpha.16.3 reconoce el servidor habilitado, transporte stdio, sin args adicionales. `codex mcp get codebase-memory-mcp --json` confirmó comando, cwd y env. No se añadió auto_index, hooks, skills ni instrucciones a Codex.

**Límite:** la sesión activa no carga herramientas nuevas en caliente. Se probó el protocolo MCP real con un cliente stdio lanzado desde esta sesión, no mediante una herramienta nativa recién cargada en su interfaz. Abrir una sesión nueva de Codex para disponer del servidor en ella; no se afirma que esa recarga ya ocurrió.

## Índice existente y exclusiones

98 archivos, 1.662 nodos, 4.994 relaciones; estado `ready`; indexed_at `2026-10-07T22:32:52Z`. Cero archivos parse_partial, parse_unusable o skipped. FUT.db: 6.946.816 bytes. No se reindexó en el cierre.

Hay, entre otros, 698 Function, 40 Method, 24 Class, 98 File y 14 Route; las rutas Next.js también pueden representarse por funciones GET, no necesariamente por nodos Route.

La consulta de los 98 File confirmó exclusión de .env y SQL e inclusión de `prisma/schema.prisma`. `.cbmignore` excluye además claves/certificados, secrets, backups, dumps, node_modules, .next, build/dist, coverage, logs, reports y .codex. Se aplican también exclusiones propias y .gitignore. Esto no equivale a una auditoría de secretos incrustados dentro del código fuente.

## Validación MCP: nueve consultas finales, nueve correctas

Respuestas de `search_graph`, `trace_path` y `query_graph` sobre el índice; no se abrieron archivos completos ni snippets de FUT para obtener estos resultados. En la preparación del lote hubo un error de serialización del cliente auxiliar (`missing tool name`), corregido fuera del repo; el lote final completo terminó con 0 errores.

- BET_SCORE: `calculateBetScore` (798-800), `calculateBetScoreWithTrace` (802-864), `appendFinalBetScoreCapTrace` (866-878), en `src/services/analysis/matchAnalyzer.ts`.
- Captura: `persistLiveMarketSnapshot`, `src/services/training/liveMarketSnapshots.ts`, líneas 12-35 del índice.
- Callers, profundidad 4: `observeLiveMarketDataset` → `persistLiveMarketSnapshot`; `persistMatchDetail` → `observeLiveMarketDataset`; aguas arriba AllSportsApiProvider.getAnalysisContext/getMatch/debugFixture y ApiFootballProvider.getMatch. 11 callers en total hasta esa profundidad.
- Imports hacia `periodEvidence.ts`: observation.ts (dos relaciones), telemetry.ts y tests/training/features.test.cjs. Imports salientes: dos relaciones hacia observation.ts. Las aristas IMPORTS no distinguen por sí solas una dependencia de tipos de una dependencia de ejecución; no se afirma un ciclo runtime.
- Impacto potencial: `resolveMatchPeriodEvidence` ← `allSportsObservation` ← AllSports.listMatches/listAllMatchesToday/mapDetail/mapDetailFromRaw; después getAnalysisContext/getMatch/debugFixture y listRadarMatches; hasta cuatro saltos alcanza odds y depuración del radar. 13 callers hasta esa profundidad. Cambiar su contrato puede afectar observación, telemetría y pruebas; cambiar su semántica puede propagarse al proveedor y radar. No demuestra fallos inevitables ni cobertura exhaustiva de llamadas dinámicas.
- Endpoint: `FUT.src.app.api.analytics.training.over05-first-half.route.GET` → parseTrainingFilters / trainingSummary → datasetMonitoring → datasetDiagnostics / datasetHealth (cinco callees hasta profundidad 3). Es análisis estático; no se invocó el endpoint FUT ni PostgreSQL.
- Dependencias AllSports: importadores encontrados en scripts/inspect-allsports-period.cjs, src/app/api/matches/route.ts, src/app/page.tsx y src/providers/index.ts.

Evidencia completa: `closing-queries.json` y `closing-results.json` en el directorio temporal de auditoría.

## UI: comprobación y navegación manual

HTTP 200 confirmado en `http://127.0.0.1:9749/`, JS `/assets/index-CEZerUUP.js` y CSS `/assets/index-u8cZwgso.css`. API `http://127.0.0.1:9749/api/layout?project=FUT&max_nodes=10000` devolvió 1.662 nodos y 4.994 edges.

No se intentó Chrome con remote debugging en este cierre. No se verificó visualmente la interacción: los controles siguientes se contrastaron con el código oficial de la UI v0.11.0 y los datos HTTP, no con clics automatizados.

1. Abrir manualmente `http://127.0.0.1:9749`. Seleccionar FUT en Projects y abrir Graph. Acceso directo: `http://127.0.0.1:9749/?tab=graph&project=FUT`.
2. En Graph, poner **Nodes = 10000**, pulsar Enter y **Refresh**. El presupuesto supera los 1.662 nodos existentes. No significa que todas las etiquetas se lean simultáneamente en pantalla.
3. Expandir las carpetas del lateral mediante sus flechas para explorar archivos. Usar el buscador lateral para `persistLiveMarketSnapshot`, `calculateBetScore`, `AllSportsApiProvider`, `periodEvidence` o `GET`.
4. Seleccionar un resultado/nodo para abrir su detalle. **References** muestra relaciones salientes; **Referenced by**, entrantes. Están agrupadas por tipo: CALLS para llamadas, IMPORTS para imports, y otros tipos según el nodo.
5. Pulsar un nodo relacionado para navegar a él; repetir para recorrer dependencias en varios saltos. No se certifica un botón específico de expansión recursiva ni un filtro de clases/rutas no comprobado. Para trazas completas y límites explícitos usar trace_path/query_graph.
6. Para volver al conjunto completo: borrar búsqueda, pulsar **Clear selection** si aparece y **Refresh**. También se puede recargar el enlace directo anterior.
7. Funciones y clases son tipos de nodo; rutas HTTP pueden aparecer como Route o como funciones GET dentro de src/app/api. La ausencia de un nodo Route no demuestra que una ruta de Next.js no exista.

La UI queda funcionando con el cliente auxiliar de validación. `daemon status` al cierre mostró daemon PID 368, cliente PID 12068, modo session-managed. Los PID son observaciones, no identificadores permanentes. La revisión automática rechazó cerrar esos auxiliares para cambiar a un daemon independiente, con motivo genérico `blocked by policy`. No se forzó ni se intentó eludir ese rechazo. Si `daemon stop` informa clientes activos, cerrar primero sus sesiones; el daemon muestra sus PID. En el caso del auxiliar sin ventana, identificar su proceso y ruta en el Administrador de tareas antes de cerrarlo manualmente. No terminar todos los procesos Node ni Codex indiscriminadamente.

## Comandos A-J, PowerShell de esta instalación

Definir estas variables en la terminal donde se ejecuten los comandos:

```powershell
$cbm = 'C:\Users\jlabc\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe'
$codex = 'C:\Users\jlabc\.vscode\extensions\openai.chatgpt-26.917.62051-win32-x64\bin\windows-x86_64\codex.exe'
$env:CBM_ALLOWED_ROOT = 'C:\Users\jlabc\Documents\PP\FUT'
```

```powershell
# A. Versión
& $cbm --version

# B. Iniciar UI manualmente, sin auto-start de Windows
& $cbm daemon start --port=9749
# Abrir en navegador: http://127.0.0.1:9749/?tab=graph&project=FUT
# Alternativa en primer plano (MCP stdio + UI):
# & $cbm --ui=true --port=9749

# C. Detener UI/daemon (cerrar primero clientes MCP conectados)
& $cbm daemon status
& $cbm daemon stop

# D. Indexar FUT: DOCUMENTADO, NO EJECUTADO EN ESTE CIERRE
& $cbm cli index_repository --repo-path 'C:\Users\jlabc\Documents\PP\FUT' --name FUT --mode full

# E. Refrescar/reindexar manualmente el proyecto existente: misma herramienta
# No borrar FUT.db primero; no se afirma que esta llamada sea solo incremental.
& $cbm cli index_repository --repo-path 'C:\Users\jlabc\Documents\PP\FUT' --name FUT --mode full

# F. Estado
& $cbm cli index_status --project FUT --format json
& $cbm cli list_projects

# G. Eliminar SOLO el índice FUT (NO ejecutado)
& $cbm cli delete_project --project FUT

# H. Ubicación y valores de configuración (sin imprimir secretos de Codex)
Get-Item -LiteralPath 'C:\Users\jlabc\.codex\config.toml'
Get-Item -LiteralPath 'C:\Users\jlabc\.cache\codebase-memory-mcp\_config.db'
Get-Item -LiteralPath 'C:\Users\jlabc\.cache\codebase-memory-mcp\config.json'
& $cbm config list
& $codex mcp get codebase-memory-mcp --json

# I. Desinstalar: cerrar clientes, quitar entrada con J; revisar primero dry-run
& $cbm uninstall --dry-run
& $cbm uninstall
# Interactivo: conservar índices si se quieren mantener. No usar -y a ciegas.

# J. Quitar únicamente la entrada MCP de Codex (NO ejecutado)
& $codex mcp remove codebase-memory-mcp
```

D/E no se ejecutaron en este cierre. G/I/J son instrucciones para el usuario, no acciones realizadas. `mode full` selecciona nivel de análisis; no es un interruptor documentado de incrementalidad. No se inventa un comando `reindex` separado. Actualizar el índice no actualiza el binario; cualquier actualización del programa debe repetir el procedimiento manual de versión fija, checksum y firma, evitando `latest`.

`daemon start` fue reconocido por el binario existente; como ya había una sesión activa, informó `already active (session-managed)`. No se comprobó un nuevo arranque en frío ni parada efectiva en este cierre. Un daemon independiente iniciado sin clientes permanece hasta `daemon stop`; no se registra al arranque de Windows.

## Red observada

En la fase de instalación hubo descargas explícitas autorizadas de GitHub y verificación Sigstore. Esto se distingue del comportamiento normal del servidor.

En las muestras de conexiones TCP de procesos CBM durante la validación anterior y al cierre se observó escucha **127.0.0.1:9749**, remoto **0.0.0.0:0**, estado **Listen**. Esa fila es escucha local, no conexión saliente. No se observaron conexiones externas del proceso, update check a GitHub ni transferencia de código FUT por CBM.

La observación fue muestreo acotado con Get-NetTCPConnection, no captura continua de paquetes, inspección de payloads ni garantía de ausencia absoluta de tráfico breve/DNS. No certifica la red de otros procesos ni del propio servicio de conversación de Codex. README y SECURITY del tag difieren sobre el update check; la discrepancia documental sigue abierta, aunque el chequeo no se observó. Evidencias: network-observations.json y network-closing.json.

## Comparación de contexto

Caso: «¿Qué llama persistLiveMarketSnapshot y qué se rompería si cambio periodEvidence.ts?»

- Con MCP: search_graph para localizar, trace_path inbound para callers de persistLiveMarketSnapshot y resolveMatchPeriodEvidence, query_graph para imports entrantes/salientes. Aproximadamente cinco consultas de grafo (seis si se busca también el resolvedor por separado), **0 archivos completos de FUT abiertos y 0 snippets** para resolver la estructura. Devuelve símbolos, rutas y saltos; evita cargar implementaciones completas.
- Sin MCP: buscar nombres/imports con `rg`, abrir fragmentos de liveMarketSnapshots.ts, footballPersistence.ts, periodEvidence.ts, observation.ts y telemetry.ts; repetir búsquedas hacia AllSports, radar y tests para reconstruir varios saltos. Se ejecutó una búsqueda tradicional acotada de contraste; no se simularon lecturas masivas para inflar el ahorro. Una búsqueda rg bien dirigida también consume poco contexto para un caller directo; el grafo aporta más en relaciones transitivas.
- Para afirmar una rotura concreta seguiría siendo necesario inspeccionar contratos, fragmentos y pruebas. No hay porcentaje ni cálculo exacto de tokens certificado.

Regla propuesta (mantener MANUAL por ahora; AGENTS.md sin modificar):

> Consulta primero codebase-memory-mcp para arquitectura, callers, callees, dependencias e impacto. Abre archivos solamente para validar o editar los fragmentos necesarios.

Prompts útiles: «Traza callers de persistLiveMarketSnapshot hasta profundidad 4»; «Localiza BET_SCORE sin editarlo»; «Lista imports entrantes y salientes de periodEvidence.ts»; «Analiza impacto potencial de cambiar resolveMatchPeriodEvidence»; «Traza callees del GET over05-first-half y abre solo un fragmento si hace falta validar el contrato».

## Git y confirmación de alcance

`git status --short` comparado con git-before.txt: única línea nueva `?? .cbmignore`. El directorio reports ya aparecía sin seguimiento, por lo que Git agrupa allí también la documentación actualizada. Se reescribió únicamente `reports/CODEBASE_MEMORY_MCP_SETUP.md` para sustituir la auditoría pendiente por esta guía.

97 archivos funcionales de la línea base (src, prisma, scripts, tests y archivos raíz seleccionados) conservan SHA-256: **0 cambios**. No se ejecutaron SQL, migraciones, build ni pruebas funcionales por esta fase de configuración. PostgreSQL no se consultó ni modificó.

Cambios de esta fase dentro de FUT: `.cbmignore` y este reporte. Fuera de FUT: instalación/cache ya existentes de la fase previa, configuración Codex manual con su backup, evidencias y scripts auxiliares en TEMP. No se creó AGENTS.md ni otro archivo funcional.

Confirmación: FUT funcional, BET_SCORE, Prisma y lógica de apuestas intactos respecto a la línea base; PostgreSQL no tocado; exclusiones de secretos configuradas y rutas indexadas comprobadas; sin hooks/skills añadidos ni auto_index global; servidor MCP operativo por stdio y reconocido por Codex, pendiente solo de recarga de la sesión de Codex para exponer sus herramientas en ella.

### Estado Git preexistente (antes de instalar/configurar MCP)

```text
 M .env.example
 M package.json
 M prisma/schema.prisma
 M src/app/api/alerts/sync/route.ts
 M src/app/api/analyze/[id]/route.ts
 M src/app/api/matches/[id]/snapshot/route.ts
 M src/app/api/matches/route.ts
 M src/app/api/opportunities/route.ts
 M src/app/api/search/route.ts
 M src/app/matches/[id]/page.tsx
 M src/app/opportunities/page.tsx
 M src/app/page.tsx
 M src/components/AnalysisMarketCard.tsx
 M src/components/AnalysisSummary.tsx
 M src/components/ConfidenceBadge.tsx
 M src/components/CurrentRecommendationPanel.tsx
 M src/components/DashboardClient.tsx
 M src/components/LiveStatsPanel.tsx
 M src/components/MainNav.tsx
 M src/components/MatchSearch.tsx
 M src/lib/alertEngine.ts
 M src/lib/performance.ts
 M src/providers/football/allSportsApi.ts
 M src/providers/football/apiFootball.ts
 M src/providers/football/types.ts
 M src/providers/index.ts
 M src/services/analysis/matchAnalyzer.ts
 M src/types/domain.ts
?? .nvmrc
?? RECUPERACION_ENTORNO.md
?? compose.yaml
?? fut.cmd
?? prisma/migrations/
?? reports/
?? scripts/
?? src/app/analysis/
?? src/app/api/analytics/
?? src/app/api/debug/backtest/
?? src/app/api/debug/fixture/
?? src/app/api/debug/live-goal-radar/
?? src/app/api/debug/live-momentum/
?? src/app/api/debug/markets/
?? src/app/api/debug/matches-provider/
?? src/app/api/debug/time-guard/
?? src/app/api/matches/[id]/alert-config/
?? src/app/api/matches/[id]/alerts/
?? src/app/api/matches/[id]/deep-analysis/
?? src/app/deep-analysis/
?? src/app/live-goal-radar/
?? src/app/matches/[id]/deep-analysis/
?? src/components/LiveGoalRadarMonitor.tsx
?? src/components/LiveMomentumPanel.tsx
?? src/components/LiveStatePanel.tsx
?? src/components/MatchAlertConfigPanel.tsx
?? src/components/MatchLiveHeader.tsx
?? src/lib/matchAlertRegistry.ts
?? src/lib/opportunityRadar.ts
?? src/providers/football/capabilities.ts
?? src/services/analysis/backtest.ts
?? src/services/analysis/deepMatchAnalysis.ts
?? src/services/analysis/liveGoalRadar.ts
?? src/services/analysis/liveMomentum.ts
?? src/services/analysis/probabilityEstimators.ts
?? src/services/persistence/
?? src/services/training/
?? tests/
?? tsconfig.tsbuildinfo
```
