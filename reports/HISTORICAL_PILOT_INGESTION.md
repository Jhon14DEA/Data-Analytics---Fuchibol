# Piloto histórico: adapter preparado, ejecución real bloqueada

Fecha: 2026-10-13. Continuación de `HISTORICAL_FOUNDATION.md`.

**NO-GO para ingesta real y para ampliar a temporada completa.** Se aplicó la condición explícita del encargo: si no se verifica acceso seguro a la API, no ejecutar HTTP y detenerse después de implementar el adapter. No se consultó `/status`, `/leagues`, fixtures ni endpoints de detalle. No hubo scraping de datos de partidos.

## Proveedor, competición y acceso

- Proveedor propuesto: API-Football. Su esquema explícito de resultados HT/FT y endpoints separados encaja con el normalizador histórico existente. No se reutiliza el cliente LIVE porque contiene hooks de persistencia y reservas de cuota ajenos a esta ingesta.
- Competición propuesta: Premier League, England, ID `39`, verificado previamente en el directorio local. Clasificación y allowlist existentes: MEN_SENIOR. No basta el nombre para autorizar una competición.
- Temporada propuesta: `2025`, etiqueta 2025/26. **Acceso de esta cuenta a esa temporada no verificado**. No se eligió una alternativa sin evidencia de acceso.
- `API_FOOTBALL_KEY=<configured>`: comprobación booleana privada con carga Next de entorno; no autentica ni acredita acceso histórico.
- Evidencia local anterior: plan Free, 100 requests/día. No se revalidó cuota restante actual ni consumo externo.
- AllSports: no se dispone de evidencia suficiente del límite y cobertura histórica de esta cuenta para cambiar de proveedor.

La documentación oficial indica 100 requests/día para Free y disponibilidad de temporadas limitada; no demuestra acceso de nuestra cuenta a 2025/26 ([pricing](https://www.api-football.com/pricing)). La cobertura se consulta por liga y temporada; la guía de cuota también indica 10 requests/minuto en Free ([guía oficial de cuota](https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage)). Las odds prepartido tienen retención limitada, no un archivo completo de temporadas ([guía oficial](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide)). Se consultó documentación pública, no la API de datos.

## Alcance implementado y límite deliberado

`src/services/historical/provider.ts` define `HistoricalFootballProvider` con `fetchFixtures`, `fetchFixtureStats`, `fetchEvents`, `fetchLineups`, `fetchOdds`. La implementación API-Football separa estas operaciones, aplica allowlist/clasificación, selecciona un máximo de 20 fixtures únicos FT de la competición y temporada solicitadas, y rechaza detalles de fixtures fuera de esa selección. AET/PEN no se convierten silenciosamente en FT.

Sin transporte suministrado para pruebas devuelve `NOT_AVAILABLE / UNVERIFIED_ACCOUNT_SEASON_AND_HISTORICAL_QUOTA`. Las capacidades no verificadas devuelven `NOT_AVAILABLE`; no se sustituyen por arrays vacíos ni ceros. Dry-run es predeterminado y no invoca transporte. No existe opción CLI de escritura o activación real.

La dependencia `OFFLINE_TEST` permite probar respuestas ya suministradas: cache de sesión, copias defensivas, límite configurable por sesión, reserva antes de await y ningún retry implícito. **Ese límite no es una cuota diaria persistente de producción**, y el cache no pretende sobrevivir reinicios. No se ha conectado esta dependencia a fetch ni a clientes LIVE.

Se detuvo aquí por la condición de seguridad: quedan pendientes el transporte autenticado real, verificación de capacidades/temporada, cuota histórica persistente independiente, integración de respuestas de eventos/alineaciones/odds con el worker y telemetría de una ingesta real. No se presenta el contrato offline como una ingesta operativa completa. El pipeline transaccional, mappings, outcomes y checkpoints de la fase anterior se conservan y sus pruebas se volvieron a ejecutar.

## Plan offline ejecutado

```powershell
npm.cmd run historical:build
npm.cmd run historical:pilot -- --competition=39 --season=2025 --limit=20 --dry-run
```

Resultado: `BLOCKED_UNVERIFIED_SEASON_ACCESS`, requests reales **0**. Host futuro: `v3.football.api-sports.io`. Plan condicional si las capacidades estuvieran verificadas:

| Operación | Endpoint | Máximo |
|---|---|---:|
| Listado FT de competición 39 y temporada 2025 | `/fixtures?league=39&season=2025&status=FT` | 1 |
| Estadísticas de IDs seleccionados | `/fixtures/statistics?fixture=<id>` | 20 |
| Eventos de esos mismos IDs | `/fixtures/events?fixture=<id>` | 20 |
| Alineaciones de esos mismos IDs | `/fixtures/lineups?fixture=<id>` | 20 |
| Odds de esa temporada | NOT_AVAILABLE, sin `/odds/live` | 0 |
| Total condicional | Sin otra página, sin retry, sin otra temporada | **61** |

Este es un techo de planificación, no un plan aprobado para ejecutarse. Estadísticas/eventos/alineaciones cuestan hasta tres requests de detalle por fixture, más el listado compartido. No se consumen esos 61 requests. Un futuro plan ejecutable también debe fijar una ventana compatible con el worker (máximo siete días), comprobar cuota disponible y limitar caudal; no debe pasar un lote arbitrario de toda la temporada al worker.

No se creó ni modificó `ApiFootballBudget`, sus límites o la reserva LIVE. Tampoco se asignó otra cuota de 100 al histórico: sería la misma cuenta. Si se mantiene el máximo automático LIVE de 80/día, no puede asumirse que los 20 restantes estén disponibles para histórico, pues existe uso manual/externo. Antes del transporte real hace falta una reserva independiente durable y coordinación con el límite total real. No se requiere migración para este contrato offline; no se añadió ninguna.

## Resultados y cobertura reales

| Métrica del piloto | Resultado |
|---|---|
| HTTP proveedor | 0 |
| Fixtures recibidos / aceptados / rechazados | 0 / 0 / 0 |
| Fixtures insertados / actualizados | 0 / 0 |
| Teams nuevos / existentes procesados | 0 / 0 |
| Outcomes resueltos en el piloto | 0 |
| Mappings fallidos / ambiguos procesados | 0 / 0 |
| Errores HTTP | Ninguna solicitud ejecutada |
| Bloqueo | Acceso de temporada y cuota histórica sin verificar |
| Tiempo de ingesta | N/D: no ejecutada |
| Stats, period stats, eventos, lineups, odds disponibles | N/D: sin fixtures recibidos |
| Campos NULL por categoría | N/D: sin observaciones reales |

Cobertura de goals, shots, SOT, xG, corners, cards, fouls, possession, events, lineups, period stats y odds: **N/D para todas**, denominador cero. No se informa 0% como si hubiera una muestra evaluada. No existen cinco fixtures reales del piloto para revisión manual, por lo que no se generan ejemplos ficticios ni outcomes supuestos.

## Base de datos e integridad

Lecturas comparadas en `historical-pilot-verification.json`:

| Tabla | Antes | Después |
|---|---:|---:|
| Fixture | 503 | 503 |
| LiveSnapshot | 4353 | 4353 |
| LiveMarketSnapshot | 17 | 17 |
| HybridScout | 47 | 47 |
| OddsSnapshot | 785057 | 785057 |
| Season | 0 | 0 |
| TeamPeriodStats | 0 | 0 |
| HistoricalMarketOutcome | 0 | 0 |
| ProviderEntityMapping | 0 | 0 |
| HistoricalIngestionState | 0 | 0 |

Hash completo de filas LMS antes/después: `54b085e1ade5c99bb663a242015985307132b94845fe5b3baaa340242d0f10e5`.
Hash de budget antes/después: `dc4372b6bdc127fc75ff902b7eb62a5789b1e085e4c37b290389e34dbc4ae885`.
Los 92 archivos protegidos de análisis, training, providers, lib, app y componentes coinciden con sus hashes previos. BET_SCORE, ENTRY/NO_ENTRY, thresholds, radar, LIVE/PIT y budget intactos. No se activó polling, processor automático, backtesting ni ML. N/D continúa siendo NULL.

## Validación

- **201/201 pruebas, 0 fallos**: 186 existentes y 15 nuevas del adapter. Salida en `historical-pilot-tests.txt`.
- Nuevas: límite 20, dry-run sin transporte, bloqueo real por falta de acceso/cuota, allowlist, WOMEN/YOUTH, identidad de competición/temporada, exclusión LIVE, deduplicación, stats NULL, odds no verificadas, cache, aislamiento de mutaciones, errores sin retry, tope concurrente de sesión y ausencia de imports/hooks LIVE.
- Existentes vueltas a ejecutar: idempotencia, retry sin eventos duplicados, actualización de fixture, outcomes, rollback/checkpoints, mappings, protección LIVE/PIT y presupuesto híbrido.
- Pruebas DB en `fut_historical_test_pilot_20261013`, creada solo con esquema y eliminada al terminar. Ningún dato sintético escrito en la BD real.
- `prisma validate`: OK.
- `prisma generate`: OK.
- `prisma migrate status`: OK; seis migraciones, ninguna pendiente. La migración histórica sigue aplicada. Sin reset, db push ni nueva migración.
- `historical:build`: OK.
- `npm run build`: OK, con bloqueo de HTTP de proveedores mediante preload de pruebas.

## MCP e impacto

Se usaron `index_repository`, `get_architecture` (dependencies, entry_points, layers), `search_graph` para worker/normalizador/clientes/cache/reserva/mappings, `trace_path` sobre `runHistoricalBatch` y `reserveApiRequest`, y `detect_changes` para impacto. El diff global contiene fases anteriores y no se atribuye íntegramente a esta entrega. La traza confirma que el worker tiene caller CLI y reutiliza normalización, validación, persistencia y parsing PIT de odds, sin caller de ruta LIVE.

Documentos leídos: solicitud adjunta, `HISTORICAL_FOUNDATION.md`, evidencia previa de plan en `HYBRID_CONTROLLED_ACTIVATION.md` y `HYBRID_PHASE_CLOSEOUT.md`, verificaciones y resultados locales. Fragmentos consultados: clientes `apiFootball.ts`/AllSports, configuración de rendimiento/capacidades, `historical/{normalize,scope}.ts`, `historical-worker.cjs`, `package.json`, pruebas de persistencia histórica/training. No se imprimieron archivos de entorno ni claves.

Archivos de implementación de esta fase: `src/services/historical/provider.ts`, `scripts/historical-pilot.cjs`, `tests/historical/provider.test.cjs`, dos scripts añadidos a `package.json`. Evidencias: este informe, `historical-pilot-before.json`, `historical-pilot-verification.json`, `historical-pilot-tests.txt`.

**Decisión final: NO-GO.** Falta verificar acceso real y cuota antes de conectar transporte; después medir cobertura y revisar fixtures reales antes de autorizar una temporada completa. Esta entrega se detiene en el adapter offline conforme a la alternativa explícita del encargo.
