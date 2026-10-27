import { FixtureStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildLiveMomentumAnalysis, type StoredLiveSnapshot } from "@/services/analysis/liveMomentum";
import type { MatchDetail } from "@/types/domain";

export type BacktestBucket = {
  bucket: string;
  predictions: number;
  wins: number;
  losses: number;
  brierScore: number | null;
};

export type BacktestSummary = {
  market: string;
  predictions: number;
  wins: number;
  losses: number;
  brierScore: number | null;
  buckets: BacktestBucket[];
  note: string;
};

export type GoalPressureBacktestSummary = {
  signals: number;
  goalsWithin5: number;
  goalsWithin10: number;
  goalsWithin15: number;
  hitRate5: number | null;
  hitRate10: number | null;
  hitRate15: number | null;
  note: string;
};

export async function runBasicGoalBacktest(limit = 80): Promise<BacktestSummary> {
  const fixtures = await prisma.fixture.findMany({
    where: { status: FixtureStatus.FINISHED },
    include: { league: true, homeTeam: true, awayTeam: true, teamStats: true },
    orderBy: { kickoff: "desc" },
    take: limit
  });

  const predictions = [];
  for (const fixture of fixtures) {
    const previous = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        kickoff: { lt: fixture.kickoff },
        OR: [
          { homeTeamId: fixture.homeTeamId },
          { awayTeamId: fixture.homeTeamId },
          { homeTeamId: fixture.awayTeamId },
          { awayTeamId: fixture.awayTeamId }
        ]
      },
      orderBy: { kickoff: "desc" },
      take: 20
    });
    if (previous.length < 10) continue;
    const rawRate = previous.filter((item) => item.homeScore + item.awayScore > 1.5).length / previous.length;
    const estimated = (rawRate * previous.length + 0.72 * 12) / (previous.length + 12);
    const actual = fixture.homeScore + fixture.awayScore > 1.5 ? 1 : 0;
    predictions.push({ estimated, actual });
  }

  const brierScore = predictions.length
    ? predictions.reduce((total, item) => total + Math.pow(item.estimated - item.actual, 2), 0) / predictions.length
    : null;

  return {
    market: "Over 1.5 goles",
    predictions: predictions.length,
    wins: predictions.filter((item) => item.actual === 1).length,
    losses: predictions.filter((item) => item.actual === 0).length,
    brierScore: brierScore === null ? null : Math.round(brierScore * 1000) / 1000,
    buckets: buildBuckets(predictions),
    note: predictions.length < 50 ? "Muestra insuficiente para afirmar calibracion real." : "Backtest basico sin leakage temporal; aun requiere mas mercados y ligas."
  };
}

export async function runGoalPressureSignalBacktest(limit = 40): Promise<GoalPressureBacktestSummary> {
  const fixtures = await prisma.fixture.findMany({
    where: { status: FixtureStatus.FINISHED },
    include: {
      league: true,
      homeTeam: true,
      awayTeam: true,
      liveSnapshots: { orderBy: { timestamp: "asc" } }
    },
    orderBy: { kickoff: "desc" },
    take: limit
  });

  let signals = 0;
  let goalsWithin5 = 0;
  let goalsWithin10 = 0;
  let goalsWithin15 = 0;

  for (const fixture of fixtures) {
    const snapshots = fixture.liveSnapshots.map(mapSnapshot);
    for (let index = 1; index < snapshots.length; index += 1) {
      const current = snapshots[index];
      if (current.minute === null || current.minute >= 86) continue;
      const match = matchFromSnapshot(fixture, current);
      const momentum = buildLiveMomentumAnalysis(match, snapshots.slice(0, index + 1));
      if (momentum?.goalPressureSignal !== "FUERTE") continue;

      signals += 1;
      if (hasFutureGoal(current, snapshots.slice(index + 1), 5)) goalsWithin5 += 1;
      if (hasFutureGoal(current, snapshots.slice(index + 1), 10)) goalsWithin10 += 1;
      if (hasFutureGoal(current, snapshots.slice(index + 1), 15)) goalsWithin15 += 1;
    }
  }

  return {
    signals,
    goalsWithin5,
    goalsWithin10,
    goalsWithin15,
    hitRate5: rate(goalsWithin5, signals),
    hitRate10: rate(goalsWithin10, signals),
    hitRate15: rate(goalsWithin15, signals),
    note: signals < 30 ? "Backtest inicial con muestra insuficiente; sin leakage temporal porque cada señal usa solo snapshots anteriores." : "Backtest inicial sin leakage temporal."
  };
}

function buildBuckets(predictions: Array<{ estimated: number; actual: number }>): BacktestBucket[] {
  return [
    ["50-59", 0.5, 0.599],
    ["60-69", 0.6, 0.699],
    ["70-79", 0.7, 0.799],
    ["80-89", 0.8, 0.899],
    ["90+", 0.9, 1]
  ].map(([bucket, min, max]) => {
    const items = predictions.filter((item) => item.estimated >= Number(min) && item.estimated <= Number(max));
    const brier = items.length ? items.reduce((total, item) => total + Math.pow(item.estimated - item.actual, 2), 0) / items.length : null;
    return {
      bucket: String(bucket),
      predictions: items.length,
      wins: items.filter((item) => item.actual === 1).length,
      losses: items.filter((item) => item.actual === 0).length,
      brierScore: brier === null ? null : Math.round(brier * 1000) / 1000
    };
  });
}

function hasFutureGoal(current: StoredLiveSnapshot, future: StoredLiveSnapshot[], minutes: 5 | 10 | 15) {
  const currentMinute = current.minute;
  if (currentMinute === null) return false;
  const currentGoals = current.homeScore + current.awayScore;
  return future.some((snapshot) => snapshot.minute !== null && snapshot.minute <= currentMinute + minutes && snapshot.homeScore + snapshot.awayScore > currentGoals);
}

function mapSnapshot(snapshot: { timestamp: Date; minute: number | null; homeScore: number; awayScore: number; homeShots: number | null; awayShots: number | null; homeShotsOnTarget: number | null; awayShotsOnTarget: number | null; homeXg: unknown; awayXg: unknown; homeCorners: number | null; awayCorners: number | null; homeYellowCards: number | null; awayYellowCards: number | null; homeRedCards: number | null; awayRedCards: number | null; homePossession: number | null; awayPossession: number | null; homeDangerousAttacks: number | null; awayDangerousAttacks: number | null }): StoredLiveSnapshot {
  return {
    timestamp: snapshot.timestamp,
    minute: snapshot.minute,
    homeScore: snapshot.homeScore,
    awayScore: snapshot.awayScore,
    homeShots: snapshot.homeShots,
    awayShots: snapshot.awayShots,
    homeShotsOnTarget: snapshot.homeShotsOnTarget,
    awayShotsOnTarget: snapshot.awayShotsOnTarget,
    homeXg: decimalNumber(snapshot.homeXg),
    awayXg: decimalNumber(snapshot.awayXg),
    homeCorners: snapshot.homeCorners,
    awayCorners: snapshot.awayCorners,
    homeYellowCards: snapshot.homeYellowCards,
    awayYellowCards: snapshot.awayYellowCards,
    homeRedCards: snapshot.homeRedCards,
    awayRedCards: snapshot.awayRedCards,
    homePossession: snapshot.homePossession,
    awayPossession: snapshot.awayPossession,
    homeDangerousAttacks: snapshot.homeDangerousAttacks,
    awayDangerousAttacks: snapshot.awayDangerousAttacks
  };
}

function matchFromSnapshot(
  fixture: Awaited<ReturnType<typeof prisma.fixture.findMany>>[number] & { league: { name: string }; homeTeam: { name: string }; awayTeam: { name: string } },
  snapshot: StoredLiveSnapshot
): MatchDetail {
  return {
    id: `${fixture.provider.toLowerCase()}-${fixture.externalId}`,
    source: fixture.provider === "DEMO" ? "demo" : fixture.provider === "API-Football" ? "api-football" : "allsports",
    homeTeam: fixture.homeTeam.name,
    awayTeam: fixture.awayTeam.name,
    competition: fixture.league.name,
    status: "LIVE",
    minute: snapshot.minute,
    score: { home: snapshot.homeScore, away: snapshot.awayScore },
    kickoffAt: fixture.kickoff.toISOString(),
    demo: fixture.provider === "DEMO",
    stats: {
      home: { possession: snapshot.homePossession, shots: snapshot.homeShots, shotsOnTarget: snapshot.homeShotsOnTarget, xg: snapshot.homeXg, corners: snapshot.homeCorners, yellowCards: snapshot.homeYellowCards, redCards: snapshot.homeRedCards, fouls: null, dangerousAttacks: snapshot.homeDangerousAttacks },
      away: { possession: snapshot.awayPossession, shots: snapshot.awayShots, shotsOnTarget: snapshot.awayShotsOnTarget, xg: snapshot.awayXg, corners: snapshot.awayCorners, yellowCards: snapshot.awayYellowCards, redCards: snapshot.awayRedCards, fouls: null, dangerousAttacks: snapshot.awayDangerousAttacks }
    },
    lineups: { home: [], away: [] },
    substitutions: [],
    events: [],
    playerStats: [],
    odds: [],
    oddsHistory: [],
    analysis: [],
    alerts: []
  };
}

function decimalNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rate(value: number, total: number) {
  if (!total) return null;
  return Math.round((value / total) * 1000) / 1000;
}
