import type { Prisma } from "@prisma/client";
import { automaticBudget } from "./budget";
import { hybridEnabled, sessionKey, sessionLimit, type SessionUsage } from "./activation";

export async function hybridStatus(db: Prisma.TransactionClient) {
  const [daily, session, last, detected, ambiguous, notFound] = await Promise.all([
    db.apiFootballBudget.findUnique({ where: { day: new Date().toISOString().slice(0, 10) } }),
    db.hybridApiCache.findUnique({ where: { key: sessionKey() } }),
    db.liveMarketSnapshot.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    db.hybridScout.count(),
    db.hybridApiCache.count({ where: { key: { startsWith: "telemetry:HYBRID_MATCH_AMBIGUOUS:" } } }),
    db.hybridApiCache.count({ where: { key: { startsWith: "telemetry:HYBRID_MATCH_NOT_FOUND:" } } })
  ]);
  const usage = session?.payload as SessionUsage | null;
  return { hybridProcessorEnabled: hybridEnabled(), detectedCandidates: detected, ambiguousMatches: ambiguous, notFoundMatches: notFound,
    apiRequestsToday: daily?.automaticUsed ?? 0, apiValidationRequests: daily?.validationUsed ?? 0,
    apiOutcomeRequests: (daily?.automaticUsed ?? 0) - (daily?.validationUsed ?? 0),
    apiRemainingAutomaticBudget: Math.max(0, Math.min(automaticBudget(), daily?.remoteLimit ?? 100) - (daily?.used ?? 0)),
    sessionRequests: usage?.requests ?? 0, sessionLimit: sessionLimit(),
    lastHybridRequest: usage?.lastRequest ?? null, lastDatasetCapture: last?.capturedAt ?? null,
    requestAccounting: "Conservative reservations before HTTP; failures are not refunded."
  };
}
