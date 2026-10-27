import { NextResponse } from "next/server";
import { evaluateConfiguredAlerts, getAlertConfiguration, getRegisteredAlertCount } from "@/lib/matchAlertRegistry";
import { footballProvider, getMatchAnalysisContext } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const match = await footballProvider.getMatch(id);
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const context = await getMatchAnalysisContext(id).catch(() => null);
  const recommendation = context ? analyzeMatchContext(context).currentRecommendation : { options: [] };
  const alerts = evaluateConfiguredAlerts(match, recommendation);

  return NextResponse.json(
    {
      matchId: id,
      registered: getAlertConfiguration(id).enabled,
      evaluatedAt: new Date().toISOString(),
      alerts,
      knownFingerprints: getRegisteredAlertCount(id)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
