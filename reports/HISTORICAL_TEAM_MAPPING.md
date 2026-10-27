# Team Provider Mapping persistente

Fecha: 2026-10-15. Resultado: **NO_GO** para validar una señal histórica LIVE con los datos actuales. La capa está implementada; faltan evidencias de identidad y fixtures actuales verificados. No se inventaron mappings, aliases, países ni partidos.

## Infraestructura y alcance

Se reutiliza `ProviderEntityMapping` con `kind=TEAM`, IDs externos por proveedor, método y evidencia JSON. No se modificó schema ni se crearon migraciones. Las dos restricciones únicas existentes conservan correspondencia uno a uno por par de proveedores.

El nuevo módulo `src/services/historical/teamProviderMapping.ts` expone inventario, resolución pura, validación de aliases observados y persistencia transaccional. `ALLSPORTS` y `API_FOOTBALL` se traducen a las denominaciones reales de BD `AllSportsApi` y `API-Football`; `FOOTBALL_DATA` no cambia. No se consideran equivalentes números de ID de proveedores distintos.

La persistencia vuelve a leer el inventario y las relaciones bajo advisory lock transaccional, revalida la propuesta y crea solo relaciones inequívocas. Un mapping existente se reutiliza sin modificar createdAt ni evidencia. La unicidad de PostgreSQL es una defensa adicional frente a escritores concurrentes. No se hace upsert sobre destinos contradictorios ni se borra nada. Solo esta capa utiliza el nuevo lock; escritores históricos previos conservan su comportamiento.

El lector histórico LIVE reconoce además `CONTROLLED_ALIAS`, usando la misma lista central de métodos confiables. No se cambió el evaluador del radar, BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, código de proveedores, HybridScout ni budget.

## Resolución

1. Mapping TEAM persistido y confiable, en cualquiera de las orientaciones. El destino debe existir y no contradecir país/competición explícitos disponibles.
2. ID destino conocido **proporcionado explícitamente con evidencia**, confirmado dentro del país/competición; no se deduce por igualdad numérica. El runner de esta fase no proporcionó IDs supuestos.
3. Nombre normalizado exacto: Unicode NFKC, trim, minúsculas y espacios repetidos. No elimina arbitrariamente sufijos, signos, acentos ni palabras.
4. Alias controlado observado en los datos del mismo país/competición.
5. País y competición confirmados para toda relación nueva. La pertenencia viene de fixtures persistidos. La competición se verifica por binding conocido de proveedor, país+nombre exactos del catálogo local, o mapping COMPETITION persistido hacia una identidad verificada. No se infiere país de nombres de liga homónimos.

Nombre exacto y aliases se revisan conjuntamente para detectar segundos destinos; un exacto no oculta otra identidad admitida por alias. Destinos múltiples, conflictos persistidos y un destino ya vinculado a otra identidad se clasifican **AMBIGUOUS** y nunca se persisten: operacionalmente no hay match. Ausencia de evidencia se clasifica **NO_MATCH**. El resultado MAPPED identifica método y si fue reutilizado.

Los mappings se crean con la hora real, sin retrofechar. La seguridad temporal LIVE existente exige `mapping.createdAt < kickoff`: un mapping nuevo no habilita retrospectivamente partidos ya empezados. Tampoco relaja la disponibilidad temporal de las estadísticas históricas.

## Datos reales encontrados

| Proveedor | Equipos persistidos |
|---|---:|
| AllSportsApi | 665 |
| API-Football | 0 |
| FOOTBALL_DATA | 215 |

Los **665 equipos AllSports tienen country=NULL**. Sus ligas no conservan país y no hay mappings de competición que permitan confirmarlo. Hay múltiples ligas llamadas Premier League y Serie A con IDs distintos. Que Inter exista en ambos proveedores no acredita por sí solo país y competición. No se cambió metadata LIVE para completar este vacío.

Aliases candidatos conocidos en el código: Man City/Manchester City, Man United/Manchester United, Inter Milan/Inter y PSG/Paris Saint-Germain. **Aliases activados: 0**. Solo se activan si ambas formas están presentes en identidades con país/competición confirmados. En los datos consultados figuran Man City, Man United, Inter y Paris SG de Football-Data, e Inter de AllSports; no se añadió Paris SG a otro alias por su parecido ni se usó información externa.

## Ejecución autorizada

Se ejecutó primero `--plan`, después `--write` y se repitió el plan tras la validación final. HTTP bloqueado en el script. No hubo importación histórica ni consultas a proveedores.

| Resultado | Cantidad |
|---|---:|
| Resoluciones equipo/par de proveedores evaluadas | 1330 |
| MAPPED propuestos | 0 |
| Mappings creados | 0 |
| Mappings reutilizados | 0 |
| AMBIGUOUS | 0 |
| NO_MATCH | 1330 |

Los 1330 son **665 equipos AllSports × 2 destinos** (Football-Data y API-Football), no 1330 equipos ni fixtures. No hay equipos API-Football para el tercer par API-Football→Football-Data. Las relaciones se bloquean por país/competición no verificables. Cero propuestas implica cero escrituras de mapping en esta ejecución; no se fabricó una fila para demostrar persistencia.

Uso local, compilando primero con `npm run historical:build`:

```text
node scripts/historical-team-mapping.cjs --plan
node scripts/historical-team-mapping.cjs --write
```

El write requiere autorización explícita del operador y solo aplica propuestas que superan nuevamente la validación dentro de la transacción. El plan es de solo lectura. Evidencias: `historical-team-mapping-plan.json` y `historical-team-mapping-write.json`.

## Cobertura LIVE antes/después

Se repitió `scripts/live-historical-context-check.cjs` antes y después, en transacciones READ ONLY, sin llamar al endpoint del radar ni HTTP.

| Medida | Antes | Después |
|---|---:|---:|
| Filas con estado LIVE persistido | 315 | 315 |
| Muestra más reciente inspeccionada | 100 | 100 |
| MAPPED / contexto disponible | 0 | 0 |
| NO_MATCH / sin mapping | 100 | 100 |
| AMBIGUOUS | 0 | 0 |
| Kickoffs en las últimas seis horas | 0 | 0 |

Son estados guardados, **no partidos actuales verificados**. No existen fixtures recientes dentro de la muestra ordenada por kickoff descendente; no se inventaron fixtures de validación ni se hizo HTTP para buscarlos. N/D permanece N/D. La ausencia de mejora es el resultado seguro esperado con metadata insuficiente, no evidencia de utilidad o inutilidad de las features.

## Integridad y validación

Antes/después: LiveSnapshot=4353, LiveMarketSnapshot=17, HybridScout=47, ApiFootballBudget=3. Hashes de contenido idénticos. El runner no escribe en esas tablas, Fixture, Team, League, stats, outcomes ni odds; su única escritura posible es ProviderEntityMapping. No hay backfill ni polling añadido.

**26/26 pruebas focalizadas OK**: nueve de mapping/configuración más los tests del lector LIVE, su UI y del builder temporal. Cubren exacto, alias condicionado a observación real, ambigüedad, colisión de países, país ausente, competición homónima, mapping persistido reutilizado, proveedor/ID conocido, destino ya relacionado, ausencia→N/D, temporalidad y fixture actual excluido, NULL y no mutación de decisiones. Casos con mapping se probaron con datos en memoria; no se presentan como mappings productivos.

Compilación histórica TypeScript: OK. Build Next/Prisma generate: **OK, exit code 0**, evidencia en `historical-team-mapping-build.log`. Sin schema ni migraciones nuevas.

Archivos nuevos: `src/services/historical/teamProviderMapping.ts`, `scripts/historical-team-mapping.cjs`, `tests/historical/team-provider-mapping.test.cjs`, este informe y evidencias JSON/logs. Modificado: `src/services/historical/liveContext.ts`, únicamente para compartir la allowlist de métodos y aceptar CONTROLLED_ALIAS con los mismos controles temporales.

MCP se intentó primero y devolvió Transport closed; se verificaron los fragmentos locales de mapping existente, reader histórico y scope, más consultas PostgreSQL de identidades/ligas y evidencias previas. No se usaron fuentes externas.

## Decisión

**NO_GO** para Historical Signal Validation con fixtures reales en esta fase. Para avanzar hacen falta país/competición verificables de las identidades LIVE —o mappings de IDs previamente verificados— y fixtures recientes. No se aceptan coincidencias nominales para eliminar este bloqueo. BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, radar logic y budgets permanecen intactos.
