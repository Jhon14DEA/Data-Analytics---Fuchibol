import { NextResponse } from "next/server";
import { buildOpportunityRadarDebug } from "@/lib/opportunityRadar";

export const dynamic = "force-dynamic";

export async function GET() {
  const radar = await buildOpportunityRadarDebug();

  return NextResponse.json({
    generatedAt: radar.generatedAt,
    debug: {
      provider: radar.provider,
      matchesFoundToday: radar.matchesFoundToday,
      candidates: radar.candidates,
      cheapCandidates: radar.cheapCandidates,
      deepShortlist: radar.deepShortlist,
      matchesAnalyzed: radar.matchesAnalyzed,
      matchesDiscarded: radar.matchesDiscarded,
      requestsConsumed: radar.requestsConsumed,
      marketsEvaluated: radar.marketsEvaluated,
      recommendationsBeforeFilter: radar.recommendationsBeforeFilter,
      opportunitiesCount: radar.opportunities.length,
      rows: radar.debugRows
    },
    message: radar.opportunities.length
      ? undefined
      : `Hoy no hay oportunidades >= 8/10 con respaldo suficiente. Se analizaron ${radar.matchesAnalyzed} partidos y ${radar.marketsEvaluated} mercados; ninguno superó el umbral.`,
    opportunities: radar.opportunities.map((opportunity) => ({
      match: {
        id: opportunity.match.id,
        homeTeam: opportunity.match.homeTeam,
        awayTeam: opportunity.match.awayTeam,
        competition: opportunity.match.competition,
        status: opportunity.match.status,
        minute: opportunity.match.minute,
        score: opportunity.match.score
      },
      opportunityScore: opportunity.opportunityScore,
      liveState: opportunity.liveState,
      dataUpdatedAt: opportunity.dataUpdatedAt,
      statusIndicator: opportunity.statusIndicator,
      analysisCacheKey: opportunity.analysisCacheKey,
      markets: opportunity.markets
    }))
  }, { headers: { "Cache-Control": "no-store" } });
}
