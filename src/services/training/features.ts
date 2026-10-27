import { createHash } from "node:crypto";
import type { ConfirmedScore, TrainingObservation } from "./observation";
import { availableOdds, observationTimeIssue, sealPointInTime } from "./pointInTime";

export const TRAINING_MARKET = { marketType: "OVER_0_5", marketPeriod: "FIRST_HALF" } as const;
export type WindowPoint = {
  matchId: string; marketType: string; marketPeriod: string;
  capturedAt: Date; minute: number; elapsedStoppageTime: number | null;
  homeSot: number | null; awaySot: number | null; homeXg: number | null; awayXg: number | null;
  homeBigChances: number | null; awayBigChances: number | null;
  homeCorners: number | null; awayCorners: number | null;
};
const elapsed = (p: Pick<WindowPoint, "minute" | "elapsedStoppageTime">) => p.minute + (p.elapsedStoppageTime ?? 0);
const sum = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;

export function isFirstHalfCandidate(o: TrainingObservation, now = new Date()): boolean {
  return candidateSkipReason(o, now) === null;
}

export function candidateSkipReason(o: TrainingObservation, now = new Date()): string | null {
  const age = now.getTime() - Date.parse(o.observedAt);
  if (!/^\d+$/.test(o.providerFixtureId) || Number(o.providerFixtureId) <= 0) return "MISSING_FIXTURE_ID";
  if (o.period !== "FIRST_HALF" || o.periodEvidence?.period !== "FIRST_HALF" || o.periodEvidence.confidence !== "CONFIRMED") return "INVALID_PERIOD";
  if (!o.score) return "UNKNOWN_SCORE";
  if (o.score.home !== 0 || o.score.away !== 0) return "ALREADY_SCORED";
  if (o.minute === null || !Number.isInteger(o.minute) || o.minute < 1 || o.minute > 45
    || (o.elapsedStoppageTime !== null && (!Number.isInteger(o.elapsedStoppageTime) || o.minute !== 45 || o.elapsedStoppageTime < 0 || o.elapsedStoppageTime > 30))) return "INVALID_MINUTE";
  if (!Number.isFinite(age) || age < 0 || age > 180_000) return "STALE_OBSERVATION";
  return observationTimeIssue(o);
}

export function calculateRecentWindowMetrics(current: WindowPoint, history: WindowPoint[], refreshSeconds = 120) {
  const nowMinute = elapsed(current);
  // Maximum observed spacing allowed; not a betting threshold.
  const maxGap = Math.max(1, Math.ceil(refreshSeconds / 60) + 1);
  const ordered = history.filter(p => p.matchId === current.matchId && p.marketType === current.marketType && p.marketPeriod === current.marketPeriod
    && p.capturedAt < current.capturedAt && elapsed(p) <= nowMinute)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const all = [...ordered, current];
  const windows = [5, 10, 15].map(size => {
    const target = nowMinute - size;
    // At/before the target only: never extrapolate the beginning of a window.
    const baseline = [...ordered].reverse().find(p => elapsed(p) <= target && elapsed(p) >= target - 1);
    const segment = baseline ? all.filter(p => p.capturedAt >= baseline.capturedAt) : [];
    let observed = 0;
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i], gap = elapsed(b) - elapsed(a);
      if (gap > 0 && gap <= maxGap && b.capturedAt.getTime() - a.capturedAt.getTime() <= maxGap * 60_000) {
        observed += Math.max(0, Math.min(nowMinute, elapsed(b)) - Math.max(target, elapsed(a)));
      }
    }
    const coverage = Math.min(100, Math.round(100 * observed / size));
    const continuous = segment.length >= 2 && segment.every((p, i) => i === 0 || (
      elapsed(p) >= elapsed(segment[i - 1]) && elapsed(p) - elapsed(segment[i - 1]) <= maxGap
      && p.capturedAt.getTime() - segment[i - 1].capturedAt.getTime() <= maxGap * 60_000));
    const delta = (home: "homeSot" | "homeXg" | "homeBigChances" | "homeCorners", away: "awaySot" | "awayXg" | "awayBigChances" | "awayCorners") => {
      if (!baseline || !continuous || coverage < 100) return null;
      // A reset/correction or a missing side invalidates that metric, never clamps it to zero.
      if (segment.some((p, i) => p[home] === null || p[away] === null || (i > 0 && (
        p[home]! < segment[i - 1][home]! || p[away]! < segment[i - 1][away]!)))) return null;
      return Math.round(((current[home]! - baseline[home]!) + (current[away]! - baseline[away]!)) * 10000) / 10000;
    };
    return { size, coverage, baselineMinute: baseline ? elapsed(baseline) : null,
      sot: delta("homeSot", "awaySot"), xg: delta("homeXg", "awayXg"),
      bigChances: delta("homeBigChances", "awayBigChances"), corners: delta("homeCorners", "awayCorners") };
  });
  return {
    sotLast5: windows[0].sot, sotLast10: windows[1].sot, sotLast15: windows[2].sot,
    xgLast5: windows[0].xg, xgLast10: windows[1].xg, xgLast15: windows[2].xg,
    bigChancesLast5: windows[0].bigChances, bigChancesLast10: windows[1].bigChances, bigChancesLast15: windows[2].bigChances,
    cornersLast5: windows[0].corners, cornersLast10: windows[1].corners, cornersLast15: windows[2].corners,
    coveragePercent: windows[2].coverage, windows
  };
}

export function minutesRemainingMarket(o: TrainingObservation): number | null {
  if (o.minute === null) return null;
  const played = o.minute + (o.elapsedStoppageTime ?? 0);
  if (o.stoppageTime !== null) return Math.max(0, 45 + o.stoppageTime - played);
  return played < 45 ? 45 - played : null;
}

export function snapshotSourceHash(o: TrainingObservation, refreshSeconds = 120): string {
  const bucket = Math.floor(Date.parse(o.observedAt) / (Math.max(60, refreshSeconds) * 1000));
  // Changes within the same minute/bucket survive. Cached replays keep their receipt time.
  return createHash("sha256").update(JSON.stringify({ fixture: o.providerFixtureId, bucket, period: o.period,
    minute: o.minute, extra: o.elapsedStoppageTime, stoppage: o.stoppageTime, score: o.score, stats: o.stats,
    odds: o.odds ? { price: o.odds.price, bookmaker: o.odds.bookmaker } : null },
    // PostgreSQL JSONB reorders object keys. A persisted hybrid observation must hash
    // identically to the original in-memory observation (including nested stats/score).
    o.hybridEvidence ? (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value : undefined)).digest("hex");
}

export function buildSnapshotFeatures(matchId: string, o: TrainingObservation, history: WindowPoint[], refreshSeconds = 120) {
  if (!isFirstHalfCandidate(o)) return null;
  // Receipt time, not an old provider quote time, controls availability.
  o = { ...o, odds: availableOdds(o) };
  const h = o.stats.home, a = o.stats.away;
  const basic = {
    matchId, providerFixtureId: o.providerFixtureId, capturedAt: new Date(o.observedAt), ...TRAINING_MARKET,
    periodProvider: o.periodProvider ?? (o.periodEvidence?.provider === "API-Football" ? "API_FOOTBALL" : o.periodEvidence?.provider === "AllSportsApi" ? "ALLSPORTS" : null),
    statsProvider: o.statsProvider ?? (o.periodEvidence?.provider === "API-Football" ? "API_FOOTBALL" : o.periodEvidence?.provider === "AllSportsApi" ? "ALLSPORTS" : null),
    oddsProvider: o.odds ? o.oddsProvider ?? (o.periodEvidence?.provider === "API-Football" ? "API_FOOTBALL" : "ALLSPORTS") : null,
    minute: o.minute!, stoppageTime: o.stoppageTime, elapsedStoppageTime: o.elapsedStoppageTime,
    homeScore: o.score!.home, awayScore: o.score!.away, goalsNeeded: 1, minutesRemainingMarket: minutesRemainingMarket(o),
    homeShots: h.shots, awayShots: a.shots, totalShots: sum(h.shots, a.shots),
    homeSot: h.sot, awaySot: a.sot, totalSot: sum(h.sot, a.sot),
    homeXg: h.xg, awayXg: a.xg, totalXg: sum(h.xg, a.xg),
    homeBigChances: h.bigChances, awayBigChances: a.bigChances, totalBigChances: sum(h.bigChances, a.bigChances),
    homeShotsInsideBox: h.shotsInsideBox, awayShotsInsideBox: a.shotsInsideBox, totalShotsInsideBox: sum(h.shotsInsideBox, a.shotsInsideBox),
    homeCorners: h.corners, awayCorners: a.corners, totalCorners: sum(h.corners, a.corners),
    homeDangerousAttacks: h.dangerousAttacks, awayDangerousAttacks: a.dangerousAttacks, totalDangerousAttacks: sum(h.dangerousAttacks, a.dangerousAttacks),
    homeRedCards: h.redCards, awayRedCards: a.redCards,
    homeOver05FirstHalfRate: null, awayOver05FirstHalfRate: null,
    homeAvgGoalsFirstHalf: null, awayAvgGoalsFirstHalf: null, homeZeroZeroHtRate: null, awayZeroZeroHtRate: null,
    marketOdds: o.odds?.price ?? null, oddsBookmaker: o.odds?.bookmaker ?? null,
    oddsQuotedAt: o.odds ? new Date(o.odds.quotedAt) : null
  };
  const { windows, ...recent } = calculateRecentWindowMetrics(basic, history, refreshSeconds);
  const values: Record<string, number | null> = { ...Object.fromEntries(Object.entries(h).map(([k, v]) => [`home.${k}`, v])),
    ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`away.${k}`, v])),
    ...Object.fromEntries(Object.entries(recent).filter(([k]) => k !== "coveragePercent")),
    marketOdds: basic.marketOdds, homeOver05FirstHalfRate: null, awayOver05FirstHalfRate: null,
    homeAvgGoalsFirstHalf: null, awayAvgGoalsFirstHalf: null, homeZeroZeroHtRate: null, awayZeroZeroHtRate: null };
  const missing = Object.keys(values).filter(k => values[k] === null);
  const confirmedZero = Object.keys(values).filter(k => values[k] === 0);
  return { ...basic, ...recent, sourceHash: snapshotSourceHash(o, refreshSeconds),
    dataQuality: Math.round(100 * (Object.keys(values).length - missing.length) / Object.keys(values).length),
    dataQualityDetails: { version: 1, missing, confirmedZero, windows,
      pointInTime: sealPointInTime({ ...basic, ...recent }, o),
      ...(o.hybridEvidence ? { hybridEvidence: o.hybridEvidence } : {}),
      remainingTimeBasis: o.stoppageTime !== null ? "CONFIRMED_ADDED_TIME" : o.minute! < 45 ? "REGULATION_ONLY_LOWER_BOUND" : "UNKNOWN_ADDED_TIME",
      history: "FIRST_HALF_HISTORY_UNAVAILABLE", observedAt: o.observedAt } };
}

export function forwardGoalLabel(snapshot: { homeScore: number; awayScore: number }, outcome: ConfirmedScore | null): boolean | null {
  if (!outcome || outcome.home < snapshot.homeScore || outcome.away < snapshot.awayScore) return null;
  return outcome.home + outcome.away > snapshot.homeScore + snapshot.awayScore;
}
