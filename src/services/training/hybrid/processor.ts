import { Prisma, type HybridScout } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiFootballProvider } from "@/providers/football/apiFootball";
import { preserveFixtureAnchoredTeams, type AnchorRaw } from "@/services/historical/fixtureAnchoredTeams";
import { apiFootballObservation, confirmedScore, trainingReceipt, type TrainingObservation } from "../observation";
import { persistLiveMarketSnapshot, resolveFirstHalfSnapshotOutcomes, resolveFinalSnapshotOutcomes } from "../liveMarketSnapshots";
import { automaticBudget, hybridLog, reconcileApiBudget, reserveApiRequest, type BudgetPurpose } from "./budget";
import { jsonValue } from "./scout";
import { boundedSetting, eventOnce, hybridEnabled } from "./activation";
import { HYBRID_POLICY as P, canValidate, certificateExpiresAt, contradictory, hybridObservation, identityKey, isScout,
  compatibleIdentity, matchFixture, normalizeExact, type Certificate, type Identity, type PeriodFixture } from "./policy";

type Db = Prisma.TransactionClient;
type FetchFixtures = (params: { id: string } | { date: string }, budget: {
  reserve: () => Promise<boolean>; reconcile: (headers: Headers) => Promise<void>;
}) => Promise<PeriodFixture[]>;
type Options = { authorized?: boolean; projectedDailyRequests?: number };

function localAmbiguity(row: HybridScout, others: HybridScout[]): boolean {
  const i = row.identity as unknown as Identity;
  return others.some(other => {
    if (row.matchId === other.matchId) return false;
    const j = other.identity as unknown as Identity;
    return normalizeExact(i.home) === normalizeExact(j.home) && normalizeExact(i.away) === normalizeExact(j.away)
      && Math.abs(Date.parse(i.kickoff) - Date.parse(j.kickoff)) <= P.kickoffToleranceMs;
  });
}

// Called after the existing radar response, with explicit activation and reviewed projection.
// No independent timer. Dependency injection is for isolated tests only.
export async function runHybridBatch(options: Options = {}, db: Db = prisma, fetchFixtures?: FetchFixtures) {
  if (!hybridEnabled() || !options.authorized) return { state: "DISABLED", requests: 0 };
  if (!Number.isFinite(options.projectedDailyRequests) || options.projectedDailyRequests! < 0
    || options.projectedDailyRequests! > automaticBudget()) return { state: "SIMULATION_REQUIRED", requests: 0 };
  const provider = fetchFixtures ? null : new ApiFootballProvider();
  if (provider && !provider.isConfigured()) return { state: "MISSING_KEY", requests: 0 };
  const fetcher: FetchFixtures = fetchFixtures ?? ((params, budget) => provider!.getPeriodFixtures(params, budget));
  const now = new Date(), leaseUntil = new Date(now.getTime() + 120_000);
  await db.hybridApiCache.createMany({ data: { key: "batch-lease" }, skipDuplicates: true });
  const lease = await db.hybridApiCache.updateMany({ where: { key: "batch-lease", OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { lockedUntil: leaseUntil } });
  if (!lease.count) return { state: "BUSY", requests: 0 };
  let validationRequests = 0, outcomeRequests = 0, captures = 0;
  const teamAnchors: {matchId:string;raw:PeriodFixture;at:string}[]=[];
  async function request(params: { id: string } | { date: string }, purpose: BudgetPurpose, onReserved?: () => Promise<void>) {
    return fetcher(params, {
      reserve: async () => {
        if (new Date() >= leaseUntil || (purpose === "VALIDATION" ? validationRequests >= P.maxValidationRequestsPerBatch : outcomeRequests >= P.maxOutcomeRequestsPerBatch)) return false;
        const allowed = await reserveApiRequest(purpose, db);
        if (allowed) {
          if (purpose === "VALIDATION") validationRequests++; else outcomeRequests++;
          await onReserved?.();
        }
        return allowed;
      }, reconcile: headers => reconcileApiBudget(headers, db)
    });
  }
  async function applyOutcomes(row: HybridScout, observation: TrainingObservation) {
    const mapped = { ...observation, providerFixtureId: row.allSportsFixtureId };
    await resolveFirstHalfSnapshotOutcomes(row.matchId, mapped, db);
    await resolveFinalSnapshotOutcomes(row.matchId, mapped, db);
  }
  async function receive(row: HybridScout, raw: PeriodFixture, at: string) {
    teamAnchors.push({matchId:row.matchId,raw,at});
    const i = row.identity as unknown as Identity;
    const o = apiFootballObservation(raw, at);
    // Hybrid outcomes require explicit period scores; never use FT as an HT substitute.
    o.halfTimeScore = ["HALFTIME", "SECOND_HALF", "FINISHED"].includes(o.period)
      ? confirmedScore(raw.score?.halftime?.home, raw.score?.halftime?.away) : null;
    o.fullTimeScore = o.period === "FINISHED" ? confirmedScore(raw.score?.fulltime?.home, raw.score?.fulltime?.away) : null;
    await applyOutcomes(row, o);
    if (contradictory(o)) {
      await db.hybridScout.update({ where: { matchId: row.matchId }, data: { invalidated: true, certificate: Prisma.DbNull, phase: "CLOSED" } });
      return;
    }
    if (o.period !== "FIRST_HALF" || !o.score || o.score.home !== 0 || o.score.away !== 0 || o.minute === null) return;
    const c: Certificate = { apiFixtureId: String(raw.fixture.id), allSportsFixtureId: row.allSportsFixtureId,
      identityKey: identityKey(i), observedAt: at, expiresAt: certificateExpiresAt(at, o.minute), minute: o.minute, observation: o };
    const stored = await db.hybridScout.updateMany({ where: { matchId: row.matchId, invalidated: false }, data: {
      certificate: jsonValue(c), phase: "PERIOD_CONFIRMED",
      // Align the next validation to the ORIGINAL API receipt, not the time we read a
      // cached directory; otherwise an old cache would create a new evidence gap.
      nextValidationAt: new Date(Date.parse(at) + P.validationCooldownMs)
    } });
    if (!stored.count) return;
    await eventOnce("HYBRID_PERIOD_CONFIRMED", row.matchId, db);
    // Re-read after HTTP: a concurrently received goal/HT must win over an old scout.
    const latest = await db.hybridScout.findUniqueOrThrow({ where: { matchId: row.matchId } });
    const merged = !latest.invalidated && hybridObservation(i, latest.observation as unknown as TrainingObservation, c, latest.live);
    if (merged && latest.liveSnapshotId) {
      const captured = await persistLiveMarketSnapshot(row.matchId, latest.liveSnapshotId, merged, db);
      if (captured) captures++;
    }
  }
  try {
    const rows = await db.hybridScout.findMany({ orderBy: [{ priority: "desc" }, { matchId: "asc" }] });
    // Outcomes have first access to budget. Use already received AllSports outcomes first.
    for (const row of rows) {
      const o = row.observation as unknown as TrainingObservation;
      await applyOutcomes(row, o);
      if (!row.apiFootballFixtureId) continue;
      const [ht, ft] = await Promise.all([
        db.liveMarketSnapshot.count({ where: { matchId: row.matchId, goalBeforeHt: null } }),
        db.liveMarketSnapshot.count({ where: { matchId: row.matchId, goalBeforeFt: null } })
      ]);
      const kind = ft && o.period === "FINISHED" && !row.ftAttemptedAt ? "FT"
        : ht && ["HALFTIME", "SECOND_HALF", "FINISHED"].includes(o.period) && !row.htAttemptedAt ? "HT" : null;
      if (!kind || outcomeRequests >= P.maxOutcomeRequestsPerBatch) continue;
      // Mark only an actually reserved attempt. A budget denial must leave the outcome
      // pending for a future day, rather than spending its single permitted attempt.
      const field = kind === "HT" ? "htAttemptedAt" : "ftAttemptedAt";
      try {
        const result = await request({ id: row.apiFootballFixtureId }, "OUTCOME", async () => {
          await db.hybridScout.update({ where: { matchId: row.matchId }, data: { [field]: new Date() } });
        });
        const raw = matchFixture(row.identity as unknown as Identity, result, row.apiFootballFixtureId);
        const at = raw && trainingReceipt(raw);
        if (raw && at) await receive(row, raw, at);
      } catch { hybridLog("API_HYBRID_REQUEST_FAILED", { purpose: kind, matchId: row.matchId }); }
    }
    for (const row of rows) {
      if (new Date() >= leaseUntil || row.invalidated) continue;
      const identity = row.identity as unknown as Identity, o = row.observation as unknown as TrainingObservation;
      if (!isScout(o, row.live)) continue;
      const merged = hybridObservation(identity, o, row.certificate as unknown as Certificate | null, row.live);
      if (merged) {
        await eventOnce("HYBRID_PERIOD_CACHE_HIT", row.matchId, db);
        if (row.liveSnapshotId) await persistLiveMarketSnapshot(row.matchId, row.liveSnapshotId, merged, db);
        continue;
      }
      if (!canValidate(row.validationCount, row.nextValidationAt, new Date())) continue;
      if (localAmbiguity(row, rows)) { await eventOnce("HYBRID_MATCH_AMBIGUOUS", row.matchId, db); continue; }
      if (validationRequests >= P.maxValidationRequestsPerBatch) break;
      if (row.validationCount === 0) {
        // The durable batch lease serializes admission decisions across workers.
        const key = `admissions:${new Date().toISOString().slice(0, 10)}`;
        const admissions = await db.hybridApiCache.findUnique({ where: { key } });
        const ids = (admissions?.payload as string[] | null) ?? [];
        if (!ids.includes(row.matchId)) {
          if (ids.length >= boundedSetting("HYBRID_MAX_NEW_FIXTURES_PER_DAY", P.maxNewFixturesPerDay)) continue;
          await db.hybridApiCache.upsert({ where: { key }, create: { key, payload: [...ids, row.matchId] }, update: { payload: [...ids, row.matchId] } });
        }
      }
      await db.hybridScout.update({ where: { matchId: row.matchId }, data: {
        validationCount: { increment: 1 }, nextValidationAt: new Date(Date.now() + P.validationCooldownMs) } });
      try {
        let raw: PeriodFixture | null = null, at: string | null = null;
        if (row.apiFootballFixtureId) {
          const result = await request({ id: row.apiFootballFixtureId }, "VALIDATION");
          raw = matchFixture(identity, result, row.apiFootballFixtureId);
          at = raw && trainingReceipt(raw);
        } else {
          const date = new Date(identity.kickoff).toISOString().slice(0, 10), key = `directory:${date}`;
          let directory = await db.hybridApiCache.findUnique({ where: { key } });
          if (!directory?.fetchedAt || Date.now() - directory.fetchedAt.getTime() >= P.directoryTtlMs) {
            const list = await request({ date }, "VALIDATION");
            const receipt = trainingReceipt(list);
            if (!receipt) continue;
            directory = await db.hybridApiCache.upsert({ where: { key }, create: { key, payload: jsonValue(list), fetchedAt: new Date(receipt) },
              update: { payload: jsonValue(list), fetchedAt: new Date(receipt) } });
          }
          raw = matchFixture(identity, directory.payload as unknown as PeriodFixture[]);
          if (!raw) {
            const ids = new Set((directory.payload as unknown as PeriodFixture[]).filter(f => compatibleIdentity(identity, f)).map(f => String(f.fixture.id)));
            await eventOnce(ids.size > 1 ? "HYBRID_MATCH_AMBIGUOUS" : "HYBRID_MATCH_NOT_FOUND", row.matchId, db); continue;
          }
          // Unique DB index rejects reuse of an API fixture by another AllSports identity.
          await db.hybridScout.update({ where: { matchId: row.matchId }, data: { apiFootballFixtureId: String(raw.fixture.id) } });
          await eventOnce("HYBRID_MATCH_CONFIRMED", row.matchId, db);
          at = directory.fetchedAt!.toISOString();
          if (Date.now() - Date.parse(at) >= P.confirmationTtlMs) {
            const result = await request({ id: String(raw.fixture.id) }, "VALIDATION");
            raw = matchFixture(identity, result, String(raw.fixture.id)); at = raw && trainingReceipt(raw);
          }
        }
        if (raw && at) await receive(row, raw, at);
      } catch { hybridLog("API_HYBRID_REQUEST_FAILED", { purpose: "VALIDATION", matchId: row.matchId }); }
    }
    return { state: "COMPLETE", requests: validationRequests + outcomeRequests, validationRequests, outcomeRequests, captures };
  } finally {
    await db.hybridApiCache.updateMany({ where: { key: "batch-lease", lockedUntil: leaseUntil }, data: { lockedUntil: null } });
    // After all existing budget/capture/outcome work. Separate transactions; never fetch or reserve.
    if ('$transaction' in db) for(const anchor of teamAnchors){
      try{await preserveFixtureAnchoredTeams(db as unknown as import('@prisma/client').PrismaClient,anchor.matchId,anchor.raw as AnchorRaw,anchor.at);}
      catch{hybridLog('TEAM_ANCHOR_NOT_PERSISTED',{matchId:anchor.matchId});}
    }
  }
}
