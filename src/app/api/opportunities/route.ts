import { NextResponse } from "next/server";
import { footballProvider, getMatchAnalysisContext } from "@/providers";
import { buildOpportunityRadar } from "@/services/analysis/matchAnalyzer";
import type { MatchAnalysisContext } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const matches = await footballProvider.listMatches();
  const contexts = (
    await Promise.all(
      matches
        .filter((match) => match.status !== "FINISHED")
        .slice(0, 12)
        .map((match) => getMatchAnalysisContext(match.id).catch(() => null))
    )
  ).filter((context): context is MatchAnalysisContext => context !== null);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    opportunities: buildOpportunityRadar(contexts).map((opportunity) => ({
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
      markets: opportunity.markets
    }))
  });
}
