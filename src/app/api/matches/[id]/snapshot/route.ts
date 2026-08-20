import { NextResponse } from "next/server";
import { detectAlerts } from "@/lib/alertEngine";
import { measureProcess } from "@/lib/performance";
import { footballProvider, getMatchAnalysisContext, providerStatus } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const snapshot = await measureProcess("match-snapshot", async () => {
      const [match, previous, context] = await Promise.all([
        footballProvider.getMatch(id),
        footballProvider.getPreviousSnapshot(id),
        getMatchAnalysisContext(id).catch(() => null)
      ]);
      if (!match) return null;

      const analysisContext = context ? analyzeMatchContext(context) : null;
      return {
        match: {
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          competition: match.competition,
          status: match.status,
          minute: match.minute,
          score: match.score,
          stats: match.stats,
          events: match.events
        },
        odds: match.odds.slice(0, 30),
        analysis: analysisContext?.currentRecommendation ?? { options: [] },
        analysisState: analysisContext?.liveState ?? "N/D",
        alerts: detectAlerts(match, previous),
        providerStatus
      };
    });

    if (!snapshot) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("[match snapshot]", error);
    return NextResponse.json({ error: "No se pudo cargar el snapshot" }, { status: 502 });
  }
}