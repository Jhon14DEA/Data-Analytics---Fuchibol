# Historical Feature Builder

Fecha: 2026-10-15. **GO_FOR_LIVE_HISTORICAL_CONTEXT** para una futura integración explícita. El builder permanece independiente: no se conectó al radar, no se entrenó ML, no se ejecutó backfill ni HTTP.

## Arquitectura e interfaz

`src/services/historical/teamProfile.ts` separa una agregación pura (`calculateTeamHistoricalProfile`) de un lector acotado e inyectable (`createTeamHistoricalProfileBuilder`). La API directa es:

```ts
await buildTeamHistoricalProfile(teamId, before, {
  window: 5,                 // 5 | 10 | 20
  venue: 'ALL',              // ALL | HOME | AWAY
  competitionId: leagueId,   // opcional; ID interno de League, no código SP1/E0
});
```

`teamId` es la identidad interna existente. No une equipos de proveedores distintos por nombre ni introduce mappings. FT usa TeamPeriodStats del proveedor canónico del fixture, con fallback a TeamMatchStats; HT requiere TeamPeriodStats FIRST_HALF explícito del mismo proveedor. No usa los scores de Fixture, cuyos defaults históricos podrían confundir desconocidos con cero. No se consultan odds ni se escriben features en BD.

Codebase Memory fue intentado primero y devolvió `Transport closed`. Se verificaron fragmentos locales de schema, tipos, persistencia histórica y cliente Prisma. No se pudo obtener un grafo actualizado en esta fase.

## Contrato temporal

- Solo FINISHED con `kickoff < before`; igualdad excluye el fixture consultado. Orden kickoff descendente y ID ascendente para empates.
- Fixture.createdAt y updatedAt deben ser estrictamente anteriores al corte. Period stats requieren receivedAt anterior; fallback TeamMatchStats requiere createdAt y updatedAt anteriores.
- Las fechas sin hora (`kickoffPrecision=DATE`) solo se admiten si son de un día UTC anterior al corte. Nunca se interpreta la medianoche técnica como hora de partido confirmada. Precisión desconocida se excluye.
- Esto es una política conservadora de disponibilidad observada en FUT. **No reconstruye versiones anteriores de filas mutables**: si la última actualización es posterior a T, se excluye, sin inventar el valor que existía entonces.
- Los backfills recibidos en octubre de 2026 no se consideran disponibles para una predicción de mayo de 2025. Puede devolver muestra vacía en ese caso. No se habilitó modo retrospectivo ni entrenamiento.
- Las fechas oldest/newest son kickoff del registro; para precisión DATE representan solo fecha. La selección no usa resultados para escoger los últimos N: una estadística ausente reduce cobertura, no sustituye el partido por otro más antiguo.

## Features y NULL

Ventanas 5/10/20 y filtros ALL/HOME/AWAY aplicados antes de LIMIT. Incluye matches, wins/draws/losses, goalsFor/Against, avgGoalsFor/Against, scored/conceded/cleanSheet/BTTS rates; Over 0.5/1.5/2.5 FT; Over 0.5/1.5 HT; promedios shots, shotsOnTarget, corners, yellowCards, redCards y fouls; scoring/conceding streak.

Cada estadística agregada exige **100% de cobertura de la muestra seleccionada**, y al menos una observación. Es una política de este nuevo perfil, no un cambio de thresholds del motor. Una ventana 20 con 8 partidos devuelve sampleSize=8, sin rellenar 12 observaciones. Las tasas son fracciones 0–1. Cero confirmado es válido; NULL, N/D, valores inválidos y denominador cero producen NULL. El recuento de partidos puede ser legítimamente cero.

Coverage expone available/missing/ratio para FT conjunto, HT conjunto, goalsFor, goalsAgainst y cada estadística individual. Un denominador vacío da ratio NULL. sampleSize, fixtureIds, oldestFixtureDate y newestFixtureDate permiten auditar la selección.

Las rachas recorren la ventana desde el partido más reciente y terminan al primer cero confirmado. Si se encuentra un desconocido antes de ese corte, devuelven NULL. Si toda la muestra continúa la racha, streakCensored indica que el valor está limitado por la ventana y no prueba dónde comenzó la racha real.

## Queries y rendimiento

Un findMany de Fixture con filtros de identidad, competición opcional, disponibilidad y fecha; `take=N`, máximo 20. Select explícito de columnas; relaciones teamStats y periodStats cargadas en lote. Prisma emitió **3 SQL por perfil**, constantes respecto a N: fixtures y dos consultas IN para estadísticas. Sin consulta por partido, sin N+1.

Predicado principal equivalente:

```sql
WHERE ("homeTeamId" = $team OR "awayTeamId" = $team)
  AND status = 'FINISHED' AND kickoff < $before
  AND "createdAt" < $before AND "updatedAt" < $before
  AND ("kickoffPrecision" = 'EXACT'
    OR ("kickoffPrecision" = 'DATE' AND kickoff < $dayStart))
ORDER BY kickoff DESC, id ASC LIMIT $window
```

HOME/AWAY usan solo la columna correspondiente; competitionId añade leagueId. Los índices existentes cubren kickoff, homeTeamId, awayTeamId, liga/temporada/kickoff y relaciones de stats. EXPLAIN ANALYZE del selector ALL/20 usó Fixture_kickoff_idx hacia atrás e incremental sort: devolvió 20 filas, leyó 21 coincidencias y descartó 1428 filas por filtros, en **1.003 ms**. No recalcula toda la historia en memoria. La latencia SQL observada no constituye garantía para todos los equipos/cortes. No se justifican índices nuevos ni materialized views con esta medición.

## Validación y seguridad

- **9/9 pruebas nuevas OK**: N/orden, deduplicación, determinismo, localía, competición, HT/FT/BTTS, cards/corners, NULL/N/D, fechas futuras/actuales/observaciones posteriores, fecha sin hora, coverage, rachas, proveniencia y fallback seguro; lector acotado con una llamada Prisma.
- Compilación histórica TypeScript: OK.
- Prisma validate: OK; generate: OK; migrate status: 8 migraciones, al día.
- `npm run build`: OK. No cambio de schema ni migraciones.
- Validación real en transacción PostgreSQL READ ONLY, con HTTP bloqueado en el script. 27 perfiles, sin escrituras de dominio ni checkpoints. Hashes de contenido y counts protegidos idénticos dentro de la instantánea transaccional.
- 92 archivos protegidos mantienen exactamente los hashes del baseline histórico: BET_SCORE, ENTRY/NO_ENTRY, thresholds, radar, proveedores LIVE/PIT y budgets sin cambios.
- No se ejecutó la suite global ni pruebas que requieran escritura; las nuevas pruebas son puras/con dobles en memoria. No se iniciaron servidores, polling ni providers.

Archivos nuevos: `src/services/historical/teamProfile.ts`, `tests/historical/team-profile.test.cjs`, `scripts/historical-feature-check.cjs`, este informe, `reports/historical-feature-profiles.json` y logs `historical-feature-check.log`, `historical-feature-tests.log`, `historical-feature-build.log`. No se modificó código previo del motor ni la infraestructura de persistencia.

## Perfiles reales

Las identidades se resolvieron con igualdad de nombre dentro de FOOTBALL_DATA y país. Manchester City usa el alias explícito existente **Man City**; Real Madrid e Inter coinciden exactamente. Si hubiera más de una coincidencia el script falla, no elige por aproximación. El JSON adjunto contiene identidades, los 27 perfiles completos, fechas, IDs de fixtures, coverage, query count, latencia y plan SQL.

Todas las ventanas obtuvieron exactamente N partidos; cobertura **100% en todos los campos implementados** en los 27 perfiles. Los resultados describen la historia cargada, no garantizan que la BD esté actualizada hasta el presente: las fechas newestFixtureDate del JSON deben controlarse antes de una futura integración LIVE. La recomendación GO no autoriza conectar al radar en esta fase.

Corte utilizado: `2026-10-15T20:16:46.682Z`. Tablas siguientes: venue ALL; HOME/AWAY completos en JSON.

### Resultados y goles

| Equipo | N | wins | draws | losses | goalsFor | goalsAgainst | avgGoalsFor | avgGoalsAgainst |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Manchester City | 5 | 4 | 1 | 0 | 8 | 2 | 1.6 | 0.4 |
| Manchester City | 10 | 7 | 3 | 0 | 19 | 6 | 1.9 | 0.6 |
| Manchester City | 20 | 13 | 4 | 3 | 42 | 18 | 2.1 | 0.9 |
| Real Madrid | 5 | 4 | 0 | 1 | 12 | 7 | 2.4 | 1.4 |
| Real Madrid | 10 | 8 | 0 | 2 | 19 | 11 | 1.9 | 1.1 |
| Real Madrid | 20 | 14 | 2 | 4 | 37 | 20 | 1.85 | 1 |
| Inter | 5 | 3 | 1 | 1 | 7 | 3 | 1.4 | 0.6 |
| Inter | 10 | 6 | 2 | 2 | 16 | 8 | 1.6 | 0.8 |
| Inter | 20 | 11 | 5 | 4 | 33 | 20 | 1.65 | 1 |

### Tasas FT y HT

| Equipo | N | scoredRate | concededRate | cleanSheetRate | bttsRate | over05FtRate | over15FtRate | over25FtRate | over05HtRate | over15HtRate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Manchester City | 5 | 0.8 | 0.4 | 0.6 | 0.4 | 0.8 | 0.6 | 0.4 | 0.8 | 0.4 |
| Manchester City | 10 | 0.8 | 0.4 | 0.6 | 0.4 | 0.8 | 0.7 | 0.4 | 0.7 | 0.5 |
| Manchester City | 20 | 0.8 | 0.5 | 0.5 | 0.4 | 0.9 | 0.75 | 0.5 | 0.75 | 0.5 |
| Real Madrid | 5 | 1 | 0.6 | 0.4 | 0.6 | 1 | 1 | 0.6 | 0.8 | 0.4 |
| Real Madrid | 10 | 1 | 0.5 | 0.5 | 0.5 | 1 | 0.7 | 0.5 | 0.8 | 0.3 |
| Real Madrid | 20 | 0.95 | 0.65 | 0.35 | 0.6 | 1 | 0.8 | 0.55 | 0.85 | 0.35 |
| Inter | 5 | 0.8 | 0.4 | 0.6 | 0.2 | 1 | 0.6 | 0.2 | 1 | 0 |
| Inter | 10 | 0.8 | 0.6 | 0.4 | 0.4 | 1 | 0.7 | 0.4 | 0.8 | 0.3 |
| Inter | 20 | 0.8 | 0.7 | 0.3 | 0.5 | 1 | 0.75 | 0.5 | 0.7 | 0.35 |

### Actividad y rachas

| Equipo | N | avgShots | avgShotsOnTarget | avgCorners | avgYellowCards | avgRedCards | avgFouls | scoringStreak | concedingStreak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Manchester City | 5 | 16.2 | 4.6 | 7.6 | 0.8 | 0.2 | 7.2 | 2 | 0 |
| Manchester City | 10 | 15.2 | 5.2 | 5.6 | 1.1 | 0.1 | 8.2 | 2 | 0 |
| Manchester City | 20 | 14.45 | 5.55 | 5.1 | 1 | 0.05 | 7.5 | 2 | 0 |
| Real Madrid | 5 | 19.4 | 7.6 | 10 | 1.2 | 0 | 8 | 5 | 0 |
| Real Madrid | 10 | 18.9 | 7.5 | 8.9 | 1.3 | 0.1 | 8.5 | 10 | 0 |
| Real Madrid | 20 | 18.15 | 6.8 | 7.3 | 1.45 | 0.15 | 8.45 | 16 | 0 |
| Inter | 5 | 11.8 | 4.2 | 4 | 1.8 | 0 | 9.2 | 4 | 0 |
| Inter | 10 | 12.7 | 3.8 | 4.3 | 2 | 0.1 | 10.2 | 4 | 0 |
| Inter | 20 | 14.3 | 4.45 | 5.35 | 1.45 | 0.05 | 10.95 | 4 | 0 |

### Integridad de tablas protegidas

| Tabla | Antes | Despu?s | Hash id?ntico |
|---|---:|---:|---|
| LiveSnapshot | 4353 | 4353 | S? |
| LiveMarketSnapshot | 17 | 17 | S? |
| HybridScout | 47 | 47 | S? |
| ApiFootballBudget | 3 | 3 | S? |
