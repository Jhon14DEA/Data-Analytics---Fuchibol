# AllSports: auditoria de evidencia de periodo

Inspecciones reales: 2026-10-06 03:06:35 y 03:08:05 UTC. Se uso una invocacion manual
por inspeccion del metodo existente `AllSportsApiProvider.debugListMatches`, que consulta
Fixtures y Livescore. No se agregaron peticiones al radar, polling ni modificaciones al proveedor.
El script de inspeccion intercepta temporalmente fetch en su propio proceso y exporta solo
una lista permitida de campos. No guarda URLs, cabeceras, credenciales ni payloads completos.

## Que significa el numero

`event_status` es un campo mixto: reloj del partido cuando contiene un numero y estado
textual cuando contiene Half Time, Finished, etc. El 17 representa el minuto en ese campo,
no un enum de periodo ni un campo separado de minuto. No se recibio literalmente 17 en
estas inspecciones: se observaron 50 y despues 52 para Honduras-Jamaica, ademas de 90+.
La documentacion oficial de Livescore muestra event_status=74 y event_live=1, pero no
publica en esa pagina un contrato exhaustivo de todos los estados o relojes.
Fuente: https://allsportsapi.com/soccer-football-api-documentation

Ruta antigua, intacta: request(Fixtures/Livescore) -> reconciliacion -> mapMatchSummary
-> parseMinute(event_status) -> MatchSummary.minute / MatchDetail.minute -> syncFixture
-> Fixture.minute; saveLiveSnapshot -> LiveSnapshot.minute. getMatch/mapMatchDetail y
los listados/search consumen esa normalizacion. parseMinute antiguo convierte Half Time
en 45 y trunca 45+2 a 45; no se utiliza para justificar el periodo del dataset.

Ruta del dataset: payload original + trainingReceipt -> allSportsObservation ->
resolveMatchPeriodEvidence -> trainingObservation -> observeLiveMarketDataset ->
persistLiveMarketSnapshot. Se mantiene aislada de las decisiones LIVE.

## Campos originales observados

| Campo | Uso y limites |
|---|---|
| event_status | Reloj mixto/estado: 50, 52, 90+, Half Time, Finished. |
| event_live | Flag 1 tambien presente en partidos Finished: no acredita fase activa. |
| event_final_result | Marcador actual explicito, pese a llamarse final. |
| event_halftime_result | Marcador HT explicito; ausencia no demuestra primera mitad. |
| event_ft_result | Resultado FT; solo se acepta como outcome con estado FINISHED confirmado. |
| event_date/event_time | Fecha/hora programada; no timestamp de actualizacion de marcador. |
| stage_name | Valores Current, Group Stage, Clausura; no distingue mitades. No se usa. |

No se encontro un campo separado minute/period/addedTime en los payloads inspeccionados.
90+ informa que hay añadido, pero no cuantos minutos: minute=90, elapsedStoppageTime=NULL.
Nunca se inventa el total anunciado de añadido. La hora de recepcion pertenece a nuestra
consulta; no garantiza por si sola que un reloj del proveedor siga actualizado.

## Regla final

1. Estados explicitos tienen prioridad: Half Time/HT -> HALFTIME; Finished/FT -> FINISHED.
   FIRST_HALF/1H/First Half y SECOND_HALF/2H/Second Half se reconocen defensivamente,
   con confianza CONFIRMED. Esas etiquetas de mitades son casos de prueba, no ejemplos
   recibidos en esta auditoria. Un reloj incompatible se rechaza. La presencia del campo
   HT no contradice por si sola 1H: tambien se observo rellenado con relojes 25 y 29.
2. SECOND_HALF/DERIVED_HIGH: reloj numerico 46..89, event_live=1, marcador HT valido,
   marcador actual no inferior al HT, ausencia de resultado FT y recepcion de 0..180 segundos. Son senales multiples.
   Es una derivacion, no una confirmacion literal del proveedor. 90+ no satisface esta regla.
3. FIRST_HALF/DERIVED_HIGH no se habilita: no se encontro evidencia suficiente.
   17 + live + 0-0 + HT vacio no prueba 1T. 45/45+/45+2 permanecen ambiguos.
4. Todo lo demas queda UNKNOWN. Un score desconocido nunca se convierte en 0-0.

El minuto <=45 nunca es la unica razon para FIRST_HALF. Esto implica que AllSports
seguira sin capturar candidatos si no entrega evidencia explicita de primera mitad.
No se presenta este trabajo como una habilitacion real de capturas numericas 1T.

## Muestras reales (segunda inspeccion)

| Fixture | event_status | event_live | Minuto dataset | Periodo | Confianza |
|---|---|---|---|---|---|
| 1870298 Honduras-Jamaica | 52 | 1 | 52 | SECOND_HALF | DERIVED_HIGH |
| 1871453 Australia U23-South Korea U23 | Half Time | 1 | NULL | HALFTIME | CONFIRMED |
| 1871089 Fernando de la Mora-General Caballero JLM | Finished | 1 | NULL | FINISHED | CONFIRMED |
| 1799126 Nacional de Muriae-Nova Lavras | 90+ | 1 | 90 | UNKNOWN | UNKNOWN |

No hubo ejemplo FIRST_HALF ni candidato real 0-0 elegible. Las muestras completas,
con campos presentes y motivos, estan en allsports-period-inspection.json. La primera
inspeccion se conserva por separado, con la normalizacion anterior.

## Telemetria y alcance

INVALID_PERIOD incluye periodEvidence: provider, source, rawEventStatus,
normalizedMinute, resolvedPeriod, periodConfidence y reason. El cache de logs
suprime repeticiones del mismo fixture/motivo/confianza; no crea temporizadores.
La evidencia es interna; no hay nuevas columnas ni migraciones. API-Football 1H no cambia.

La captura exige period=FIRST_HALF y periodEvidence.period=FIRST_HALF con confidence=CONFIRMED.
API-Football proporciona esa evidencia directamente de fixture.status.short=1H.

Pruebas: 32 unitarias y 9 de integracion PostgreSQL. Las pruebas sinteticas de
persistencia se ejecutan dentro de transacciones revertidas. No backfill, ML o backtesting.

## Inspeccion de cierre, 2026-10-06 12:28:56 UTC

Resultados actuales: allsports-period-current.json (salida compacta) y
allsports-period-inspection.json (campos originales permitidos y evidencia).
No hubo FIRST_HALF confirmado ni FINISHED en esta ultima muestra; FINISHED se habia
observado en la inspeccion anterior y se conserva en el archivo initial.

- PVF-CAND-Hue: status=66, live=1, HT=2-0, actual=4-0 -> SECOND_HALF/DERIVED_HIGH.
- Skenderbeu-Kucove: Half Time, live=1, HT=3-0 -> HALFTIME/CONFIRMED.
- Werder Bremen II-Hannover II: status=25, live=1, HT=0-0, actual=0-0 -> UNKNOWN.

Un resultado numerico en event_halftime_result no certifica por si solo el descanso.
Los ejemplos numericos aparentemente tempranos siguen bloqueados por falta de periodo.
