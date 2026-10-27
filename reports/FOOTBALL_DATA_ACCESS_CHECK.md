# Football-Data.co.uk: validación de acceso

**Acceso AVAILABLE. Decisión GO_FOR_FOOTBALL_DATA_PROVIDER.** Las tres comparaciones independientes coinciden en fecha, local, visitante, HT y FT. Las dos referencias pendientes se obtuvieron en la continuación autorizada mediante una sola llamada a API-Football, descrita abajo. No se importaron datos ni se implementó un provider.

## Descarga pública

- Archivo único: [Premier League 2024/25, E0.csv](https://football-data.co.uk/mmz4281/2425/E0.csv).
- HTTP final: **200**, Content-Type `text/csv`.
- Tamaño exacto: **197110 bytes** (192.49 KiB).
- **380 filas de datos**, excluyendo cabecera; **120 columnas**; división `E0`.
- SHA-256: `d0c8ce4a96d886cf60cf101f570f4a3893844226f91c7bd769eb568c49edbfa4`.
- No requiere API key, Authorization, cookies de sesión ni autenticación: la descarga anónima funcionó.
- El dominio `www.football-data.co.uk` respondió 302 al mismo archivo en `football-data.co.uk`. Se realizó una comprobación inicial sin seguir redirects y después se siguió la redirección verificada del mismo proveedor. Total: tres GET de transporte (302, 302, 200), **un solo CSV descargado**. No se descargó otra liga/temporada ni se llamó a API-Football.
- Copia de diagnóstico: `football-data-E0-2425.csv`, dentro de reports. Se leyó como CSV mediante `Import-Csv`, no por separación ingenua de comas. No fue importado a PostgreSQL.

## Infraestructura revisada primero

Codebase Memory MCP: `get_architecture` sobre `src/services/historical`, `search_graph` de normalización/matching y `trace_path(resolveMapping)`. La búsqueda con filtro de archivo no devolvió símbolos; arquitectura y traza sí localizaron las unidades. La infraestructura actual separa provider, normalización, validación, worker, mappings, persistencia y outcomes. Esta comprobación no invoca worker ni persistencia.

Se buscaron referencias API-Football en reports/tests y se consultó la BD en solo lectura: **0 fixtures persistidos del provider API-Football y 0 fixtures de liga 39/season 2024 en los directorios de HybridApiCache**. La fase anterior recibió 380 fixtures en memoria, pero conservó en disco solo el resumen del fixture 1208021, deliberadamente sin guardar la temporada. Por tanto, no hay evidencia verificable para comparar otros dos partidos sin obtener información adicional.

En la comprobación inicial no se ampliaron llamadas de API-Football. En la continuación expresamente autorizada se volvió a comprobar cache/respuestas locales: seguían faltando ambas referencias. Se realizó **un único GET `/fixtures?league=39&season=2024`**, HTTP 200, errors=[], 380 fixtures recibidos, sin retries ni paginación. Fecha de esa continuación: 2026-10-14T01:18:29.279Z (2026-10-13 local). Se conservaron únicamente los tres resúmenes usados para comparar, no se importó la temporada. Últimos headers: límite diario 100, remaining 96, límite por minuto 10, remaining 9. No se modificó el budget LIVE. La revisión pública del sitio identifica el archivo de Premier League y sus familias de resultados/estadísticas/odds ([sitio oficial](https://www.football-data.co.uk/englandm/premier-league)); los conteos y cobertura de este informe se calcularon sobre el CSV efectivamente descargado.

## Columnas básicas y cobertura

Cobertura significa celdas presentes, no certificación independiente de exactitud. Denominador: 380 partidos. Cada columna enumerada en las siguientes filas tiene **380/380 valores, 100%**.

| Categoría | Columnas |
|---|---|
| Identidad / calendario | Div, Date, Time, HomeTeam, AwayTeam |
| FT | FTHG, FTAG, FTR |
| HT | HTHG, HTAG, HTR |
| Árbitro | Referee |
| Shots | HS, AS |
| SOT | HST, AST |
| Corners | HC, AC |
| Fouls | HF, AF |
| Yellow cards | HY, AY |
| Red cards | HR, AR |

Controles sobre las 380 filas: **0 duplicados** de fecha/local/visitante; **0 inconsistencias** FT menor que HT o SOT mayor que shots. No se infiere posesión, xG, eventos o alineaciones: no hay esas columnas. Tampoco se infieren estadísticas 1T a partir de estadísticas finales.

Missing se mantiene como **NULL** en el resumen de diagnóstico; `0` explícito del archivo es un dato distinto. No se aplica `Number('')` ni se imputan faltantes. El CSV original se conserva sin alterar. Cobertura detallada de cada columna en `football-data-csv-analysis.json`.

## Odds

Después de las 24 columnas básicas hay **96 columnas relativas a odds/handicap**: 94 de cotizaciones y dos líneas de handicap (`AHh`, `AHCh`). Familias presentes: 1X2 H/D/A, over/under 2.5 y handicap asiático; columnas con variantes `C` de cierre. No hay columnas explícitas de OVER 0.5 FIRST_HALF ni una hora individual de observación por cotización. No se reutilizarían para PIT ni se sustituiría un mercado 1T por FT.

| Columnas con faltantes | Presentes por columna | Cobertura |
|---|---:|---:|
| BWH/BWD/BWA, BWCH/BWCD/BWCA | 239 | 62.89% |
| WHH/WHD/WHA, WHCH/WHCD/WHCA | 289 | 76.05% |
| 1XBH/1XBD/1XBA | 371 | 97.63% |
| BFH/BFD/BFA | 379 | 99.74% |
| P>2.5/P<2.5, PC>2.5/PC<2.5 | 377 | 99.21% |
| BFE>2.5/BFE<2.5 | 377 | 99.21% |

Las demás columnas están presentes en 380/380 filas. Por ejemplo, B365H/D/A y B365>2.5/<2.5 tienen 100% de presencia. No se resume esto como «todas las odds completas» ni se rellenan las celdas vacías con cero. Semántica exacta de mercados y momentos de cotización requerirá validación del diccionario antes de un futuro adapter; esta fase solo comprueba acceso y contenido.

## Comparación contra API-Football

Normalización controlada: NFKC, trim, minúsculas y espacios colapsados. **Único alias usado, explícito y local:** `man united` → `manchester united`. No reemplazo genérico de abreviaturas, distancia de edición, fuzzy matching ni mapping persistido. Fecha CSV dd/MM/yyyy convertida explícitamente a yyyy-MM-dd; se compara el día con el fixture UTC conocido, sin afirmar equivalencia general de zonas horarias del CSV. Se conserva orientación local/visitante.

| Partido CSV | Fecha | HT CSV | FT CSV | Referencia API-Football | Resultado |
|---|---|---|---|---|---|
| Man United–Fulham | 16/08/2024 | 0–0 | 1–0 | ID 1208021, Manchester United–Fulham, 2024-08-16T19:00:00Z, HT 0–0, FT 1–0 | **COINCIDE** en equipos, fecha, HT y FT |
| Ipswich–Liverpool | 17/08/2024 | 0–0 | 0–2 | ID 1208022, Ipswich–Liverpool, 2024-08-17T11:30:00Z, HT 0–0, FT 0–2 | **COINCIDE** en equipos, fecha, HT y FT |
| Arsenal–Wolves | 17/08/2024 | 1–0 | 2–0 | ID 1208023, Arsenal–Wolves, 2024-08-17T14:00:00Z, HT 1–0, FT 2–0 | **COINCIDE** en equipos, fecha, HT y FT |

Cumplimiento final: **3/3 comparaciones, 15/15 campos coincidentes**. También se volvió a contrastar el primer partido con la nueva respuesta. Todos son FT de liga 39 y season 2024, con coincidencia única por fecha y equipos. Ipswich, Liverpool, Arsenal y Wolves coinciden literalmente entre ambas fuentes: no requieren alias. Solo Man United/Manchester United requiere el alias explícito indicado. No hubo fuzzy matching ni inversión de local/visitante; además no hay duplicados fecha/equipos en el CSV.

Diferencia adicional importante del partido verificado: `HR=0, AR=0` explícitos en Football-Data, frente a Red Cards `NULL, NULL` en la respuesta conservada de API-Football. Es una diferencia de disponibilidad/representación, no prueba de que NULL signifique cero. Se mantienen las fuentes separadas y sin modificar datos existentes.

## Integridad

Se compararon conteos y hashes de todas las filas antes/después en `football-data-integrity.json`: coincidencia completa.

| Tabla | Antes | Después |
|---|---:|---:|
| Fixture | 503 | 503 |
| Season | 0 | 0 |
| TeamPeriodStats | 0 | 0 |
| HistoricalMarketOutcome | 0 | 0 |
| ProviderEntityMapping | 0 | 0 |
| HistoricalIngestionState | 0 | 0 |
| LiveSnapshot | 4353 | 4353 |
| LiveMarketSnapshot | 17 | 17 |
| ApiFootballBudget | 3 | 3 |

Los 92 archivos protegidos conservan sus hashes. No se modificó código de aplicación, schema ni migraciones. LIVE, PIT, BET_SCORE, radar y budgets intactos. No se ejecutó importación, backfill, polling, backtesting o ML. No se añadieron dependencias o lógica reusable que requiriera nuevas pruebas; los controles de datos fueron puntuales sobre el archivo descargado.

Evidencias: `football-data-download.json`, `football-data-csv-analysis.json`, `football-data-before.json`, `football-data-integrity.json`, CSV original y este informe.

La continuación volvió a comparar conteos y hashes completos antes/después: **todas las tablas indicadas permanecen idénticas**, incluyendo LIVE/PIT y ApiFootballBudget. Evidencia adicional: `football-data-api-comparison.json`, `football-data-comparison-before.json` y `football-data-comparison-integrity.json`. Esta continuación consumió **1/1 HTTP autorizado** y no volvió a descargar el CSV. No modificó código de aplicación, schema, migraciones, radar, BET_SCORE ni budgets.

**GO_FOR_FOOTBALL_DATA_PROVIDER**: acceso y cobertura básica comprobados y comparación cruzada completada en los tres partidos. No hay diferencias en fecha, equipos, HT o FT. Se conserva la salvedad de NULL frente a cero en tarjetas del chequeo anterior, sin imputación ni fusión de fuentes. La integración del provider no se inició en esta fase.

## Headers completos (120)

```text
Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,B365H,B365D,B365A,BWH,BWD,BWA,BFH,BFD,BFA,PSH,PSD,PSA,WHH,WHD,WHA,1XBH,1XBD,1XBA,MaxH,MaxD,MaxA,AvgH,AvgD,AvgA,BFEH,BFED,BFEA,B365>2.5,B365<2.5,P>2.5,P<2.5,Max>2.5,Max<2.5,Avg>2.5,Avg<2.5,BFE>2.5,BFE<2.5,AHh,B365AHH,B365AHA,PAHH,PAHA,MaxAHH,MaxAHA,AvgAHH,AvgAHA,BFEAHH,BFEAHA,B365CH,B365CD,B365CA,BWCH,BWCD,BWCA,BFCH,BFCD,BFCA,PSCH,PSCD,PSCA,WHCH,WHCD,WHCA,1XBCH,1XBCD,1XBCA,MaxCH,MaxCD,MaxCA,AvgCH,AvgCD,AvgCA,BFECH,BFECD,BFECA,B365C>2.5,B365C<2.5,PC>2.5,PC<2.5,MaxC>2.5,MaxC<2.5,AvgC>2.5,AvgC<2.5,BFEC>2.5,BFEC<2.5,AHCh,B365CAHH,B365CAHA,PCAHH,PCAHA,MaxCAHH,MaxCAHA,AvgCAHH,AvgCAHA,BFECAHH,BFECAHA
```
