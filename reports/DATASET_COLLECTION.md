# Recoleccion futura OVER 0.5 FIRST_HALF

## Operacion

`npm run dataset:status` consulta PostgreSQL en una transaccion READ ONLY.
En PowerShell con scripts deshabilitados, usar `npm.cmd run dataset:status` con Node 22,
o `.\fut.cmd dataset:status` para seleccionar la version instalada y comprobar PostgreSQL.

`GET /api/analytics/training/over05-first-half?limit=10` devuelve el mismo resumen y hasta
10 snapshots. Los agregados consideran todos los registros que cumplen los filtros, no
solo la muestra. `todaySnapshots` usa el dia UTC. `positives`, `negatives` y `positiveRate`
se refieren al resultado HT; las etiquetas desconocidas no entran en el denominador.

## Captura y resolucion

El flujo existente sigue siendo `persistMatchDetail -> saveLiveSnapshot -> observeLiveMarketDataset
-> persistLiveMarketSnapshot`. Exige LIVE, no demo, identidad valida, periodo FIRST_HALF
explicito, marcador confirmado 0-0, minuto 1..45 y observacion de hasta 180 segundos.
No usa el parser antiguo de marcadores. Los minutos adicionales jugados no se convierten
en tiempo anadido anunciado.

AllSports: un estado numerico aislado como `17` o `45+2` no confirma FIRST_HALF y ahora se
rechaza como INVALID_PERIOD. Solo se aceptan etiquetas explicitas de primera mitad con
reloj valido. No se ha verificado que AllSports entregue esas etiquetas en produccion;
si sigue enviando unicamente estados numericos, no generara candidatos con esta politica.
API-Football distingue `1H` de `HT` y `2H` de forma explicita.

Las consultas de listados existentes reintentan resolver los registros pendientes cuando
reaparece un HT/FT confirmado. No se crean peticiones ni tareas programadas. Las etiquetas
resueltas son inmutables: no hay una via automatica de correcciones sin evidencia explicita.
`ftResolvedAt` registra la fecha de observacion del FT confirmado, separada de HT y de la
fecha en que ambas etiquetas quedan resueltas. La migracion no rellena valores historicos.

## Cobertura y health

Se reutiliza `dataQualityDetails.windows`: cada elemento contiene `size` (5,10,15),
`coverage` y las metricas. No se duplicaron columnas coverageLast5/10/15.
Una ventana disponible en el resumen exige 100% de cobertura temporal y alguna metrica
calculable. Los valores deportivos desconocidos siguen en NULL; cobertura 0 expresa
ausencia conocida de cobertura, no cero tiros ni cero goles.

HEALTH EMPTY: cero snapshots. WARNING: mas de 50% sin HT resuelto, SOT o corners por
debajo de 50% de cobertura, o mas de 50% de rechazos por score/periodo desconocidos con
al menos 20 transiciones/capturas observadas. HEALTHY: no se cumple ninguna alerta.
Son criterios de observabilidad, nunca umbrales de apuestas. Los HT pendientes incluyen
partidos aun en juego; WARNING por si solo no prueba un fallo de resolucion.

Los logs JSON DATASET_CAPTURED, DATASET_SKIPPED, DATASET_HT_RESOLVED y DATASET_FT_RESOLVED
incluyen fixture, fecha y cantidad. Los skips consecutivos del mismo fixture/motivo se
suprimen mediante una cache acotada de 5000 fixtures sin temporizadores.
Los contadores de rechazo son locales al proceso, no durables ni compartidos entre workers.
La CLI nueva no conoce los rechazos del servidor; consultar los logs/endpoint del proceso
que captura. Los estados SECOND_HALF conocidos no cuentan como errores de calidad de periodo.

## Validacion de esta fase

- Prisma validate y generate: OK. Build: OK.
- 21 pruebas unitarias y 9 de integracion PostgreSQL: 30/30.
- Datos sinteticos exclusivamente en transacciones revertidas, incluida la prueba del flujo completo.
- Migracion aplicada: 20261006030000_dataset_ft_resolution_time.
- Respuesta HTTP real: reports/dataset-monitoring-endpoint.json.
- Estado CLI real: reports/dataset-status.json.
- Sin backfill, ML, backtesting, polling nuevo ni cambios en decisiones de apuestas.
