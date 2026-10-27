# Frankfurt–Köln: diagnóstico local de cobertura

Fecha: 2026-10-16. Sin HTTP a proveedores, sin escrituras en BD ni cambios de motor.

## Evidencia

Fixture AllSportsApi `1820220`, interno `cmvbbqz2300cec7zszeh3v59v`, kickoff 18:30 UTC. Snapshot del minuto 28: timestamp 18:58:24.227 UTC, 0-0, SOT 3/1, homeXg/awayXg NULL. Los siete snapshots consultados tienen xG NULL. No sustituir estos NULL por los valores de otra pantalla.

La observación persistida de HybridScout del minuto 38 contiene shotsInsideBox 3/3, xg NULL/NULL y bigChances NULL/NULL. Es evidencia de otro minuto: no acredita por sí sola los valores 3/2 del minuto 28.

## Trazado

* AllSports `mapStats` (`src/providers/football/allSportsApi.ts`) reconoce xG por `expected goals` o `xg`. No mapea bigChances ni shotsInsideBox. `TeamStats` tampoco declara esos dos campos.
* La ruta paralela `allSportsObservation` / `strictStats` (`src/services/training/observation.ts`) sí reconoce big chances y shots insidebox/inside box/inside the box. Por eso existe shotsInsideBox en HybridScout sin existir en MatchDetail.
* `footballPersistence.ts` copia xG de MatchDetail a homeXg/awayXg. LiveSnapshot tiene columnas xG, pero no bigChances ni shotsInsideBox.
* `liveGoalRadar.ts` suma xG del MatchDetail actual; NO reconstruye el acumulado desde LiveSnapshot. Las ventanas recientes reciben deltas del momentum persistido. bigChances/shotsInsideBox están fijados a NULL tanto en acumulados como en ventanas y en el inventario de faltantes.
* Las respuestas raw AllSports usan un Map de memoria del proceso (`src/lib/performance.ts`). No se obtuvo el payload raw exacto del minuto 28 de los artefactos locales consultados. No se invocó la ruta debug porque puede solicitar proveedores y programar trabajo híbrido.

Conclusión xG: llega NULL a la persistencia; no hay un borrado identificado en LiveSnapshot o radar. Sigue sin demostrarse si el raw carecía del campo o utilizaba un nombre no reconocido. Big chances tiene una ruta principal incompleta, pero su presencia real en el raw de este fixture tampoco está demostrada. Shots inside box sí tiene evidencia persistida posterior en la ruta paralela y se omite en la principal.

## Corrección mínima necesaria, no aplicada en este diagnóstico

1. Capturar únicamente el array statistics de una respuesta ya recibida por el proceso para distinguir ausencia del proveedor de alias no soportado. No hacer fetch para este diagnóstico ni registrar credenciales.
2. Reutilizar extracción estricta de métricas y añadir campos nullable a TeamStats y al mapeo de MatchDetail. Exponer acumulados como contexto informativo separado de las decisiones.
3. Para deltas durables, añadir columnas nullable correspondientes a LiveSnapshot y su escritura/lectura/hash, con migración y pruebas; no inventar valores de snapshots anteriores.
4. No conectar las nuevas métricas a pesos, calidad o gates existentes: el radar ya referencia estas variables en sus decisiones y completarlas sin aislamiento podría cambiar ALERT.
5. Revisar por separado el selector genérico de shots (`type.includes('shots')`), que puede elegir una subcategoría antes de total shots. El snapshot 28 contiene homeShots=2 y homeSOT=3; el payload ausente impide atribuir definitivamente esa inconsistencia al selector.

## Identidad histórica

AllSports home 3945 (Eintracht Frankfurt), away 3932 (FC Koln), liga 175 Bundesliga. País NULL en equipos y liga. No existen mappings TEAM para estas identidades hacia Football-Data; HybridScout.apiFootballFixtureId es NULL, por lo que no hay puente confirmado de fixture.

Los destinos históricos existen: Germany:ein frankfurt y Germany:fc koln. Frankfurt requiere alias explícito (Eintracht Frankfurt / Ein Frankfurt), no incluido actualmente. Köln tiene coincidencia nominal exacta, pero falta ámbito país/competición verificado para la resolución segura.

El lector real devuelve N/D: NO_UNAMBIGUOUS_MAPPING. Además exige mapping.createdAt < kickoff. Crear un mapping ahora no habilitaría retroactivamente este fixture; no retrofechar ni relajar PIT. Contexto automático actual: NO, con evidencia persistida disponible. Los perfiles históricos pueden consultarse manualmente, pero no sustituyen un mapping verificado ni representan forma reciente (últimos registros Frankfurt 2025, Köln 2024).

## Validación

28/28 tests existentes: radar-review-now, historical/live-context y historical/team-provider-mapping, con bloqueo de HTTP de proveedor.

`npm run build`: bloqueado en prisma generate por EPERM al reemplazar query_engine-windows.dll.node. No se detuvo el proceso LIVE. `npx next build`: OK, exit 0, compilación, comprobación de tipos y generación de páginas completadas con el cliente existente.

MCP search_graph intentado: Transport closed. Se utilizaron búsquedas y fragmentos locales como alternativa. Único archivo de entrega añadido: este informe. Sin cambios a BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds ni budgets.
