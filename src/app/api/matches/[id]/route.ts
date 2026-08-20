import { NextResponse } from "next/server";
import { analyzeMatch } from "@/lib/analysisEngine";
import { detectAlerts } from "@/lib/alertEngine";
import { ApiFootballError } from "@/providers/football/apiFootball";
import { footballProvider, oddsProvider, providerStatus } from "@/providers";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const match = await footballProvider.getMatch(id);

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const previous = await footballProvider.getPreviousSnapshot(id);
    const odds = await oddsProvider.getCurrentOdds(id);
    const oddsHistory = await oddsProvider.getOddsHistory(id);

    return NextResponse.json({
      ...match,
      providerStatus,
      odds,
      oddsHistory,
      analysis: analyzeMatch(match),
      alerts: detectAlerts(match, previous)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[API-Football match detail]", {
      httpStatus: error instanceof ApiFootballError ? error.statusCode : null,
      message,
      remainingRequests: error instanceof ApiFootballError ? error.remainingRequests : null,
      usedRequests: error instanceof ApiFootballError ? error.usedRequests : null
    });

    return NextResponse.json(
      {
        error: `ERROR API-FOOTBALL: ${message}`,
        statusCode: error instanceof ApiFootballError ? error.statusCode : null
      },
      { status: 502 }
    );
  }
}
