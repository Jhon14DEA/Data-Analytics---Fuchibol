import { NextResponse } from "next/server";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";
import { buildLiveMomentumAnalysis, type StoredLiveSnapshot } from "@/services/analysis/liveMomentum";
import type { AnalyzedMarket, MatchAnalysisContext, MatchDetail } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const cases = [
    scenario("A 0-0 min50 O1.5 necesita 2 goles", 50, { home: 0, away: 0 }, { shots: [7, 5], sot: [2, 1], corners: [4, 2], dangerous: [32, 24], attacks: [52, 44] }, [
      { minute: 35, shots: [4, 3], sot: [1, 1], corners: [2, 1], dangerous: [20, 15], attacks: [34, 29] },
      { minute: 40, shots: [5, 4], sot: [1, 1], corners: [3, 1], dangerous: [24, 18], attacks: [40, 34] },
      { minute: 45, shots: [6, 4], sot: [2, 1], corners: [3, 2], dangerous: [28, 21], attacks: [46, 39] }
    ]),
    scenario("B 1-0 min50 O1.5 necesita 1 gol", 50, { home: 1, away: 0 }, { shots: [8, 4], sot: [3, 1], corners: [4, 2], dangerous: [36, 18], attacks: [58, 39] }, [
      { minute: 35, shots: [5, 3], sot: [2, 1], corners: [2, 2], dangerous: [21, 15], attacks: [40, 28] },
      { minute: 40, shots: [6, 3], sot: [2, 1], corners: [3, 2], dangerous: [26, 16], attacks: [46, 32] },
      { minute: 45, shots: [7, 4], sot: [3, 1], corners: [3, 2], dangerous: [31, 17], attacks: [52, 36] }
    ]),
    scenario("C 0-0 min80 acumulado alto recent15 debil", 80, { home: 0, away: 0 }, { shots: [15, 10], sot: [5, 3], corners: [7, 4], dangerous: [62, 40], attacks: [82, 66] }, [
      { minute: 65, shots: [14, 10], sot: [5, 3], corners: [7, 4], dangerous: [60, 39], attacks: [78, 64] },
      { minute: 70, shots: [14, 10], sot: [5, 3], corners: [7, 4], dangerous: [61, 39], attacks: [79, 64] },
      { minute: 75, shots: [15, 10], sot: [5, 3], corners: [7, 4], dangerous: [61, 40], attacks: [80, 65] }
    ]),
    scenario("D live incompleto N/D no cero", 52, { home: 0, away: 0 }, { shots: [null, null], offTarget: [5, 4], sot: [null, null], xg: [null, null], corners: [3, 3], attacks: [50, 46], dangerous: [20, 16] }, [
      { minute: 37, shots: [null, null], offTarget: [4, 3], sot: [null, null], xg: [null, null], corners: [2, 3], attacks: [45, 39], dangerous: [17, 14] },
      { minute: 42, shots: [null, null], offTarget: [4, 3], sot: [null, null], xg: [null, null], corners: [2, 3], attacks: [47, 41], dangerous: [18, 15] },
      { minute: 47, shots: [null, null], offTarget: [5, 3], sot: [null, null], xg: [null, null], corners: [3, 3], attacks: [49, 44], dangerous: [19, 16] }
    ]),
    scenario("E off target y attacks altos con poco SOT/xG", 52, { home: 0, away: 0 }, { shots: [null, null], offTarget: [7, 2], sot: [1, 0], xg: [null, null], corners: [3, 3], attacks: [56, 40], dangerous: [24, 12] }, [
      { minute: 37, shots: [null, null], offTarget: [5, 2], sot: [1, 0], xg: [null, null], corners: [1, 3], attacks: [45, 36], dangerous: [17, 12] },
      { minute: 42, shots: [null, null], offTarget: [6, 2], sot: [1, 0], xg: [null, null], corners: [2, 3], attacks: [49, 38], dangerous: [20, 12] },
      { minute: 47, shots: [null, null], offTarget: [6, 2], sot: [1, 0], xg: [null, null], corners: [2, 3], attacks: [53, 39], dangerous: [22, 12] }
    ]),
    scenario("F tendencia subiendo desde base minima presion baja", 52, { home: 0, away: 0 }, { shots: [null, null], offTarget: [2, 1], sot: [null, null], xg: [null, null], corners: [2, 1], attacks: [30, 28], dangerous: [10, 9] }, [
      { minute: 37, shots: [null, null], offTarget: [1, 1], sot: [null, null], xg: [null, null], corners: [1, 1], attacks: [27, 26], dangerous: [9, 8] },
      { minute: 42, shots: [null, null], offTarget: [1, 1], sot: [null, null], xg: [null, null], corners: [1, 1], attacks: [28, 27], dangerous: [9, 8] },
      { minute: 47, shots: [null, null], offTarget: [1, 1], sot: [null, null], xg: [null, null], corners: [1, 1], attacks: [29, 27], dangerous: [9, 9] }
    ]),
    scenario("G cuota atractiva incertidumbre alta", 55, { home: 0, away: 0 }, { shots: [null, null], offTarget: [4, 4], sot: [null, null], xg: [null, null], corners: [2, 2], attacks: [40, 38], dangerous: [16, 15], odds: [{ market: "Total goles", selection: "Over 1.5", price: 3.4 }] }, []),
    scenario("H 90+ guardrail", 92, { home: 2, away: 0 }, { shots: [18, 11], sot: [6, 3], corners: [7, 5], dangerous: [70, 50], attacks: [100, 82], stoppageTime: 4 }, [{ minute: 77, shots: [15, 9], sot: [5, 3], corners: [6, 4], dangerous: [62, 42], attacks: [90, 74] }]),
    scenario("I corners sin cuota real NO ENTRY", 52, { home: 0, away: 0 }, { shots: [7, 5], sot: [2, 1], corners: [4, 2], dangerous: [32, 24], attacks: [52, 44], noCornerOdds: true }, [{ minute: 37, shots: [4, 3], sot: [1, 1], corners: [2, 1], dangerous: [20, 15], attacks: [34, 29] }]),
    scenario("J mercado settled ganado/perdido", 50, { home: 2, away: 0 }, { shots: [10, 5], sot: [5, 1], corners: [4, 2], dangerous: [42, 20], attacks: [62, 42] }, [{ minute: 35, shots: [6, 3], sot: [3, 1], corners: [2, 1], dangerous: [25, 15], attacks: [42, 28] }]),
    scenario("K monotonicidad goles restantes", 52, { home: 0, away: 0 }, { shots: [9, 6], sot: [3, 2], corners: [5, 3], dangerous: [40, 30], attacks: [60, 50] }, [
      { minute: 37, shots: [5, 4], sot: [2, 1], corners: [3, 2], dangerous: [24, 18], attacks: [42, 34] },
      { minute: 42, shots: [6, 5], sot: [2, 1], corners: [4, 2], dangerous: [30, 23], attacks: [48, 40] },
      { minute: 47, shots: [8, 5], sot: [3, 1], corners: [5, 3], dangerous: [35, 27], attacks: [55, 45] }
    ]),
    scenario("REG Club Brugge 1-1 Aston Villa min22 O2.5 requiere 1 gol", 22, { home: 1, away: 1 }, { homeTeam: "Club Brugge", awayTeam: "Aston Villa", shots: [6, 4], sot: [3, 2], corners: [3, 2], dangerous: [28, 22], attacks: [42, 35], odds: [{ market: "Total goles", selection: "Over 2.5", price: 1.33 }], strongHistory: true }, [
      { minute: 7, shots: [2, 1], sot: [1, 0], corners: [1, 0], dangerous: [8, 5], attacks: [15, 10] },
      { minute: 12, shots: [3, 2], sot: [1, 1], corners: [1, 1], dangerous: [13, 9], attacks: [22, 18] },
      { minute: 17, shots: [4, 3], sot: [2, 1], corners: [2, 1], dangerous: [20, 15], attacks: [31, 26] }
    ])
  ];

  return NextResponse.json({
    cases: cases.map(({ name, context }) => {
      const analysis = analyzeMatchContext(context);
      const over25 = (analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Over/Under goles" && market.selection === "Over 2.5 goles");
      const over15 = (analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Over/Under goles" && market.selection === "Over 1.5 goles");
      const over05 = (analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Over/Under goles" && market.selection === "Over 0.5 goles");
      const over35 = (analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Over/Under goles" && market.selection === "Over 3.5 goles");
      const btts = (analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Ambos marcan" && /si|sí|yes/i.test(market.selection));
      return {
        name,
        momentum: context.liveMomentum
          ? {
              available: context.liveMomentum.available,
              cumulativeAttackScore: context.liveMomentum.cumulativeAttackScore,
              recentMomentumScore: context.liveMomentum.recentMomentumScore,
              matchTrendScore: context.liveMomentum.matchTrendScore,
              matchTrendState: context.liveMomentum.matchTrendState,
              strongerPressure: context.liveMomentum.strongerPressure,
              pressureStrength: context.liveMomentum.pressureStrength,
              tacticalState: context.liveMomentum.tacticalState,
              goalPressureSignal: context.liveMomentum.goalPressureSignal,
              recent15: {
                shots: context.liveMomentum.recent.fifteen.shots,
                shotsOffTarget: context.liveMomentum.recent.fifteen.shotsOffTarget,
                shotsOnTarget: context.liveMomentum.recent.fifteen.shotsOnTarget,
                corners: context.liveMomentum.recent.fifteen.corners,
                attacks: context.liveMomentum.recent.fifteen.attacks,
                dangerousAttacks: context.liveMomentum.recent.fifteen.dangerousAttacks,
                coveragePercentage: context.liveMomentum.recent.fifteen.coveragePercentage,
                isComplete: context.liveMomentum.recent.fifteen.isComplete,
                dataState: context.liveMomentum.recent.fifteen.dataState,
                startSnapshotMinute: context.liveMomentum.recent.fifteen.startSnapshotMinute,
                endSnapshotMinute: context.liveMomentum.recent.fifteen.endSnapshotMinute
              },
              substitutionImpacts: context.liveMomentum.substitutions.map((item) => ({ minute: item.minute, intent: item.substitutionIntent, observedImpact: item.observedImpact, note: item.note })),
              criticalSplits: context.liveMomentum.criticalSplits.map((item) => ({ minute: item.minute, type: item.type, trend: item.trend }))
            }
          : null,
        currentRecommendation: analysis.currentRecommendation,
        enterNowCount: (analysis.allMarkets ?? analysis.markets).filter((market) => market.entryState === "ENTER_NOW").length,
        visibleMarkets: analysis.markets.map((market) => ({ market: market.market, selection: market.selection, marketStatus: market.marketStatus, entryState: market.entryState })),
        over05: summarizeMarket(over05),
        over15: summarizeMarket(over15),
        bttsYes: summarizeMarket(btts),
        corners: summarizeMarket((analysis.allMarkets ?? analysis.markets).find((market) => market.market === "Corners")),
        over35: summarizeMarket(over35),
        over25: over25
          ? summarizeMarket(over25)
          : null
      };
    })
  });
}

type StatPair = [number | null, number | null];

type DebugOdd = {
  market: string;
  selection: string;
  price: number;
};

function scenario(
  name: string,
  minute: number,
  score: { home: number; away: number },
  totals: { shots: StatPair; offTarget?: StatPair; sot: StatPair; xg?: StatPair; corners: StatPair; attacks?: StatPair; dangerous: StatPair; redAway?: number; stoppageTime?: number; status?: MatchDetail["status"]; homeTeam?: string; awayTeam?: string; noOdds?: boolean; noCornerOdds?: boolean; playerOut?: boolean; odds?: DebugOdd[]; strongHistory?: boolean },
  previous: Array<{ minute: number; shots: StatPair; offTarget?: StatPair; sot: StatPair; xg?: StatPair; corners: StatPair; attacks?: StatPair; dangerous: StatPair }>,
  events: MatchDetail["events"] = []
) {
  const odds = totals.odds ?? [
    { market: "Total goles", selection: "Over 0.5", price: 1.3 },
    { market: "Total goles", selection: "Over 2.5", price: 2.05 },
    { market: "Total goles", selection: "Over 1.5", price: 1.55 },
    { market: "Total goles", selection: "Over 3.5", price: 2.7 },
    { market: "Both Teams To Score", selection: "Yes", price: 2.2 },
    ...(totals.noCornerOdds ? [] : [{ market: "Corners", selection: "Over 8", price: 1.8 }])
  ];
  const match: MatchDetail & { stoppageTime?: number } = {
    id: `debug-${name}`,
    source: "demo",
    homeTeam: totals.homeTeam ?? "Home",
    awayTeam: totals.awayTeam ?? "Away",
    competition: "DEBUG",
    kickoffAt: new Date().toISOString(),
    status: totals.status ?? "LIVE",
    minute,
    stoppageTime: totals.stoppageTime,
    score,
    demo: true,
    stats: {
      home: { possession: 58, shots: totals.shots[0], shotsOffTarget: totals.offTarget?.[0] ?? null, shotsOnTarget: totals.sot[0], xg: totals.xg?.[0] ?? null, corners: totals.corners[0], yellowCards: 1, redCards: 0, fouls: null, attacks: totals.attacks?.[0] ?? null, dangerousAttacks: totals.dangerous[0] },
      away: { possession: 42, shots: totals.shots[1], shotsOffTarget: totals.offTarget?.[1] ?? null, shotsOnTarget: totals.sot[1], xg: totals.xg?.[1] ?? null, corners: totals.corners[1], yellowCards: 2, redCards: totals.redAway ?? 0, fouls: null, attacks: totals.attacks?.[1] ?? null, dangerousAttacks: totals.dangerous[1] }
    },
    lineups: { home: [], away: [] },
    substitutions: events.filter((event) => event.type === "substitution"),
    events,
    playerStats: totals.playerOut ? [{ player: "Player A", team: "home", position: "Forward", minutes: 65, goals: 0, assists: 0, shots: 3, shotsOnTarget: 1, xg: null, keyPasses: 0, foulsCommitted: 0 }] : [],
    odds: odds.map((quote) => ({ bookmaker: "DEBUG", market: quote.market, selection: quote.selection, price: quote.price, quotedAt: new Date().toISOString(), minute })).filter(() => !totals.noOdds),
    oddsHistory: [],
    analysis: [],
    alerts: []
  };
  const snapshots: StoredLiveSnapshot[] = previous.map((item) => snapshot(match, item.minute, item.shots, item.offTarget, item.sot, item.corners, item.attacks, item.dangerous, score, item.xg));
  snapshots.push(snapshot(match, minute, totals.shots, totals.offTarget, totals.sot, totals.corners, totals.attacks, totals.dangerous, score, totals.xg));
  const liveMomentum = buildLiveMomentumAnalysis(match, snapshots);
  const recentHome = totals.strongHistory ? debugHistory(match, match.homeTeam) : [];
  const recentAway = totals.strongHistory ? debugHistory(match, match.awayTeam) : [];
  const h2h = totals.strongHistory ? debugHistory(match, match.homeTeam).slice(0, 5) : [];
  const context: MatchAnalysisContext = { match, recentHome, recentAway, h2h, liveMomentum, provider: "DEBUG", generatedAt: new Date().toISOString() };
  return { name, context };
}

function debugHistory(base: MatchDetail, team: string): MatchDetail[] {
  return Array.from({ length: 10 }, (_, index) => ({
    ...base,
    id: `${base.id}-history-${team}-${index}`,
    status: "FINISHED",
    minute: null,
    score: index % 3 === 0 ? { home: 3, away: 2 } : index % 3 === 1 ? { home: 2, away: 1 } : { home: 2, away: 2 },
    stats: {
      home: { ...base.stats.home, shots: 14, shotsOnTarget: 6, corners: 6, dangerousAttacks: 52 },
      away: { ...base.stats.away, shots: 11, shotsOnTarget: 4, corners: 4, dangerousAttacks: 39 }
    },
    events: [],
    substitutions: [],
    odds: [],
    oddsHistory: []
  }));
}

function summarizeMarket(market: AnalyzedMarket | undefined) {
  if (!market) return null;
  return {
    marketStatus: market.marketStatus,
    marketPeriod: market.marketPeriod ?? "FULL_MATCH",
    remainingMarketMinutes: market.remainingMarketMinutes ?? null,
    confidence: market.confidence,
    estimatedProbability: market.estimatedProbability,
    impliedProbability: market.impliedProbability,
    rawEdge: market.rawEdge ?? market.edge,
    uncertaintyAdjustedEdge: market.uncertaintyAdjustedEdge,
    uncertainty: market.uncertainty,
    probabilityModel: market.probabilityModel,
    probabilityNote: market.probabilityNote,
    rawRate: market.rawRate,
    adjustedRate: market.adjustedRate,
    liveProbability: market.liveProbability,
    prematchWeight: market.prematchWeight,
    liveWeight: market.liveWeight,
    concordanceScore: market.concordanceScore,
    evidenceCoverage: market.evidenceCoverage,
    liveAttackScore: market.liveAttackScore,
    cumulativeAttackScore: market.cumulativeAttackScore,
    recentMomentumScore: market.recentMomentumScore,
    matchTrendScore: market.matchTrendScore,
    pressureStrength: market.pressureStrength,
    goalPressureSignal: market.goalPressureSignal,
    lambdaRemaining: market.lambdaRemaining,
    remainingGoalProbabilities: market.remainingGoalProbabilities,
    marketDataQuality: market.marketDataQuality,
    betScore: market.betScore,
    decision: market.decision,
    entryState: market.entryState,
    discardReason: market.discardReason,
    finalTimeDebug: market.finalTimeDebug,
    betScoreTrace: market.betScoreTrace ?? [],
    decisionBlockers: market.decisionBlockers ?? []
  };
}

function snapshot(match: MatchDetail, minute: number, shots: StatPair, offTarget: StatPair | undefined, sot: StatPair, corners: StatPair, attacks: StatPair | undefined, dangerous: StatPair, score: { home: number; away: number }, xg?: StatPair): StoredLiveSnapshot {
  return {
    timestamp: new Date(Date.now() + minute * 60_000),
    minute,
    homeScore: score.home,
    awayScore: score.away,
    homeShots: shots[0],
    awayShots: shots[1],
    homeShotsOffTarget: offTarget?.[0] ?? null,
    awayShotsOffTarget: offTarget?.[1] ?? null,
    homeShotsOnTarget: sot[0],
    awayShotsOnTarget: sot[1],
    homeXg: xg?.[0] ?? match.stats.home.xg,
    awayXg: xg?.[1] ?? match.stats.away.xg,
    homeCorners: corners[0],
    awayCorners: corners[1],
    homeYellowCards: match.stats.home.yellowCards,
    awayYellowCards: match.stats.away.yellowCards,
    homeRedCards: match.stats.home.redCards,
    awayRedCards: match.stats.away.redCards,
    homePossession: match.stats.home.possession,
    awayPossession: match.stats.away.possession,
    homeAttacks: attacks?.[0] ?? null,
    awayAttacks: attacks?.[1] ?? null,
    homeDangerousAttacks: dangerous[0],
    awayDangerousAttacks: dangerous[1]
  };
}
