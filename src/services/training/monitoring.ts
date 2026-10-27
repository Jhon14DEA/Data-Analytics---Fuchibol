import { Prisma } from "@prisma/client";
import type { TrainingFilters } from "./liveMarketSnapshots";
import { datasetDiagnostics } from "./telemetry";

export function datasetHealth(total: number, unresolvedHt: number, coverage: Record<string, { coveragePercent: number | null }>, diagnostics = datasetDiagnostics()) {
  const reasons: string[] = [];
  if (!total) return { status: "EMPTY" as const, reasons: ["NO_SNAPSHOTS"] };
  if (unresolvedHt / total > .5) reasons.push("HT_UNRESOLVED_ABOVE_50_PERCENT");
  if ((coverage.SOT?.coveragePercent ?? 0) < 50 || (coverage.corners?.coveragePercent ?? 0) < 50) reasons.push("KEY_FEATURE_COVERAGE_BELOW_50_PERCENT");
  const attempts = diagnostics.captured + diagnostics.qualityRejected;
  if (attempts >= 20 && diagnostics.qualityRejected / attempts > .5) reasons.push("SCORE_PERIOD_REJECTIONS_ABOVE_50_PERCENT");
  return { status: reasons.length ? "WARNING" as const : "HEALTHY" as const, reasons };
}

export async function datasetMonitoring(filters: TrainingFilters, db: Prisma.TransactionClient) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const columns = { SOT: "totalSot", xG: "totalXg", bigChances: "totalBigChances", shotsInsideBox: "totalShotsInsideBox", corners: "totalCorners", dangerousAttacks: "totalDangerousAttacks", odds: "marketOdds" };
  // Identifiers below are exclusively static code constants, never request input.
  const expressions = Object.entries(columns).map(([name, column]) => Prisma.sql`count(*) FILTER (WHERE ${Prisma.raw(`"${column}"`)} IS NOT NULL)::int AS ${Prisma.raw(`"${name}"`)}`);
  for (const [index, size] of [5, 10, 15].entries()) {
    expressions.push(Prisma.sql`count(*) FILTER (WHERE ${Prisma.raw(`"dataQualityDetails" #>> '{windows,${index},coverage}'`)} = '100'
      AND (${Prisma.raw(["sot", "xg", "bigChances", "corners"].map(metric => `"${metric}Last${size}" IS NOT NULL`).join(" OR "))}))::int AS ${Prisma.raw(`"last${size}"`)}`);
  }
  const conditions = [Prisma.sql`"marketType" = 'OVER_0_5' AND "marketPeriod" = 'FIRST_HALF'`];
  if (filters.minMinute !== undefined) conditions.push(Prisma.sql`"minute" >= ${filters.minMinute}`);
  if (filters.maxMinute !== undefined) conditions.push(Prisma.sql`"minute" <= ${filters.maxMinute}`);
  if (filters.minDataQuality !== undefined) conditions.push(Prisma.sql`"dataQuality" >= ${filters.minDataQuality}`);
  const buckets = [[1,10],[11,15],[16,20],[21,25],[26,30],[31,35],[36,40],[41,45]];
  buckets.forEach(([a,b],i) => expressions.push(Prisma.sql`count(*) FILTER (WHERE "minute" BETWEEN ${a} AND ${b})::int AS ${Prisma.raw(`"bucket${i}"`)}`));
  type Row = Record<string, number> & { lastSnapshot: Date | null; lastHtResolved: Date | null; lastFtResolved: Date | null };
  const [row] = await db.$queryRaw<Row[]>(Prisma.sql`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE "capturedAt" >= ${today} AND "capturedAt" < ${tomorrow})::int AS today,
    count(DISTINCT "matchId")::int AS fixtures,
    count("goalBeforeHt")::int AS ht, count("goalBeforeFt")::int AS ft,
    max("capturedAt") AS "lastSnapshot", max("htResolvedAt") AS "lastHtResolved", max("ftResolvedAt") AS "lastFtResolved",
    ${Prisma.join(expressions)} FROM "LiveMarketSnapshot" WHERE ${Prisma.join(conditions, " AND ")}`);
  const names = [...Object.keys(columns), "last5", "last10", "last15"];
  const featureCoverage = Object.fromEntries(names.map(name => [name, { availableCount: row[name], missingCount: row.total - row[name], coveragePercent: row.total ? Math.round(row[name] / row.total * 10000) / 100 : null }]));
  const diagnostics = datasetDiagnostics();
  return { todaySnapshots: row.today, todayTimezone: "UTC", fixturesObserved: row.fixtures,
    resolvedHt: row.ht, unresolvedHt: row.total - row.ht, resolvedFt: row.ft, unresolvedFt: row.total - row.ft,
    featureCoverage, minuteBuckets: Object.fromEntries(buckets.map(([a,b],i) => [`${a}-${b}${b===45?"+":""}`, row[`bucket${i}`]])),
    lastSnapshot: row.lastSnapshot, lastHtResolved: row.lastHtResolved, lastFtResolved: row.lastFtResolved,
    health: datasetHealth(row.total, row.total - row.ht, featureCoverage, diagnostics), diagnostics,
    monitoringPolicy: { scope: "ALL_MATCHING_FILTERS_NOT_LIMIT", lastWindowAvailability: "100% temporal coverage and at least one non-null window metric",
      windowCoverageLocation: "snapshots[].dataQualityDetails.windows[{size,coverage}]", rejectionMinimumTransitions: 20,
      keyFeatures: ["SOT", "corners"], warningCoverageBelowPercent: 50, warningUnresolvedHtAbovePercent: 50,
      note: "Unresolved HT includes ongoing matches; health is informational only. Rejection diagnostics are process-local." } };
}
