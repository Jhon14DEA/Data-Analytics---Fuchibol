# Fixture-Anchored Team Mapping

Fecha de cierre: 2026-10-16. **GO_FOR_HISTORICAL_SIGNAL_VALIDATION**, limitado a validación informativa en próximos fixtures de identidades verificadas. Hay mappings reales persistidos; todavía no se verificó contexto en un partido LIVE reciente. No se autoriza asignar peso histórico a decisiones.

## Resultado real

| Ancla AllSports / API-Football | Equipos | AllSports→API nuevos | API→Football-Data nuevos | AllSports→Football-Data nuevos |
|---|---|---:|---:|---:|
| 1783779 / 1552487 | Dijon–Metz | 2 | 2 | 2 |
| 1781142 / 1550146 | Torino–Udinese | 2 | 2 | 2 |
| 1727043 / 1492394 | Fluminense–Coritiba | 2 | 0 | 0 |
| 1752104 / 1520912 | Ceara–Criciuma | 2 | 0 | 0 |
| **Total** | **4 anclas válidas** | **8** | **4** | **4** |

**16 mappings TEAM nuevos**, 8 identidades Team API-Football conservadas, 4 cadenas completas. Los cuatro clubes brasileños no tienen un destino en las ligas Football-Data cargadas: NO_MATCH, sin inferencia ni importación. Cero aliases necesarios en estas cuatro cadenas; los nombres son exactos. Cero conflictos de identidad, cero puentes ambiguos.

Reejecución real: 0 mappings y 0 equipos creados, **16 mappings reutilizados**. No se modifica createdAt de los mappings existentes.

Evidencia de primera ejecución: `fixture-anchored-first-write.json`; reejecución: `fixture-anchored-replay.json`; inspección previa: `fixture-anchored-plan.json`.

## Validación estricta de ancla

Las cuatro relaciones proceden de `HybridScout.apiFootballFixtureId`, único en BD. Se reutilizaron exclusivamente directorios persistidos en HybridApiCache de 2026-10-08, 09 y 12. No se consultó API-Football ni AllSports.

La validación exige:

- Una única correspondencia persistida por fixture; se rechazan contradicciones con mappings FIXTURE o referencias inversas.
- IDs numéricos positivos reales para fixtures y equipos; no se admiten IDs derivados de slugs.
- Fixture AllSports con kickoff canónico de precisión EXACT. La fecha API debe incluir zona UTC/offset, o timestamp explícito; si contiene ambos, deben coincidir.
- Diferencia máxima de kickoff de cinco minutos, reutilizando la tolerancia híbrida existente. En las cuatro anclas los instantes UTC coinciden exactamente.
- Nombres normalizados NFKC/trim/minúsculas/espacios exactos, en orientación home→home y away→away; equipos de cada lado distintos.
- Liga exacta, país API explícito, sin contradicción con país local si existe. La identidad del scout debe concordar con los nombres y liga del fixture persistido.
- Distintas versiones de caché del mismo fixture no pueden contener identidades contradictorias; se ignoran cambios ajenos a identidad como winner/logos.

La identidad original del scout contiene hora local sin offset; **no se usa para convertir o adivinar UTC**. Se compara la hora UTC ya persistida en Fixture con la respuesta API. Los certificados 1T están invalidados por evolución del partido; no se reutilizan como autorización de captura. La correspondencia de identidad se vuelve a validar independientemente de periodo/resultado.

## Persistencia y puente

Se reutiliza `ProviderEntityMapping(kind=TEAM)`, sin schema ni migraciones. `FIXTURE_ANCHORED` se incorpora a los métodos de identidad confiables. La evidencia JSON conserva IDs de ambos fixtures, kickoff UTC, recepción de la respuesta, liga/país, IDs/nombres home/away y orientación.

Cada ancla se procesa en una transacción independiente con advisory lock compartido con Team Provider Mapping. Se validan conflictos de origen y destino en ambas orientaciones; cualquier conflicto de identidad revierte todos los cambios de esa ancla. La unicidad existente protege contra duplicados. No se sobrescriben equipos ni mappings contradictorios.

Team API-Football se crea únicamente si no existe. Una identidad preexistente con nombre o país incompatible bloquea el ancla. No se crean fixtures, ligas, estadísticas, outcomes u odds API-Football.

El puente API→Football-Data prioriza mapping persistido, luego nombre exacto o par explícito de alias cuyos dos lados existan en las identidades consultadas. Exige país coincidente y un único club histórico destino. No exige que la división actual sea la histórica: Dijon y Metz aparecen en Ligue 2 en la respuesta API y en el histórico francés disponible; la identidad única del club, país y nombre está confirmada. No se usó fuzzy matching ni coincidencia entre países.

Solo después de establecer el puente se persiste AllSports→Football-Data, con evidencia del camino completo. Si el destino histórico es ambiguo, no se persiste ese puente; puede conservarse la identidad AllSports→API ya probada por el fixture.

## Conservación futura sin HTTP adicional

`runHybridBatch` recopila las respuestas que su flujo existente ya aceptó mediante receive. Tras completar capturas/outcomes y liberar el lease existente, intenta conservar las anclas mediante transacciones separadas. No añade endpoints, reservas, reintentos HTTP, polling ni disparadores de batches.

Los errores de esta conservación se aíslan y registran como TEAM_ANCHOR_NOT_PERSISTED; no cambian resultados ni decisiones del batch. Si el caller inyecta una transacción sin soporte para abrir una independiente, no se ejecuta la conservación dentro de esa transacción. El flujo normal con PrismaClient sí lo hace.

## Integridad

Hashes y counts de Fixture, LiveSnapshot, LiveMarketSnapshot, HybridScout, ApiFootballBudget y HybridApiCache permanecen idénticos antes/después y en la reejecución. Solo se crearon las 8 filas Team API-Football y 16 ProviderEntityMapping autorizadas. No se modificaron BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, radar ni reglas de budget. No hubo backfill ni HTTP real.

El primer intento encontró un error técnico Prisma al deserializar el retorno void de `pg_advisory_xact_lock`; todas las transacciones se revirtieron antes de insertar filas. Se corrigió usando `$executeRaw` para el bloqueo, tanto aquí como en el writer compartido anterior. Las cuatro incidencias técnicas de ese intento no son conflictos de identidad. Diagnóstico conservado en `fixture-anchored-lock-diagnostic.json`.

## Cobertura LIVE antes/después

Se repitió el lector histórico real contra PostgreSQL, sin llamar al endpoint del radar. Se priorizaron los fixtures persistidos LIVE por kickoff descendente.

| Medida | Antes | Después |
|---|---:|---:|
| Registros LIVE inspeccionados, más recientes primero | 100 | 100 |
| Contexto histórico disponible | 0 | 0 |
| Kickoffs en las últimas seis horas | 0 | 0 |
| Mappings TEAM con Football-Data | 0 | 8 |
| Cadenas AllSports→API→Football-Data | 0 | 4 |

Los ocho mappings con Football-Data son cuatro API→FD y cuatro AllSports→FD; no son ocho cadenas distintas. El conjunto de fixtures LIVE persistidos sigue siendo antiguo. Se preservó la política `mapping.createdAt < kickoff` y disponibilidad observada de las estadísticas: **no se retrofechan mappings para habilitar partidos viejos**. Por ello 0/100 no contradice la existencia de cuatro cadenas nuevas verificadas; serán utilizables en fixtures posteriores con estos equipos. No se inventaron fixtures actuales ni se hicieron requests para buscarlos.

Evidencias: `fixture-anchored-context-before.json` y `fixture-anchored-context-after.json`. La utilidad de la señal y su latencia con contexto en LIVE actual quedan pendientes de validación real.

## Tests y build

**36/36 pruebas focalizadas OK**: ancla exacta, orientación invertida, liga incorrecta, timestamps contradictorios/naive, kickoff distinto, IDs distintos, colisión de país, puente exacto/alias explícito, ambiguos, conflictos en ambas orientaciones y persistencia/reutilización con dobles. Incluye regresiones del lector histórico, Team Provider Mapping y política híbrida. La persistencia e idempotencia también se comprobaron realmente con las cuatro anclas de caché.

Compilación histórica TypeScript: OK. Build Next/Prisma generate: **OK, exit code 0**, evidencia en `fixture-anchored-build.log`. Sin migraciones.

Archivos: `src/services/historical/fixtureAnchoredTeams.ts`, `src/services/historical/teamProviderMapping.ts`, `src/services/training/hybrid/processor.ts`, `scripts/fixture-anchored-team-mapping.cjs`, `tests/historical/fixture-anchored-teams.test.cjs` y este informe/evidencias. No se reinició el análisis ni se invocó HTTP para resolver identidades.
