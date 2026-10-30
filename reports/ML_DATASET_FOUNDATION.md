# ML_DATASET_FOUNDATION

Fecha: 2026-10-30. Fase offline, sin modelos entrenados ni conexión con radar, Chat IA o decisiones.

## Resultado principal

La infraestructura de exportación reproducible y los contratos de features/labels están implementados. **Hoy no hay filas etiquetadas certificables para entrenar bajo la regla estricta de disponibilidad observada en FUT.** Tener miles de resultados históricos no acredita que sus features se recibieran antes del instante de predicción.

Se exportaron los cinco datasets, incluso cuando están vacíos, con features, labels y metadata separados. Se conservaron aparte los resultados históricos y las exclusiones en cuarentena. No se inventaron timestamps, scores, estadísticas, periodos, tiempo añadido ni muestras.

Auditoría completa: [ML_DATASET_FOUNDATION_AUDIT.json](ML_DATASET_FOUNDATION_AUDIT.json). Fuente local: PostgreSQL `fut_analytics_history`, corte **2026-10-30 14:59:16.537 UTC**, transacción **REPEATABLE READ / READ ONLY**, comprobación `transaction_read_only=on`. No corresponde a una auditoría de AWS.

Docker Desktop y el contenedor PostgreSQL local estaban detenidos; se iniciaron para leer la base existente. No se ejecutaron migraciones, descargas de datos, backfills ni endpoints de proveedores. El build descarga las dependencias habituales, no datos de fútbol.

## 1. Inventario y cobertura

43.397 fixtures: 42.795 FOOTBALL_DATA, 601 AllSportsApi y 1 API-Football. Hay 141 registros de liga/proveedor; no equivalen necesariamente a 141 competiciones distintas. El histórico importado cubre cinco grandes ligas, 25 temporadas distintas, **2000/01–2024/25**, representadas por 125 registros League/Season. Kickoffs desde 2000-07-28 hasta 2026-10-27. Solo 602 Fixture usan el campo legado `season`; para el histórico se utiliza la relación `seasonId`.

Estados: 42.981 FINISHED, 413 LIVE, 2 STALE_PROVIDER_DATA y 1 UPCOMING. LIVE es estado almacenado, no frescura actual. Precisión kickoff: 10.929 EXACT y 32.468 DATE. No se convierte una fecha sin hora en kickoff exacto.

| Tabla | Filas | Fixtures distintos | Observación |
|---|---:|---:|---|
| Fixture | 43.397 | 43.397 | Solo 1 fue creado antes de kickoff |
| LiveSnapshot | 5.378 | 417 | Todos carecen de procedencia verificable de recepción/score para esta fase |
| LiveMarketSnapshot | 17 | 3 | Todos legacy sin sello point-in-time; resultados HT/FT resueltos en los 17 |
| TeamMatchStats | 86.794 | 43.397 | Mezcla estado actual y finales; no usar como versión histórica del mismo partido |
| TeamPeriodStats | 171.180 | 42.795 | 85.590 FIRST_HALF y 85.590 FULL_TIME |
| HistoricalMarketOutcome | 342.360 | 42.795 | 342.352 con valor/resolución; 8 desconocidos |
| HistoricalOddsQuote | 1.140.986 | 42.783 | Ninguna tiene quotedAt |
| OddsSnapshot | 988.539 | 376 | Ninguna tiene receivedAt ni marketPeriod |
| Lineup | 3.718 | 169 | Starter/posición/número presentes, sin historial de versiones prematch |
| MatchEvent | 4.421 | 510 | Minuto presente; no hay certificación de cobertura completa |
| Player | 2.600 | — | Posiciones de calidad heterogénea |
| PlayerMatchStats | 52 | 1 | Sin minutos, goles ni xG |

Los siguientes recuentos son **valores no NULL**, no garantías de calidad ni de disponibilidad temporal. TeamMatchStats.goals, por ejemplo, puede provenir de un marcador normalizado y no se usa como fuente automática de labels finales.

| Métrica | LiveSnapshot HOME / AWAY, sobre 5.378 | TeamMatchStats, sobre 86.794 | TeamPeriodStats FT, sobre 85.590 |
|---|---:|---:|---:|
| xG | 0 / 0 | 0 | 0 |
| Shots | 1.259 / 1.259 | 77.494 | 77.174 |
| SOT | 4.193 / 4.193 | 76.258 | 75.338 |
| Big chances | 0 / 0 | Campo inexistente | Campo inexistente |
| Shots inside box | 142 / 142 | Campo inexistente | Campo inexistente |
| Corners | 4.153 / 4.153 | 77.352 | 76.424 |
| Yellow cards | 1.454 / 1.521 | 77.638 | 77.203 |
| Red cards | 219 / 198 | 77.308 | 77.204 |
| Goals | Scores obligatorios, origen no certificado | 86.794 | 85.590 |

FIRST_HALF tiene 85.582 valores de goles sobre 85.590 registros de equipo; shots, SOT, xG, corners y cards 1T tienen cobertura **0**. Hay goles HT completos para 42.791 partidos. No existen filas TeamPeriodStats SECOND_HALF: sus goles como resultado se pueden derivar de FT menos HT cuando ambos están confirmados, con comprobación por equipo de que FT no disminuye.

LiveMarketSnapshot: shots 12/17 por lado, SOT 8/17, shots inside box 12/17, corners 9/17; xG, big chances, red cards y marketOdds 0/17. Los 17 pertenecen al mercado 0.5 1T y a solo tres fixtures: existe un sesgo de selección fuerte y no son 17 partidos independientes.

### Minutos

LiveSnapshot va de 2026-10-05 20:15:27.631 a 2026-10-27 18:02:44.520 UTC. 5.364 filas tienen minuto; 14 no. En conjunto aparecen los 90 minutos enteros 1–90. **Eso no significa cobertura continua por partido ni tiempo añadido conocido.** El JSON de auditoría incluye el histograma exacto de minutos con snapshots y fixtures distintos.

### Tipos de dato

- **PREMATCH_DATA:** perfiles de partidos anteriores disponibles antes del corte, identidad conocida antes de kickoff y cuotas con quote + recepción anteriores. Los resultados FT/HT y cuotas importados en 2026 son archivos históricos; no se reclasifican como features prematch recibidas en 2000–2025.
- **HALFTIME_DATA:** se necesita evidencia explícita de estado HT y su hora de disponibilidad. La base tiene scores históricos HT, pero ninguna observación HT inmutable que certifique qué sabía FUT durante ese descanso. Minuto 45 no demuestra descanso.
- **LIVE_MINUTE_DATA:** snapshots con minuto, score, métricas y procedencia temporal verificable. Los actuales quedan en cuarentena; los nuevos recibidos por el escritor `liveListPersistence` pueden reconocerse por su hash de recepción, sin inferir el período que no guardan.
- **PLAYER_DATA:** identidades, alineaciones y eventos dispersos. No existe todavía una historia utilizable de minutos y rendimiento por jugador.

### Historical Feature Builder

Se reutiliza sin modificar `calculateTeamHistoricalProfile` de `src/services/historical/teamProfile.ts`: ventanas 5/10/20, HOME para local y AWAY para visitante, FT/HT separados, cobertura declarada. Solo FINISHED anterior al corte con `createdAt`, `updatedAt` y recepción de estadísticas anteriores. No reemplaza NULL por cero ni usa el resultado del fixture objetivo. Fechas DATE requieren un día anterior al corte.

Los 42.795 partidos importados después de jugarse **no forman perfiles disponibles en las fechas antiguas de esos partidos**. Sí podrían aportar a una predicción posterior a su recepción si la identidad del equipo coincide. Esta fase no añade asociaciones entre proveedores ni fuzzy matching; no une equipos por nombre para inflar cobertura.

## 2. Unidad point-in-time y export

`src/services/ml/foundation.ts` implementa funciones puras, sin imports de proveedores ni motores de apuestas. Cada fila certificada tiene `fixtureId`, `sourceId`, `capturedAt`, fase/minuto y features permitidas explícitamente. Los campos de resultado, resolución, versión de modelo o decisiones no pasan a features.

Features LIVE: scores HOME/AWAY, shots, SOT, xG, big chances, shots inside box, corners, amarillas, rojas, cards, recent5/10/15, perfiles históricos HOME/AWAY 5/10/20 y odds disponibles. `playerFeatures` permanece NULL. Las ventanas recientes usan exclusivamente observaciones anteriores al corte. Una métrica ausente permanece NULL incluso si otro punto tiene un dato antiguo.

Certificación:

1. LiveMarketSnapshot exige el sello existente validado por `pointInTimeIssue`, incluida la comprobación del hash y fechas de las evidencias. Los legacy no se certifican retroactivamente.
2. LiveSnapshot admite únicamente el hash exacto del escritor de listas `live-list:<externalId>:<receipt>`, con proveedor correcto y creación no anterior ni más de tres minutos posterior a la recepción. `capturedAt` es la disponibilidad al persistir; no se retrodata. El escritor antiguo basado en bucket de tiempo no prueba recepción ni marcador confirmado y queda excluido.
3. Para PREMATCH se exige que la identidad estuviera registrada antes de kickoff; con precisión DATE se usa el inicio del día como corte conservador, no una hora de partido inventada. Actualmente solo hay un fixture elegible, sin resultado ni perfiles disponibles.
4. Para HT el constructor acepta una observación explícita `OBSERVED_HALFTIME_STATE_V1` con recepción no posterior al corte. **El lector de la base actual no fabrica esas observaciones: exporta cero.** Su integración con una futura captura HT queda pendiente y no se añadió a ningún flujo operativo.

## 3. Labels futuros

| Label | Tipo |
|---|---|
| goalNext5 / goalNext10 / goalNext15 | Binario 0/1: al menos un gol |
| goalsRemaining1H / goalsRemainingFT | Número de goles restantes |
| twoPlusGoalsRemainingFT | Binario 0/1 |
| cornersNext5 / cornersNext10 / cornersNext15 | Conteo de córners |
| cardsNext10 / cardsNext15 | Conteo amarillo + rojo |
| shotsOnTargetNext10 | Conteo de SOT |
| onePlusGoals2H / twoPlusGoals2H / threePlusGoals2H | Binarios acumulativos para 1+, 2+, 3+ goles 2T |

Los conteos de cards no son puntos de tarjetas ni jugadores amonestados únicos. No hay evidencia para descontar segundas amarillas; esa definición deberá coincidir con las reglas de cualquier mercado posterior.

Para ventanas futuras se exigen extremos con minuto exacto, mismo fixture y período confirmado, orden temporal, métricas conocidas y no decrecientes, pasos no mayores de tres minutos y desfase total reloj/tiempo real no mayor de dos minutos. No se extrapola un endpoint que falta. Se excluyen ventanas que llegan a 45/90 porque no se conoce el tiempo añadido. Son reglas de calidad del dataset, no cambios de thresholds operativos.

Para remaining goals se requieren TeamPeriodStats del proveedor del fixture y de cada equipo, período correcto y recepción posterior al punto; FT exige además estado FINISHED. No se usan defaults de score de Fixture. Si faltan resultados o el marcador retrocede, el label queda NULL. Un FT conocido no rellena goalNext10 cuando faltan los diez minutos de seguimiento.

Los labels se guardan en archivos separados de features, con `labelAvailableAt` en metadata. Un label recibido después de la frontera siguiente no es usable para entrenar/evaluar en esa partición histórica. Se conserva el valor para auditoría, pero `usableLabels` lo excluye.

## 4. Filas disponibles hoy por mercado

### Resultados históricos determinables — cuarentena, no entrenamiento

| Dataset | Resultados | TRAIN por fecha | VALIDATION por fecha | TEST por fecha |
|---|---:|---:|---:|---:|
| prematch_goal_dataset | 42.795 | 39.291 | 1.752 | 1.752 |
| halftime_second_half_goal_dataset | 42.791 | 39.288 | 1.752 | 1.751 |
| prematch_corner_dataset | 38.212 | 34.709 | 1.752 | 1.751 |
| prematch_card_dataset | 38.601 | 35.098 | 1.752 | 1.751 |

Son candidatos con resultados, no conjuntos que cumplan la regla de features disponibles en aquel instante. Permanecen en `quarantine/historical_outcomes_only.csv` y nunca se incorporan automáticamente a train/validation/test.

### Filas certificadas exportadas

| Dataset | TRAIN | VALIDATION | TEST | Filas etiquetadas utilizables |
|---|---:|---:|---:|---:|
| live_minute_dataset | 0 | 0 | 0 | 0 |
| prematch_goal_dataset | 0 | 0 | 1 | 0 |
| halftime_second_half_goal_dataset | 0 | 0 | 0 | 0 |
| prematch_corner_dataset | 0 | 0 | 1 | 0 |
| prematch_card_dataset | 0 | 0 | 1 | 0 |

Las tres filas PREMATCH representan **el mismo fixture**, no tres partidos. Sus labels son NULL y `trainingEligible=false`.

Exclusiones: 5.378 LiveSnapshot sin procedencia verificable; 17 LiveMarketSnapshot legacy; 43.396 fixtures cuya identidad no fue observada antes de kickoff. Las exclusiones pueden referirse al mismo partido por razones distintas; no deben sumarse como partidos únicos.

Los seis contratos independientes `GOAL_NEXT_10`, `GOAL_NEXT_15`, `GOALS_2H`, `CORNERS_NEXT_10`, `CARDS_NEXT_15` y `SOT_NEXT_10` tienen **0 filas utilizables en cada split**. `MARKETS` y el manifest delimitan los labels permitidos para cada modelo. Compartir una base de features no crea un predictor universal.

## 5. Respuestas para la siguiente decisión de ML

1. **¿Cuántas filas por mercado?** Las dos tablas anteriores distinguen resultados disponibles y filas certificadas. El manifest contiene además cada label individual y fixtures únicos por split.
2. **¿Qué modelos podemos entrenar ya?** Ninguno con evaluación point-in-time estricta y muestra entrenable actual. Los archivos históricos permiten explorar distribuciones de resultados, pero no justifican afirmar rendimiento predictivo. No se entrenó ni siquiera un modelo provisional.
3. **¿Qué modelos LIVE carecen de muestras?** Todos los contratos LIVE, incluyendo goles 10/15, córners 10, cards 15 y SOT 10. Además faltan períodos certificados y continuidad. El dataset 0.5 1T tiene selección condicionada a 0-0: no representa todo el universo LIVE.
4. **¿Qué falta de jugadores?** Minutos reales por partido, goles, xG, roles normalizados, saves de portero, eventos con identidad estable y timestamps de publicación/recepción; historial suficiente y versiones de lineup conocidas antes del corte.
5. **¿Hay leakage potencial?** Sí: usar resultados FT como features HT/LIVE; usar imports tardíos como datos antiguos; cuotas closing sin quotedAt; actualizar una fila mutable y retroproyectarla; usar mappings futuros; partir snapshots de un partido entre splits; inferir un período por minuto; usar labels resueltos después de la frontera. Los filtros evitan estas rutas conocidas y fallan de forma conservadora. No reconstruyen versiones inexistentes ni garantizan ausencia de errores originales del proveedor.
6. **¿Qué feature tiene mayor cobertura?** En cobertura bruta de resultados, goles FT tiene 42.795/42.795 partidos del archivo. Eso es label, no feature prematch. Entre métricas LIVE no obligatorias, SOT tiene la mayor cobertura: 4.193/5.378 por lado (~78%); todavía no está certificado temporalmente en esos registros. Como feature histórica válida en las filas exportadas hoy, no hay cobertura predictiva utilizable.
7. **¿Qué ligas tienen mejor dataset?** Premier League ofrece el histórico más completo entre los cuatro resultados; Bundesliga le sigue en completitud. Ligue 1 tiene más partidos, pero menor cobertura de córners/tarjetas. Detalle abajo.
8. **¿Tamaño train/validation/test?** Cero filas etiquetadas utilizables en todos los splits. La distribución potencial de resultados se muestra separada, sin presentarla como muestra entrenable.

### Ligas históricas

| Liga FOOTBALL_DATA | Goles FT | Goles 2T | Córners FT | Cards FT |
|---|---:|---:|---:|---:|
| Premier League | 8.710 | 8.710 | 8.710 | 8.710 |
| Bundesliga | 7.344 | 7.343 | 7.343 | 7.343 |
| Primera Division | 8.740 | 8.740 | 7.600 | 7.600 |
| Serie A | 8.898 | 8.896 | 7.589 | 7.598 |
| Ligue 1 | 9.103 | 9.102 | 6.970 | 7.350 |

## 6. Auditoría de jugadores

- Lineup: 3.718 filas / 169 fixtures. Starter, position y number no NULL, pero no basta para acreditar que la alineación era conocida prematch ni que position sea un rol.
- Player: 2.600. Hay 2.515 posiciones numéricas 1–11, 33 `N/D` y solo 52 roles D/F/G/M (18/12/6/16). No se convierte posición `1` automáticamente en portero.
- PlayerMatchStats: 52 filas / **un partido**; shots y SOT 52/52, starter 52/52, minutos 0/52, goles 0/52, xG 0/52.
- goals/90, SOT/90, xG/90 y conversion: **0 registros con numerador/denominador necesarios**.
- Goalkeeper saves: campo no disponible en PlayerMatchStats; no se deriva de SOT menos goles sin evidencia.
- Eventos: 1.466 goles, 1.084 cards, 1.871 substitutions. MatchEvent contiene nombre textual; no ofrece una relación playerId completa ni prueba de que la secuencia esté íntegra. No se infieren minutos jugados desde estas sustituciones.

Pendiente para una fase autorizada posterior: captura versionada de lineup/starter/posición, IDs de jugador en eventos, minutos jugados, portero y saves, goles/SOT/xG y denominadores válidos por partido, conservación de timestamps de recepción y métricas históricas antes del corte. Esta fase no incorpora nuevas fuentes.

## 7. Reproducibilidad y uso

Formato elegido: **CSV UTF-8** con quoting estilo RFC4180 y fin de línea LF. No hay dependencia Parquet en este proyecto Node; se evitó añadir un runtime Python o un escritor binario solo para exportar una muestra actualmente vacía/no entrenable. `features` contiene JSON tipado para ventanas y perfiles anidados; valores NULL externos usan `\N`, internos usan JSON `null`. Esto conserva la diferencia frente a cero y permite convertir a Parquet más adelante sin reinterpretar ausencias.

```text
data/ml/
  source.json.gz          # Lectura congelada + auditoría; sin secretos de conexión
  manifest.json           # Versión, límites, hashes de código/fuente/artefactos
  audit.json
  train/
  validation/
  test/
    <dataset>.features.csv
    <dataset>.labels.csv
    <dataset>.metadata.csv
  quarantine/
    exclusions.csv
    historical_outcomes_only.csv
```

Cada split contiene los cinco datasets. Las filas se enlazan por `rowId`; metadata no es una matriz de entrenamiento. No usar IDs, sourceId, fechas de resolución ni `trainingEligible` como predictors. Los perfiles incluyen su propia metadata de cobertura/procedencia; un futuro entrenador deberá seleccionar solo sus métricas explícitas.

Particiones globales por kickoff, sin shuffle:

- TRAIN: antes de **2023-07-01 UTC** (temporadas anteriores a 2023/24).
- VALIDATION: desde 2023-07-01 hasta antes de **2024-07-01 UTC**.
- TEST: desde 2024-07-01, incluyendo temporada 2024/25 y observaciones locales posteriores.

Todos los snapshots de un fixture van al mismo split. Los cortes por fecha también mantienen juntos registros de la misma fecha aunque no se hayan conciliado entre proveedores. No se deduplican partidos entre proveedores por nombres parecidos; para una muestra futura se deberán revisar identidades canónicas y duplicados antes del entrenamiento. Las métricas de muestra incluyen fixtures únicos, no solo snapshots correlacionados.

Los límites quedan fijados en el manifest. Sin argumentos se proponen a partir de las últimas dos temporadas registradas; **para reproducir una versión hay que conservar/indicar sus límites**, no volver a elegirlos al incorporar temporadas nuevas.

Captura nueva, desde la raíz y con DATABASE_URL local configurada:

```powershell
npm.cmd run ml:export -- --out=data/ml/next-export --validation-start=2023-07-01T00:00:00.000Z --test-start=2024-07-01T00:00:00.000Z
```

Replay sin PostgreSQL, sin API y sin leer `.env`:

```powershell
node scripts/ml-dataset.cjs --source=data/ml/source.json.gz --out=data/ml/replay-new --validation-start=2023-07-01T00:00:00.000Z --test-start=2024-07-01T00:00:00.000Z
```

El exportador rechaza sobrescribir un directorio que ya tenga manifest. Usar un destino nuevo conserva cada versión. Los directorios `data/ml/` y `data/ml-replay/` están excluidos de Git y del contexto Docker; respaldarlos aparte para trasladar una versión. La imagen de aplicación no es el ejecutor de ML: el comando offline utiliza dependencias de desarrollo del checkout (`typescript` para cargar los módulos).

Se ejecutaron dos replays de la misma fuente con el código final: **49 artefactos idénticos por SHA-256 y manifest idéntico**. Fuente descomprimida SHA-256:

```text
accd3e91df9317da008c5467738a3eebe831840f2b8c481369c7b98c9cc5045e
```

Los archivos congelados permiten reproducir esta versión aunque las tablas mutables cambien. Una nueva auditoría de una base modificada constituye otra versión de datos; no se promete que produzca el mismo hash.

## 8. Paper betting — diseño únicamente

Contrato: `src/services/ml/paper-betting.schema.json`. No hay tabla Prisma, migración, endpoint, scheduler ni escritura de apuestas.

Contiene fixtureId, capturedAt, minute, market, selection, line, modelVersion, datasetVersion, probability, bookmaker, bookmakerOdds, oddsQuotedAt/ReceivedAt, impliedProbability, estimatedEdge, stakeUnits, result, profitLoss y settledAt.

Reglas propuestas para implementación posterior:

- Predicción inmutable con clave única `(fixtureId, capturedAt, market, selection, line, modelVersion)`; liquidación en registro/evento separado para no sobrescribir el pronóstico original.
- Probabilidad 0–1; cuota decimal >1 y ambos timestamps anteriores a la predicción. Cuota desconocida implica impliedProbability y estimatedEdge NULL; no ejecutar simulación de retorno sin cuota verificable.
- `impliedProbability = 1 / bookmakerOdds` (sin ajuste de margen); `estimatedEdge = probability - impliedProbability`.
- WIN: `stakeUnits * (bookmakerOdds - 1)`; LOSS: `-stakeUnits`; PUSH/VOID: 0. Pendiente/desconocido: result y profitLoss NULL.
- Persistir la regla de mercado y el vínculo a la evidencia de liquidación. Los mercados de conteos requieren una selección/línea concreta antes de evaluar probabilidad o P/L.
- El JSON Schema define forma/tipos; las restricciones entre campos, el ledger inmutable y las fórmulas **no se han implementado como servicio**.

## 9. Pruebas, build y límites

- `npm.cmd run test:ml`: **21/21**. Cubre NULL/cero, legacy/tampering, recepción, ventanas completas/incompletas, resets, HT/FT, tiempo añadido, odds tardías, particiones, imports tardíos, fechas de label, HT explícito y determinismo.
- Regresión conjunta ML + histórico + point-in-time + AI API + AI chat + LIVE pipeline: **134/134**, sin fallos ni omitidas.
- Auditoría/export real contra PostgreSQL en READ ONLY: OK. Replay completo y checksums: OK.
- TypeScript `npx.cmd tsc --noEmit --incremental false`: OK.
- Build de aplicación `docker compose build app` / `npm run build` en Node 22.23.2: OK. Prisma generate y Next build correctos.
- npm informó vulnerabilidades preexistentes en dependencias durante el build; no se cambiaron versiones ni se ejecutó audit fix en esta fase.

Se necesita nueva evidencia temporal para pasar de fundación a entrenamiento: recibos/sellos verificables, observación HT explícita, seguimiento con períodos y endpoints completos, versiones históricas de features y odds con ambos timestamps. No se puede reparar ese vacío suponiendo fechas de publicación ni atribuyendo al pasado los imports de 2026.

## Archivos y aislamiento

Nuevos: `src/services/ml/foundation.ts`, `src/services/ml/paper-betting.schema.json`, `scripts/ml-dataset.cjs`, `tests/ml-foundation.test.cjs`, este reporte y `ML_DATASET_FOUNDATION_AUDIT.json`. Modificados: `package.json` (dos comandos offline), `.gitignore` y `.dockerignore` (exclusión de exports).

Git estaba limpio al inicio. No se modificaron modelos Prisma, migraciones, proveedores, ingestion LIVE, Historical Feature Builder, BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, budgets, radar ni Chat IA. Cero entrenamiento, cero modelos almacenados y cero llamadas a APIs pagadas.
