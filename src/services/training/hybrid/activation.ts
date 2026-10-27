import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function hybridEnabled() {
  return (process.env.HYBRID_DATASET_PROCESSOR_ENABLED ?? process.env.API_FOOTBALL_HYBRID_ENABLED) === "true";
}
export function boundedSetting(name: string, fallback: number) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, fallback) : 0;
}
// Stable across restarts and UTC days. Starting another session requires an explicit configuration change.
export const sessionKey = () => `activation-session:${process.env.HYBRID_DATASET_SESSION_ID || "controlled-20261008"}`;
export const sessionLimit = () => boundedSetting("MAX_REAL_API_REQUESTS_SESSION", 10);
export type SessionUsage = { requests: number; validations: number; outcomes: number; lastRequest: string | null };
export async function eventOnce(event: string, matchId: string, db: Prisma.TransactionClient = prisma) {
  const result = await db.hybridApiCache.createMany({ data: { key: `telemetry:${event}:${matchId}`, fetchedAt: new Date() }, skipDuplicates: true });
  if (result.count) console.info(JSON.stringify({ event, matchId }));
}
