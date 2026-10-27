import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HYBRID_POLICY } from "./policy";
import { boundedSetting, eventOnce, sessionKey, sessionLimit, type SessionUsage } from "./activation";
export type BudgetPurpose = "VALIDATION" | "OUTCOME";
export function automaticBudget(): number {
  const n = process.env.API_FOOTBALL_DAILY_BUDGET === undefined ? 80 : Number(process.env.API_FOOTBALL_DAILY_BUDGET);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, HYBRID_POLICY.automaticCeiling) : 0;
}
export function validationBudget(): number { return Math.min(boundedSetting("API_FOOTBALL_VALIDATION_BUDGET", 60), Math.max(0, automaticBudget() - HYBRID_POLICY.outcomeReserve)); }
export function hybridLog(event: string, data: Record<string, string | number | boolean | null> = {}) {
  console.info(JSON.stringify({ event, ...data }));
}
// Reserve BEFORE HTTP, atomically across app workers/restarts. Failures are not refunded.
export async function reserveApiRequest(purpose: BudgetPurpose, db: Prisma.TransactionClient = prisma, now = new Date()): Promise<boolean> {
  // The session row lock and daily reservation commit together, including across independent clients.
  if ("$transaction" in db) return (db as typeof prisma).$transaction(tx => reserveApiRequest(purpose, tx, now));
  const key = sessionKey();
  await db.hybridApiCache.createMany({ data: { key }, skipDuplicates: true });
  await db.$queryRaw`SELECT "key" FROM "HybridApiCache" WHERE "key" = ${key} FOR UPDATE`;
  const session = await db.hybridApiCache.findUniqueOrThrow({ where: { key } });
  const usage = (session.payload as SessionUsage | null) ?? { requests: 0, validations: 0, outcomes: 0, lastRequest: null };
  if (usage.requests >= sessionLimit()) {
    await eventOnce("HYBRID_API_SKIPPED_BUDGET", key, db); return false;
  }
  const day = now.toISOString().slice(0, 10), cap = automaticBudget(), validationCap = validationBudget();
  const ceiling = purpose === "VALIDATION" ? validationCap : cap;
  if (!ceiling) { await eventOnce("HYBRID_API_SKIPPED_BUDGET", `${day}:${purpose}`, db); return false; }
  const rows = await db.$queryRaw<{ used: number; automaticUsed: number }[]>`
    INSERT INTO "ApiFootballBudget" ("day", "used", "automaticUsed", "validationUsed", "remoteLimit")
    VALUES (${day}, 1, 1, ${purpose === "VALIDATION" ? 1 : 0}, 100)
    ON CONFLICT ("day") DO UPDATE SET "used" = "ApiFootballBudget"."used" + 1,
      "automaticUsed" = "ApiFootballBudget"."automaticUsed" + 1,
      "validationUsed" = "ApiFootballBudget"."validationUsed" + ${purpose === "VALIDATION" ? 1 : 0}
    WHERE "ApiFootballBudget"."used" < LEAST(${ceiling}, "ApiFootballBudget"."remoteLimit")
      AND "ApiFootballBudget"."automaticUsed" < ${cap}
      AND (${purpose !== "VALIDATION"} OR "ApiFootballBudget"."validationUsed" < ${validationCap})
    RETURNING "used", "automaticUsed"`;
  if (!rows.length) { await eventOnce("HYBRID_API_SKIPPED_BUDGET", `${day}:${purpose}`, db); return false; }
  await db.hybridApiCache.update({ where: { key }, data: { fetchedAt: now, payload: {
    requests: usage.requests + 1, validations: usage.validations + (purpose === "VALIDATION" ? 1 : 0),
    outcomes: usage.outcomes + (purpose === "OUTCOME" ? 1 : 0), lastRequest: now.toISOString()
  } } });
  hybridLog("HYBRID_API_REQUEST", { purpose, sessionRequests: usage.requests + 1 });
  hybridLog("API_BUDGET_USED", { day, purpose, used: rows[0].used, automaticUsed: rows[0].automaticUsed });
  hybridLog("API_BUDGET_REMAINING", { day, remaining: Math.max(0, cap - rows[0].used), reserve: HYBRID_POLICY.outcomeReserve });
  return true;
}
export async function reconcileApiBudget(headers: Headers, db: Prisma.TransactionClient = prisma, now = new Date()) {
  const rawLimit = headers.get("x-ratelimit-requests-limit"), rawRemaining = headers.get("x-ratelimit-requests-remaining");
  if (rawLimit === null || rawRemaining === null) return;
  const limit = Number(rawLimit), remaining = Number(rawRemaining);
  if (!Number.isInteger(limit) || !Number.isInteger(remaining) || limit < 0 || remaining < 0 || remaining > limit) return;
  const day = now.toISOString().slice(0, 10), used = limit - remaining;
  await db.$executeRaw`INSERT INTO "ApiFootballBudget" ("day", "used", "automaticUsed", "validationUsed", "remoteLimit")
    VALUES (${day}, ${used}, 0, 0, ${limit}) ON CONFLICT ("day") DO UPDATE
    SET "used" = GREATEST("ApiFootballBudget"."used", ${used}), "remoteLimit" = LEAST("ApiFootballBudget"."remoteLimit", ${limit})`;
}
