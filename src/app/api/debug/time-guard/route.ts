import { NextResponse } from "next/server";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";
import type { MatchAnalysisContext, MatchDetail } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const match = {
    id: "debug-time-guard",
    source: "demo",
    homeTeam: "Home",
    awayTeam: "Away",
    competition: "DEBUG",
    kickoffAt: new Date().toISOString(),
    status: "LIVE",
    minute: 92,
    stoppageTime: 4,
    score: { home: 2, away: 0 },
    demo: true,
    stats: {
      home: { possession: 62, shots: 20, shotsOnTarget: 6, xg: null, corners: 9, yellowCards: 1, redCards: null, fouls: 8, dangerousAttacks: 70 },
      away: { possession: 38, shots: 9, shotsOnTarget: 2, xg: null, corners: 3, yellowCards: 2, redCards: null, fouls: 11, dangerousAttacks: 28 }
    },
    lineups: { home: [], away: [] },
    events: [],
    substitutions: [],
    playerStats: [],
    odds: [
      {
        bookmaker: "DEBUG",
        market: "Total goles",
        selection: "Over 2.5",
        price: 2.1,
        quotedAt: new Date().toISOString(),
        minute: 92
      }
    ],
    oddsHistory: [],
    analysis: [],
    alerts: []
  } satisfies MatchDetail & { stoppageTime: number };

  const context: MatchAnalysisContext = {
    match,
    recentHome: [],
    recentAway: [],
    h2h: [],
    liveSnapshotTrend: {
      available: true,
      five: { minutes: 5, requestedMinutes: 5, observedMinutes: 5, coveragePercentage: 100, isComplete: true, shots: null, shotsOnTarget: 0, xg: null, corners: 0, dangerousAttacks: 4, goals: 0, cards: 0 },
      ten: { minutes: 10, requestedMinutes: 10, observedMinutes: 10, coveragePercentage: 100, isComplete: true, shots: null, shotsOnTarget: 1, xg: null, corners: 1, dangerousAttacks: 8, goals: 0, cards: 0 },
      fifteen: { minutes: 15, requestedMinutes: 15, observedMinutes: 15, coveragePercentage: 100, isComplete: true, shots: null, shotsOnTarget: 1, xg: null, corners: 1, dangerousAttacks: 12, goals: 0, cards: 0 }
    },
    provider: "DEBUG",
    generatedAt: new Date().toISOString()
  };
  const analysis = analyzeMatchContext(context);
  const market = (analysis.allMarkets ?? analysis.markets).find((item) => item.market === "Over/Under goles" && item.selection === "Over 2.5 goles");

  return NextResponse.json({
    route: "/api/debug/time-guard",
    assertion: market?.finalTimeDebug
      ? market.finalTimeDebug.confidenceRendered === market.finalTimeDebug.confidenceAfterCap
      : false,
    market: market
      ? {
          market: market.market,
          selection: market.selection,
          confidence: market.confidence,
          estimatedProbability: market.estimatedProbability,
          betScore: market.betScore,
          decision: market.decision,
          finalTimeDebug: market.finalTimeDebug
        }
      : null
  });
}
