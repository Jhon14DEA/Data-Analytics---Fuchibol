# HISTORICAL_ML_RECONSTRUCTION_V1

Fecha: 2026-10-30. Sin entrenamiento ni cambios de decisiones.

## Resultado

**PREMATCH_GOALS_V1: 41.145 filas utilizables. HALFTIME_SECOND_HALF_V1: 41.141 filas utilizables.** Hay muestra suficiente para iniciar una fase posterior de entrenamiento offline de goles prepartido y goles 2T, con evaluación cronológica. Esta fase no entrenó modelos ni produjo probabilidades predictivas.

Se usan los 42.795 fixtures FOOTBALL_DATA del archivo local congelado en la fase anterior, correspondiente al corte PostgreSQL **2026-10-30 14:59:16.537 UTC**. No se descargaron partidos ni se hicieron llamadas reales a AllSports/API-Football. El archivo fuente tiene SHA-256 descomprimido:

```text
accd3e91df9317da008c5467738a3eebe831840f2b8c481369c7b98c9cc5045e
```

Resultados completos, distribución de todos los labels y NULL de **cada feature y cada liga**: [HISTORICAL_ML_RECONSTRUCTION_V1_AUDIT.json](HISTORICAL_ML_RECONSTRUCTION_V1_AUDIT.json).

## 1. Dos políticas separadas

| Política | Uso | Regla temporal |
|---|---|---|
| OPERATIONAL_POINT_IN_TIME | LIVE y shadow real | La información debe haber sido recibida antes o en capturedAt. Sin backdating ni enriquecimiento posterior de features. |
| HISTORICAL_EVENT_TIME_RECONSTRUCTION | Solo datasets offline | Se permiten resultados de partidos anteriores aunque se importaran después. El partido objetivo y los posteriores no pueden aportar features prepartido. |

El nuevo módulo `src/services/ml/historicalReconstruction.ts` solo se importa en el exportador offline y sus tests. No cambia `teamProfile.ts`, `periodEvidence.ts`, `pointInTime.ts`, los filtros AI ni las reglas de frescura LIVE. Hay un test que verifica que el mismo histórico importado tarde es admitido por reconstrucción y sigue rechazado por el constructor operacional.

### Finalización y fechas sin hora

La fuente no tiene un timestamp de pitido final. No se inventó `kickoff + 90`. V1 usa fixtures con resultado FINISHED confirmado, kickoff anterior y un embargo conservador: excluye el día UTC del objetivo **y el día UTC anterior**. Para ser antecedente, `día(kickoff previo) + 2 días <= día(kickoff objetivo)`.

Es una política de reconstrucción por fechas del evento, no una certificación de recepción o una hora exacta de finalización. Evita usar partidos solapados y registros de la misma jornada sin orden horario verificable. Los timestamps de importación no se usan como filtro en este modo.

Se preserva una limitación de cualquier archivo histórico actualizado: no se dispone de todas las versiones de correcciones/publicaciones originales. Por eso estos datos no deben convertirse en evidencia operacional LIVE ni utilizarse para afirmar qué vio FUT en aquel momento.

## 2. Features y labels

### PREMATCH_GOALS_V1

150 columnas de features, separadas físicamente de labels:

- Últimos hasta 5/10/20 partidos del local en HOME y visitante en AWAY.
- sampleSize real; avgGoalsFor/Against, scoredRate, concededRate, cleanSheetRate, BTTS.
- O0.5/O1.5/O2.5 FT y O0.5/O1.5 HT históricos.
- Promedios de shots, SOT, corners, amarillas, rojas y cards (amarillas + rojas).
- Rachas de marcar, conceder y porterías a cero, con indicador de censura cuando llegan al límite de la ventana.
- Liga, temporada, días calendario desde el último partido y días exactos fraccionarios solo cuando ambas horas de kickoff son EXACT.

Cada promedio/tasa exige cobertura completa de los partidos seleccionados para esa métrica. No se sustituye un partido con datos ausentes por otro más antiguo. Las ventanas 10/20 pueden tener menos observaciones al inicio: `sampleSize` lo declara; no se simulan veinte partidos. Para exportar una fila utilizable se exigen al menos **cinco antecedentes HOME del local y cinco AWAY del visitante**. Esta es una condición de calidad del dataset, no un threshold del motor.

Labels: homeGoal, awayGoal, over05, over15, over25, over35, btts, goalsFT, goals1H y secondHalfGoals. Los siete primeros son 0/1; los restantes son conteos. El score final procede de TeamPeriodStats FULL_TIME del proveedor y equipo correctos, no de defaults de Fixture. Cuatro filas tienen goals1H/secondHalfGoals NULL; siguen siendo utilizables para los targets FT.

### HALFTIME_SECOND_HALF_V1

165 features: las mismas 150 prepartido más score HT HOME/AWAY, goles HT totales y doce campos estadísticos 1T (shots, SOT, corners, amarillas, rojas, xG por equipo).

El score HT histórico explícito es válido para reconstruir el estado al descanso en este modo offline. No se requiere que FUT estuviera funcionando en esa fecha. **Las doce estadísticas 1T adicionales son NULL en las 41.141 filas:** la fuente actual solo ofrece esas métricas FT. Nunca se copian las estadísticas finales del propio fixture a HT. Los promedios FT de partidos anteriores sí son features prepartido válidas.

Labels: goal2H_1plus, goal2H_2plus, goal2H_3plus y goals2H. Se calculan como FT menos HT, comprobando por equipo que HT no exceda FT. Score HT ausente o inconsistente excluye la fila HT, sin inventar 0-0.

### Alcance de identidad

V1 usa únicamente FOOTBALL_DATA para evitar duplicar un partido entre proveedores. La identidad canónica es liga + fecha + local + visitante. Si aparecen duplicados canónicos se excluye el grupo completo; en esta fuente hubo **0**. No se unen equipos por similitud de nombres ni se construyen mappings nuevos.

El histórico es el disponible en estas cinco primeras divisiones, no todo el historial mundial de cada equipo. Un club promovido puede tener una muestra corta o un hueco de temporadas: se informa el tamaño observado en lugar de inventar partidos de categorías no importadas.

## 3. Filas, splits y temporadas

| Dataset | TRAIN | VALIDATION | TEST | Total utilizable |
|---|---:|---:|---:|---:|
| PREMATCH_GOALS_V1 | 37.681 | 1.732 | 1.732 | **41.145** |
| HALFTIME_SECOND_HALF_V1 | 37.678 | 1.732 | 1.731 | **41.141** |

Límites UTC explícitos, idénticos en los dos datasets:

- TRAIN: kickoff anterior a 2023-07-01; temporadas antiguas hasta 2022/23.
- VALIDATION: 2023-07-01 inclusive a 2024-07-01 exclusive; temporada 2023/24.
- TEST: desde 2024-07-01; temporada más reciente del archivo, 2024/25.

Cobertura: **25 temporadas, 2000/01–2024/25, cinco ligas**. El JSON contiene las filas de cada temporada. No hay random split. Los dos datasets asignan el mismo fixture al mismo split; el exportador lo verifica. Cada fila representa un fixture, sin multiplicarlo por snapshots ni por ventana.

Exclusiones: 1.650 fixtures por falta de cinco antecedentes por sede; otras cuatro filas HT por score HT ausente/inconsistente. Los 1.650 aparecen como exclusión en ambos datasets y no son 3.300 partidos distintos.

Los perfiles de validation/test pueden usar resultados de fixtures anteriores de esas etapas, igual que en una evaluación secuencial; nunca resultados del propio fixture o posteriores. El entrenamiento posterior debe ajustar transformaciones, selección de features y calibración solo en los datos autorizados de train/validation y mantener test reservado.

## 4. Distribución de labels

### Binarios PREMATCH (41.145 filas)

| Label | 0 | 1 |
|---|---:|---:|
| homeGoal | 9.313 | 31.832 |
| awayGoal | 13.599 | 27.546 |
| over05 | 3.159 | 37.986 |
| over15 | 10.318 | 30.827 |
| over25 | 20.420 | 20.725 |
| over35 | 29.280 | 11.865 |
| btts | 19.753 | 21.392 |

### Binarios HT (41.141 filas)

| Label | 0 | 1 |
|---|---:|---:|
| goal2H_1plus | 9.040 | 32.101 |
| goal2H_2plus | 22.667 | 18.474 |
| goal2H_3plus | 33.276 | 7.865 |

Conteos, formato `goles: filas`:

```text
goalsFT:
0:3159, 1:7159, 2:10102, 3:8860, 4:6179, 5:3250, 6:1523,
7:613, 8:224, 9:58, 10:14, 11:3, 12:1

goals1H:
0:12487, 1:14852, 2:8986, 3:3490, 4:1050, 5:221, 6:48, 7:6, 8:1, NULL:4

secondHalfGoals / goals2H:
0:9040, 1:13627, 2:10609, 3:5269, 4:1935, 5:505, 6:128, 7:21, 8:6, 9:1
```

secondHalfGoals tiene además cuatro NULL en PREMATCH; esas cuatro filas no aparecen en HT. Son frecuencias observadas globales, **no probabilidades de un modelo ni evidencia de rentabilidad**.

## 5. NULL y mejor cobertura

El JSON adjunto enumera cada una de las 150/165 columnas con `present` y `null`, globalmente y por liga. Resumen de la ventana 5 HOME del local en PREMATCH:

| Feature | Presentes | NULL |
|---|---:|---:|
| AvgGoalsFor/Against, tasas FT y rachas | 41.145 | 0 |
| O0.5/O1.5 HT histórico | 41.130 | 15 |
| Avg shots | 37.072 | 4.073 |
| Avg SOT | 36.110 | 5.035 |
| Avg corners | 36.712 | 4.433 |
| Avg yellow cards | 37.127 | 4.018 |
| Avg red cards | 37.132 | 4.013 |
| Avg cards | 37.127 | 4.018 |
| Días calendario desde partido anterior local | 41.145 | 0 |
| Días exactos desde partido anterior local | 10.146 | 30.999 |

Liga/temporada y los perfiles de goles FT tienen cobertura 100%. En HT, score/goles HT tienen cobertura 100%; shots/SOT/corners/cards/xG actuales del 1T tienen cobertura 0%. No se imputa nada. Los días calendario no se presentan como horas exactas de descanso.

### Cobertura por liga

| Liga | PREMATCH | HT | Avg shots HOME5 presente | Avg SOT HOME5 presente | Avg corners HOME5 presente | Avg cards HOME5 presente |
|---|---:|---:|---:|---:|---:|---:|
| Premier League | 8.368 | 8.368 | 8.368 | 8.368 | 8.368 | 8.368 |
| Primera Division | 8.430 | 8.430 | 7.333 | 7.333 | 7.333 | 7.333 |
| Serie A | 8.508 | 8.506 | 7.245 | 7.245 | 7.253 | 7.295 |
| Ligue 1 | 8.791 | 8.790 | 7.083 | 7.083 | 6.715 | 7.088 |
| Bundesliga | 7.048 | 7.047 | 7.043 | 6.081 | 7.043 | 7.043 |

Premier League es la más completa para esas métricas auxiliares. Todas tienen perfiles de goles FT completos entre las filas seleccionadas. Los formatos de tarjetas y cambios de cobertura por temporada deben revisarse al evaluar un modelo; más cobertura no garantiza mayor capacidad predictiva.

## 6. Export reproducible

Salida final: `data/ml/historical-v1-release/`. Replay de verificación: `data/ml/historical-v1-replay/`. Están bajo el directorio excluido de Git y del contexto Docker de la fase anterior.

Cada split tiene, por cada dataset:

- `.features.csv`: columnas planas de features, con rowId para enlace.
- `.labels.csv`: labels separados físicamente.
- `.metadata.csv`: fixture, kickoff, política temporal e IDs de antecedentes usados.

Además, `excluded.csv` y `manifest.json`. CSV UTF-8 con NULL `\N`; no se convierte NULL a cadena vacía o a cero. rowId y metadata no son features de entrenamiento. El manifest fija los cortes y hashes de fuente, código y archivos.

Se verificaron **19 archivos idénticos por SHA-256 y manifest idéntico** en dos ejecuciones offline. Hash del manifest final:

```text
494e323c310be87bbb6cc7a15a05f15d1479dfdff59dd12fe258356287231c41
```

Reproducir en un destino nuevo desde la raíz:

```powershell
npm.cmd run ml:historical -- --source=data/ml/source.json.gz --out=data/ml/historical-v1-new --validation-start=2023-07-01T00:00:00.000Z --test-start=2024-07-01T00:00:00.000Z
```

El comando no abre PostgreSQL ni `.env`, no usa HTTP y rechaza sobrescribir un directorio existente. Preservar el archivo fuente y los exports fuera de Git para trasladarlos a otra máquina. No hay dependencia Parquet nueva: se conserva la decisión de CSV de la fundación.

## 7. Collector shadow LIVE

Implementado en `src/services/ml/shadowCollector.ts`, conectado únicamente a las respuestas AllSports ya obtenidas en `listMatches()` y `listAllMatchesToday()`, después de la persistencia del listado. No cambia el contenido del dashboard, radar o Chat IA. No instrumenta todavía el fallback API-Football.

Persistencia aditiva:

- **MlShadowSnapshot:** fixtureId, provider/providerFixtureId, capturedAt, receivedAt, persistedAt, minute, period, score, stats, recent5/10/15, dataQuality y sourceHash.
- **MlShadowOutcome:** snapshotId, label, value, resolvedAt y evidencia. Labels futuros fuera del payload de features; una ausencia de label significa NULL/no resuelto, no 0.

La migración `20261030160000_ml_shadow_dataset` está **aplicada en PostgreSQL local**, finalizada el **2026-10-30 15:35:36.687 UTC**. Añade dos tablas y una relación a Fixture, sin alterar sus campos existentes ni tablas de decisiones.

### Certificación operacional

- Usa el `trainingReceipt` original de la respuesta, conservado en caché. Nunca asigna la hora actual a un payload cacheado para hacerlo parecer nuevo.
- Rechaza recepción ausente, futura o de más de 180 segundos y score ausente/no confirmado. Un 0-0 textual confirmado sigue siendo válido.
- CapturedAt es la recepción de la observación; persistedAt registra cuándo se guardó. Stats disponibles y raw statistics del proveedor se conservan; ausencias permanecen NULL.
- El hash valida el payload de features y procedencia. `shadowIssue()` detecta manipulación de score, features o recepción; los datos inválidos no alimentan ventanas/outcomes.
- Recent5/10/15 solo usa puntos anteriores, con extremos exactos, continuidad y período explícitamente confirmado. Un reloj numérico no se convierte artificialmente en FIRST_HALF; los períodos desconocidos/derivados no habilitan labels de ventanas cortas.
- No inventa added time. Guarda por separado el tiempo añadido transcurrido observado y el total anunciado, que queda NULL si falta.
- Unique `(fixtureId, provider, receivedAt)` hace idempotente una recepción. El collector no actualiza snapshots existentes.
- HT/FT futuros pueden resolverse cuando una **respuesta normal existente** los informa explícitamente. AET no se toma como resultado FT de 90 minutos. Las ventanas futuras solo se resuelven con puntos posteriores suficientes y certificados.
- La primera resolución suficiente se guarda separada; posibles correcciones posteriores requieren conciliación específica. No se sobrescriben silenciosamente features ni labels resueltos.
- Lee hasta 1.000 puntos recientes por fixture y escribe los outcomes en un lote, no una consulta por label. Si no hay evidencia suficiente, permanecen sin resolver. No hay consultas eternas de detalle, cron, polling ni llamadas extra al proveedor.
- Si falla el shadow o falta su migración, el error se registra sin secretos y se conserva la respuesta operacional; no provoca un fallback de proveedor.

### Desde cuándo se acumula LIVE certificado

**No hay todavía una fecha real de inicio confirmada.** La consulta local posterior a la implementación devuelve:

```text
MlShadowSnapshot count = 0
MIN(capturedAt) = NULL
MAX(capturedAt) = NULL
MlShadowOutcome count = 0
```

Se probaron capturas sintéticas en una base desechable, eliminada al terminar; no se mezclaron con la base real. No se accedió a AWS ni se dispararon requests de fútbol para generar ejemplos. La fecha de la migración es preparación de infraestructura, **no la primera captura real**.

### Activación/verificación en AWS

Tras llevar estos cambios al servidor, la composición existente ejecuta migraciones antes de arrancar la app:

```sh
docker compose up -d --build app
```

`ML_SHADOW_ENABLED=true` está documentado en `.env.example`; si la variable no existe, el collector está habilitado. `false` desactiva solo el shadow. No requiere nuevas credenciales.

La acumulación empieza con la primera respuesta LIVE del flujo habitual después del despliegue. Si nadie utiliza un flujo que ya obtiene datos LIVE, este collector no los busca por su cuenta.

Comprobar cantidad y primer/último capturedAt desde el contenedor de aplicación, sin exponer claves:

```sh
docker compose exec -T app node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.mlShadowSnapshot.aggregate({_count:true,_min:{capturedAt:true},_max:{capturedAt:true}}).then(x=>console.log(JSON.stringify(x,null,2))).finally(()=>p.$disconnect())'
```

Ese primer timestamp no NULL será la fecha verificable de inicio en AWS. Si el proveedor no aporta período o métricas suficientes, la captura seguirá guardando N/D y los labels correspondientes deberán esperar; activar el collector no garantiza por sí solo muestras entrenables.

## 8. Mercados para la siguiente fase

Pueden pasar a una **ML_TRAINING_V1 offline autorizada por separado**:

- PREMATCH: marcar local/visitante, Over 0.5/1.5/2.5/3.5 FT, BTTS y conteo goles FT.
- HT: 1+/2+/3+ goles 2T y conteo goles 2T, usando histórico prepartido y score HT.
- Los labels goals1H/secondHalfGoals de PREMATCH permiten tareas separadas con exclusión de sus cuatro NULL.

Deben esperar:

- GOAL_NEXT_5, GOAL_NEXT_10, GOAL_NEXT_15, CORNERS_NEXT_10, CARD_NEXT_15 y SOT_NEXT_10: no se reconstruyen con agregados históricos; necesitan muestras shadow temporales, seguimiento y labels suficientes.
- Modelos que requieran xG/big chances actuales, estadísticas detalladas 1T o rendimiento de jugadores: la cobertura actual no los respalda.
- Córners/tarjetas prepartido podrían ser una fase de dataset posterior, pero **no son targets exportados en esta versión**. Aquí solo se usan sus históricos anteriores como features auxiliares de goles.

No se declara un porcentaje condicional del tipo “67% de 2+ goles” porque aún no existe un modelo ni validación de ese patrón. Cumplir el umbral de tamaño solicitado habilita la siguiente fase; no la ejecuta automáticamente.

## 9. Validación y cambios

- Tests nuevos históricos/shadow: **24 aprobados**.
- Suite combinada históricos/shadow + fundación ML + histórico operacional + point-in-time + AI API + AI chat + pipeline LIVE: **158/158**.
- Integración Prisma/PostgreSQL en base temporal: **1/1**; verificó persistencia, hash, idempotencia, labels HT/FT, conservación del fixture y separación de tablas. Total **159 pruebas**.
- Prisma validate/generate: OK. Migración aditiva local: aplicada.
- TypeScript y build Docker (`npm run build`, Node 22.23.2): OK.
- Reproducción offline: manifest y 19 artefactos idénticos.
- Las pruebas de provider ejecutan únicamente Fixtures + Livescore simuladas y verifican que la segunda lectura de caché no añade requests ni capturas.

Cambios de esta fase: nuevos módulos `historicalReconstruction.ts` y `shadowCollector.ts`; exportador `historical-ml-reconstruction.cjs`; tests históricos/shadow/DB; migración; relación y modelos Prisma; import y dos llamadas shadow en AllSports; variable de ejemplo; comandos npm y reportes.

Al empezar ya estaban sin commit los archivos de ML_DATASET_FOUNDATION, sus exclusiones Git/Docker y comandos. Se preservaron; no son cambios nuevos de reconstrucción. No se modificaron BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, budgets, radar, Chat IA ni el Historical Feature Builder operacional. Sin modelos entrenados, sin apuestas y sin llamadas pagadas nuevas.
