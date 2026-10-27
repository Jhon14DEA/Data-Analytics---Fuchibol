# Transporte informativo de estadísticas LIVE

Implementado el 2026-10-16. Alcance exclusivo: bigChances y shotsInsideBox.

## Archivos

- src/types/domain.ts: propiedades opcionales nullable para compatibilidad con proveedores y objetos antiguos.
- src/providers/football/allSportsApi.ts: normalización principal reutiliza strictStats; solo incorpora sus dos campos informativos. No cambia xG ni el selector existente de tiros.
- src/services/persistence/footballPersistence.ts: escritura de cuatro columnas nullable; el hash ya incluye stats completos. Lectura del último snapshot mediante include acotado, sin N+1; exige coincidencia de minuto y marcador antes de asociar sus valores al MatchDetail local.
- src/services/analysis/liveGoalRadar.ts: acumulados combinados disponibles solo cuando ambos equipos tienen datos. N/D de presentación refleja cobertura real. La calidad usada para scoring mantiene exactamente los faltantes anteriores; las ventanas bigChancesNew/shotsInsideBoxNew siguen NULL. No se añaden entradas a pesos, gates ni thresholds.
- prisma/schema.prisma y prisma/migrations/20261016193000_live_informational_stats/migration.sql: cuatro columnas Int? sin defaults ni backfill.
- tests/live-stats-transport.test.cjs: siete pruebas nuevas.

La UI existente ya muestra Grandes ocas. y Tiros área desde candidate.accumulated; no necesita cambios. La cobertura visible no cambia la calidad empleada por las decisiones.

## Migración y compatibilidad

Migración aditiva aplicada mediante prisma migrate deploy. Los snapshots antiguos mantienen NULL. No se reconstruyen valores de otros minutos, no se toma evidencia híbrida posterior para rellenar snapshots pasados y no se modifica ningún registro histórico.

Se detuvo únicamente Next del proyecto para liberar la DLL bloqueada de Prisma y se reinició el servidor de desarrollo al finalizar las validaciones.

## Pruebas y validación

26/26 pruebas pasan: siete nuevas más suites radar-review-now y historical/live-context. Incluyen presencia y cero explícito, ausencia/N/D, nombres exactos (no confundir ocasiones perdidas con totales), payload de persistencia, lectura de snapshot/candidato, snapshot antiguo o desalineado, cobertura parcial, comparación de salidas del motor BET_SCORE/ENTRY y radar ALERT, y escritura/lectura PostgreSQL real con rollback de ambos snapshots de prueba.

Prisma validate: OK. Prisma generate: OK tras liberar la DLL. Prisma migrate status: nueve migraciones, schema actualizado. npm run build: OK, incluyendo generación Prisma, tipos y compilación Next.

## Resultado

Ambos campos llegan al candidato y sus tarjetas cuando existen en la normalización principal; quedan NULL si faltan. Verificado mediante pruebas, sin consultar al proveedor para fabricar una captura LIVE. No se afirma que el partido Frankfurt–Köln haya recibido ahora valores nuevos.

BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds, budgets y xG no cambiaron. No se añadieron requests, polling ni cambios de mapping histórico. Las consultas del servidor reiniciado conservan su comportamiento previo.
