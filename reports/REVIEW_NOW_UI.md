# REVISAR AHORA — priorización visual

## Alcance

Se añade una sección a `/live-goal-radar`, debajo de su cabecera y antes de las alertas y tarjetas originales. No cambia el endpoint, las consultas, los intervalos, las notificaciones, los candidatos del motor ni el procesador híbrido.

Archivos de implementación: `src/components/LiveGoalRadarMonitor.tsx`, `src/lib/radarReviewNow.ts`. Pruebas: `tests/radar-review-now.test.cjs`. `package.json` añade `test:radar-review`.

## Datos y agrupación

`combinedSot` es un alias visual de `candidate.accumulated.shotsOnTarget`, exactamente el campo que ya muestra «SOT acum.» en `RadarCard`. Su origen es `buildCandidate` en `src/services/analysis/liveGoalRadar.ts`: `sum(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget)`. La función existente `sum` retorna NULL si falta cualquiera de los dos lados. No se duplica esa suma ni se convierten N/D o strings a números.

Se seleccionan exclusivamente candidatos recibidos dentro de partidos LIVE, con marcador confirmado 0-0 y SOT numérico finito >= 4. No se agregan reglas de minuto, xG, grandes ocasiones, tiros en área o calidad. Los mercados recibidos ya los define el radar: `OVER05_1H` y `OVER05_FT`.

Un Map por `fixtureId` produce una sola tarjeta; dentro se conservan ambos candidatos de mercado, sin duplicar el mismo mercado. Los datos acumulados, Recent Live y minuto son compartidos por los candidatos del mismo fixture que produce el motor actual. Orden descendente: SOT, Recent Live y minuto (minuto ausente al final). Se ordena un array nuevo y no se modifican entradas.

Etiquetas exclusivamente visuales: REVISAR (4–5), PRIORIDAD (6–7), ALTA ACTIVIDAD (8+). Se muestran competición, equipos, minuto, marcador y SOT; cada mercado conserva Recent Live, Acumulado, Data Quality, decisión original y bloqueo principal o razón. STRONG_ALERT/PRIORITY_ALERT se presentan como ALERT, WATCH/NO_ALERT como NO ALERT, mostrando también la decisión original para evitar perder información. Ninguna etiqueta cambia la decisión.

## MCP

Antes de editar: `search_graph` localizó LiveGoalRadarMonitor, RadarCandidate, evaluateLiveGoalRadar y la página; `get_code_snippet` devolvió el tipo exacto RadarCandidate; `trace_path` mostró el caller GET del radar y los callees buildCandidate/score/decide/sum. Se validaron fragmentos concretos del componente, ruta y motor para ubicar SOT, mercados y decisión. No se modificaron estos cálculos.

## Pruebas y protecciones

14 pruebas nuevas: exclusión SOT=3; inclusión SOT=4 sin filtros nuevos; null/undefined/N/D y números inválidos; LIVE 0-0; deduplicación 1H/FT con conservación de mercados; separación de fixtures; orden SOT; desempate Recent Live; desempate minuto; etiquetas; inmutabilidad de scores/decisiones; renderizado de datos/estados/bloqueos; estado vacío; ausencia de HTTP y de imports ejecutables de providers, presupuesto o procesador.

Pruebas existentes: 32 dataset unitarias, 17 híbridas unitarias, 9 dataset DB, 19 híbridas DB. Total final: 91/91. La primera ejecución de dataset DB sobre la base existente encontró un supuesto antiguo de base vacía (esperaba 1 registro global y encontró 9). Se repitieron ambas suites DB en una base temporal con copia de solo el esquema, sin copiar datos reales. Las suites pasaron y la base temporal se eliminó. No se corrigieron ni relajaron tests para ocultar el fallo.

Todos los tests y el build se ejecutan con bloqueo de HTTP real a proveedores. No se llama al endpoint del radar para validar esta UI. Las pruebas de renderizado usan React DOM Server local.

Hashes antes/después: sin cambios en matchAnalyzer, liveGoalRadar, opportunityRadar, ruta GET del radar, AllSports, API-Football, índice de proveedores, archivos de hybrid y schema.prisma. BET_SCORE, ENTRY/NO_ENTRY, thresholds y budget intactos. El nuevo selector solo tiene un import de tipo, eliminado al compilar; no puede encolar candidatos ni reservar solicitudes. No se cambian las variables de entorno.

Prisma validate, generate y migrate status: OK; cinco migraciones existentes y esquema al día. Sin nueva migración ni cambio del esquema de FUT.

Build: OK (`reports/review-now-build.txt`). Se detuvo solo el Next de este proyecto para liberar Prisma y se restauró el arranque normal mediante `fut.cmd start`. No se abrió el radar ni se hizo HTTP de validación a sus rutas; los ciclos normales que ya tuviera abiertos el usuario mantienen su comportamiento previo.
