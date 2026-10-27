import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MatchDetail } from "@/types/domain";
import type { TrainingObservation } from "../observation";
import { contradictory, hybridObservation, identityFromMatch, identityKey, isScout, priority, type Certificate, type Identity } from "./policy";
import { eventOnce } from "./activation";

export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

// Purely local ingestion hook: records scouts and consumes already persisted certificates.
// It cannot fetch, start a worker, or spend API budget, including when the switch is enabled.
export async function recordHybridScout(match: MatchDetail, fixture: { id: string; status: string }, liveSnapshotId: string | undefined, db: Prisma.TransactionClient, now = new Date()): Promise<TrainingObservation | undefined> {
  const o = match.trainingObservation, identity = identityFromMatch(match);
  if (!o || !identity) return o;
  if (db === prisma) return prisma.$transaction(tx => recordHybridScout(match, fixture, liveSnapshotId, tx, now));
  // Serialize first creation and lock the latest state before deciding whether a cached
  // AllSports response can replace it. An HT invalidation can never be overwritten.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.id}, 0))`;
  await db.$queryRaw`SELECT "matchId" FROM "HybridScout" WHERE "matchId" = ${fixture.id} FOR UPDATE`;
  const live = fixture.status === "LIVE" && match.status === "LIVE";
  const existing = await db.hybridScout.findUnique({ where: { matchId: fixture.id } });
  if (!existing && !isScout(o, live, now)) return o;
  // Cached/stale replies must not replace newer state or undo an HT invalidation.
  if (existing && Date.parse(o.observedAt) < existing.observedAt.getTime()) return o;
  const changedIdentity = existing && identityKey(existing.identity as unknown as Identity) !== identityKey(identity);
  const invalidated = !!existing?.invalidated || !!changedIdentity || contradictory(o) || !live;
  const cacheValid = !invalidated && hybridObservation(identity, o, existing?.certificate as unknown as Certificate | null, live, now);
  const phase = invalidated ? "CLOSED" : cacheValid ? "PERIOD_CONFIRMED" : "PENDING_PERIOD_CONFIRMATION";
  const data = { observation: jsonValue(o), observedAt: new Date(o.observedAt), live, liveSnapshotId: liveSnapshotId ?? null,
    priority: priority(o), invalidated, phase, ...(invalidated ? { certificate: Prisma.DbNull } : {}) };
  const row = await db.hybridScout.upsert({ where: { matchId: fixture.id }, update: data,
    create: { ...data, matchId: fixture.id, allSportsFixtureId: o.providerFixtureId, identity: jsonValue(identity) } });
  if (!existing) await eventOnce("HYBRID_CANDIDATE_QUEUED", fixture.id, db);
  if (invalidated) return o;
  const merged = hybridObservation(identity, o, row.certificate as unknown as Certificate | null, live, now);
  if (merged) await eventOnce("HYBRID_PERIOD_CACHE_HIT", fixture.id, db);
  return merged ?? o;
}

// Listings already received by either provider invalidate old 1H certificates, without HTTP.
export async function invalidateHybridEvidence(provider: string, observations: TrainingObservation[], db: Prisma.TransactionClient) {
  if (!["AllSportsApi", "API-Football"].includes(provider)) return;
  for (const o of observations.filter(contradictory)) {
    if (!Number.isFinite(Date.parse(o.observedAt))) continue;
    await db.hybridScout.updateMany({ where: {
      ...(provider === "AllSportsApi" ? { allSportsFixtureId: o.providerFixtureId } : { apiFootballFixtureId: o.providerFixtureId }),
      observedAt: { lte: new Date(o.observedAt) }
    }, data: { invalidated: true, certificate: Prisma.DbNull, phase: "CLOSED",
      ...(provider === "AllSportsApi" ? { observation: jsonValue(o), observedAt: new Date(o.observedAt), live: o.period !== "FINISHED" } : {}) } });
  }
}
