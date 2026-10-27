import type { Prisma, LiveMarketSnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MatchDetail } from "@/types/domain";
import type { TrainingObservation } from "./observation";
import { buildSnapshotFeatures, candidateSkipReason, forwardGoalLabel, TRAINING_MARKET } from "./features";
import { datasetEvent } from "./telemetry";
import { datasetMonitoring } from "./monitoring";
import { hybridStatus } from "./hybrid/status";
import { recordHybridScout, invalidateHybridEvidence } from "./hybrid/scout";
import { hybridObservation, type Certificate, type Identity } from "./hybrid/policy";
import { pointInTimeIssue, observationTimeIssue } from "./pointInTime";

type Client = Prisma.TransactionClient;
const refreshSeconds = () => Math.max(1, Number(process.env.LIVE_REFRESH_SECONDS) || 120);

export async function persistLiveMarketSnapshot(matchId: string, liveSnapshotId: string, observation: TrainingObservation, db: Client = prisma): Promise<LiveMarketSnapshot | null> {
  if (observation.hybridEvidence) {
    // Serialize a hybrid capture with HT/goal invalidation on the same persisted scout.
    if (db === prisma) return prisma.$transaction(tx => persistLiveMarketSnapshot(matchId, liveSnapshotId, observation, tx));
    await db.$queryRaw`SELECT "matchId" FROM "HybridScout" WHERE "matchId" = ${matchId} FOR UPDATE`;
    const scout = await db.hybridScout.findUnique({ where: { matchId } });
    const certificate = scout?.certificate as unknown as Certificate | null;
    if (!scout || scout.invalidated || scout.apiFootballFixtureId !== observation.hybridEvidence.apiFixtureId
      || !certificate || certificate.apiFixtureId !== scout.apiFootballFixtureId
      || !hybridObservation(scout.identity as unknown as Identity, observation, certificate, scout.live)) {
      datasetEvent("DATASET_SKIPPED", matchId, "HYBRID_EVIDENCE_INVALIDATED"); return null;
    }
  }
  const skip = candidateSkipReason(observation);
  if (skip) { datasetEvent("DATASET_SKIPPED", matchId, skip, 1, skip === "UNKNOWN_SCORE" || (skip === "INVALID_PERIOD" && observation.period === "UNKNOWN"), skip === "INVALID_PERIOD" ? observation.periodEvidence : undefined); return null; }
  const source = await db.liveSnapshot.findUnique({ where: { id: liveSnapshotId }, select: { fixtureId: true, fixture: { select: { externalId: true, status: true, provider: true } } } });
  if (source?.fixtureId !== matchId) throw new Error("Training snapshot/fixture mismatch");
  if (source.fixture.externalId !== observation.providerFixtureId) throw new Error("Training provider fixture mismatch");
  if (observation.hybridEvidence && source.fixture.provider !== "AllSportsApi") throw new Error("Hybrid stats provider mismatch");
  if (source.fixture.status !== "LIVE") { datasetEvent("DATASET_SKIPPED", matchId, "NOT_LIVE"); return null; }
  // A stale pre-HT replay must not reopen a market already settled locally.
  if (await db.liveMarketSnapshot.findFirst({ where: { matchId, ...TRAINING_MARKET, htResolvedAt: { not: null } }, select: { id: true } })) {
    datasetEvent("DATASET_SKIPPED", matchId, "MARKET_RESOLVED"); return null;
  }
  const capturedAt = new Date(observation.observedAt);
  const history = await db.liveMarketSnapshot.findMany({
    where: { matchId, ...TRAINING_MARKET, capturedAt: { lt: capturedAt, gte: new Date(capturedAt.getTime() - 20 * 60_000) } },
    orderBy: { capturedAt: "asc" }
  });
  const features = buildSnapshotFeatures(matchId, observation, history.filter(row => !pointInTimeIssue(row)), refreshSeconds());
  if (!features) return null;
  const inserted = await db.liveMarketSnapshot.createMany({ data: { ...features, liveSnapshotId }, skipDuplicates: true });
  datasetEvent(inserted.count ? "DATASET_CAPTURED" : "DATASET_SKIPPED", matchId, inserted.count ? undefined : "DUPLICATE");
  return db.liveMarketSnapshot.findUnique({ where: { matchId_marketType_marketPeriod_sourceHash: {
    matchId, ...TRAINING_MARKET, sourceHash: features.sourceHash
  } } });
}

export async function resolveFirstHalfSnapshotOutcomes(matchId: string, o: TrainingObservation, db: Client = prisma) {
  if (!["HALFTIME", "SECOND_HALF", "FINISHED"].includes(o.period) || !o.halfTimeScore) return 0;
  const observedAt = new Date(o.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() || observationTimeIssue(o)) return 0;
  const rows = await db.liveMarketSnapshot.findMany({ where: { matchId, providerFixtureId: o.providerFixtureId, ...TRAINING_MARKET,
    goalBeforeHt: null, capturedAt: { lt: observedAt } } });
  let resolved = 0;
  for (const row of rows) {
    const label = forwardGoalLabel(row, o.halfTimeScore);
    if (label === null) continue;
    const result = await db.liveMarketSnapshot.updateMany({ where: { id: row.id, goalBeforeHt: null }, data: {
      goalBeforeHt: label, htResolvedAt: observedAt,
      ...(row.goalBeforeFt !== null ? { resultResolvedAt: observedAt } : {})
    } });
    resolved += result.count;
  }
  await completeResolvedRows(matchId, observedAt, db);
  if (resolved) datasetEvent("DATASET_HT_RESOLVED", matchId, undefined, resolved);
  return resolved;
}

export async function resolveFinalSnapshotOutcomes(matchId: string, o: TrainingObservation, db: Client = prisma) {
  if (o.period !== "FINISHED" || !o.fullTimeScore) return 0;
  const observedAt = new Date(o.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() || observationTimeIssue(o)) return 0;
  const rows = await db.liveMarketSnapshot.findMany({ where: { matchId, providerFixtureId: o.providerFixtureId, ...TRAINING_MARKET,
    goalBeforeFt: null, capturedAt: { lt: observedAt } } });
  let resolved = 0;
  for (const row of rows) {
    const label = forwardGoalLabel(row, o.fullTimeScore);
    if (label === null) continue;
    const result = await db.liveMarketSnapshot.updateMany({ where: { id: row.id, goalBeforeFt: null }, data: {
      goalBeforeFt: label, finalHomeScore: o.fullTimeScore.home, finalAwayScore: o.fullTimeScore.away, ftResolvedAt: observedAt,
      resultResolvedAt: row.goalBeforeHt !== null ? observedAt : null
    } });
    resolved += result.count;
  }
  await completeResolvedRows(matchId, observedAt, db);
  if (resolved) datasetEvent("DATASET_FT_RESOLVED", matchId, undefined, resolved);
  return resolved;
}

async function completeResolvedRows(matchId: string, at: Date, db: Client) {
  await db.liveMarketSnapshot.updateMany({ where: { matchId, ...TRAINING_MARKET,
    goalBeforeHt: { not: null }, goalBeforeFt: { not: null }, resultResolvedAt: null
  }, data: { resultResolvedAt: at } });
}

// Dataset failures are explicit in server logs, but cannot change betting decisions.
export async function observeLiveMarketDataset(match: MatchDetail, fixture: { id: string; status: string }, liveSnapshotId?: string, db: Client = prisma) {
  if (match.demo) { datasetEvent("DATASET_SKIPPED", fixture.id, "DEMO"); return; }
  if (!match.trainingObservation) { datasetEvent("DATASET_SKIPPED", fixture.id, "MISSING_OBSERVATION"); return; }
  let observation = match.trainingObservation;
  try { observation = await recordHybridScout(match, fixture, liveSnapshotId, db) ?? observation; }
  catch (error) { logTrainingError(error); }
  try {
    if (fixture.status === "LIVE" && match.status === "LIVE" && liveSnapshotId) {
      await persistLiveMarketSnapshot(fixture.id, liveSnapshotId, observation, db);
    } else {
      datasetEvent("DATASET_SKIPPED", fixture.id, fixture.status !== "LIVE" || match.status !== "LIVE" ? "NOT_LIVE" : "MISSING_FIXTURE_ID");
    }
    await resolveFirstHalfSnapshotOutcomes(fixture.id, observation, db);
    await resolveFinalSnapshotOutcomes(fixture.id, observation, db);
  } catch (error) { logTrainingError(error); }
}

// Uses the raw results ALREADY fetched by the existing list/cron/radar.
// No provider requests, no scheduling, and no new fixtures created by this path.
export async function resolveObservedMarketResults(provider: string, observations: TrainingObservation[], db: Client = prisma) {
  try { await invalidateHybridEvidence(provider, observations, db); }
  catch (error) { logTrainingError(error); }
  const outcomes = observations.filter(o => o.halfTimeScore || o.fullTimeScore);
  if (!outcomes.length) return;
  try {
    if (provider === "API-Football") {
      const mappings = await db.hybridScout.findMany({ where: { apiFootballFixtureId: { in: outcomes.map(o => o.providerFixtureId) } } });
      for (const mapping of mappings) {
        for (const o of outcomes.filter(o => o.providerFixtureId === mapping.apiFootballFixtureId)) {
          const aligned = { ...o, providerFixtureId: mapping.allSportsFixtureId };
          await resolveFirstHalfSnapshotOutcomes(mapping.matchId, aligned, db);
          await resolveFinalSnapshotOutcomes(mapping.matchId, aligned, db);
        }
      }
    }
    const fixtures = await db.fixture.findMany({ where: { provider,
      externalId: { in: outcomes.map(o => o.providerFixtureId) },
      marketSnapshots: { some: { ...TRAINING_MARKET, resultResolvedAt: null } }
    }, select: { id: true, externalId: true } });
    for (const fixture of fixtures) {
      for (const o of outcomes.filter(item => item.providerFixtureId === fixture.externalId)) {
        await resolveFirstHalfSnapshotOutcomes(fixture.id, o, db);
        await resolveFinalSnapshotOutcomes(fixture.id, o, db);
      }
    }
  } catch (error) { logTrainingError(error); }
}

function logTrainingError(error: unknown) {
  console.error("[training.over05-first-half] persistence/resolution failed", {
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "TRAINING_ERROR"
  });
}

export type TrainingFilters = { minMinute?: number; maxMinute?: number; minDataQuality?: number; limit?: number };
export function parseTrainingFilters(params: URLSearchParams): TrainingFilters {
  const result: TrainingFilters = {};
  for (const key of ["minMinute", "maxMinute", "minDataQuality", "limit"] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    const max = key === "limit" ? 1000 : key === "minDataQuality" ? 100 : 45;
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(value) || value < (key === "limit" ? 1 : 0) || value > max
      || (key !== "minDataQuality" && !Number.isInteger(value))) throw new Error(`Invalid ${key}`);
    result[key] = value;
  }
  if (result.minMinute !== undefined && result.maxMinute !== undefined && result.minMinute > result.maxMinute) throw new Error("minMinute exceeds maxMinute");
  return result;
}

export async function trainingSummary(filters: TrainingFilters, db: Client = prisma) {
  const where: Prisma.LiveMarketSnapshotWhereInput = { ...TRAINING_MARKET,
    minute: { gte: filters.minMinute, lte: filters.maxMinute }, dataQuality: { gte: filters.minDataQuality } };
  const [aggregate, positives, negatives, finalResolvedSnapshots, sample, queuedCandidates, confirmedMappings] = await Promise.all([
    db.liveMarketSnapshot.aggregate({ where, _count: true, _avg: {
      minute: true, totalSot: true, totalXg: true, totalBigChances: true, marketOdds: true, coveragePercent: true } }),
    db.liveMarketSnapshot.count({ where: { ...where, goalBeforeHt: true } }),
    db.liveMarketSnapshot.count({ where: { ...where, goalBeforeHt: false } }),
    db.liveMarketSnapshot.count({ where: { ...where, resultResolvedAt: { not: null } } }),
    filters.limit ? db.liveMarketSnapshot.findMany({ where, orderBy: [{ capturedAt: "desc" }, { id: "desc" }], take: filters.limit }) : Promise.resolve(undefined),
    db.hybridScout.count({ where: { phase: "PENDING_PERIOD_CONFIRMATION", invalidated: false } }),
    db.hybridScout.count({ where: { apiFootballFixtureId: { not: null } } })
  ]);
  const resolved = positives + negatives;
  const monitoring = await datasetMonitoring(filters, db);
  return { ...TRAINING_MARKET, ...monitoring, ...await hybridStatus(db), queuedCandidates, confirmedMappings, totalSnapshots: aggregate._count, resolvedSnapshots: resolved,
    unresolvedSnapshots: aggregate._count - resolved, positives, negatives,
    positiveRate: resolved ? positives / resolved : null,
    averageMinute: aggregate._avg.minute, averageTotalSot: aggregate._avg.totalSot,
    averageTotalXg: aggregate._avg.totalXg, averageBigChances: aggregate._avg.totalBigChances,
    averageOdds: aggregate._avg.marketOdds, averageCoveragePercent: aggregate._avg.coveragePercent,
    finalResolvedSnapshots, ...(sample ? { snapshots: sample } : {}) };
}
