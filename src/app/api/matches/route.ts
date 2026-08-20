import { NextResponse } from "next/server";
import { AllSportsApiError } from "@/providers/football/allSportsApi";
import { ApiFootballError } from "@/providers/football/apiFootball";
import { allSportsApiProvider, apiFootballProvider, demoFootballProvider, footballProvider, providerStatus } from "@/providers";
import { measureProcess } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!allSportsApiProvider.isConfigured() && !apiFootballProvider.isConfigured()) {
    const matches = await demoFootballProvider.listMatches();
    return NextResponse.json({
      apiState: "DEMO",
      demo: true,
      providerStatus: "DEMO",
      message: "AllSportsApi y API-Football no configuradas. Se muestran datos DEMO.",
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 60,
      matches
    });
  }

  try {
    const matches = await measureProcess("fixtures+livescore", () => footballProvider.listMatches(), providerStatus);

    return NextResponse.json({
      apiState: "REAL",
      demo: false,
      providerStatus,
      message: allSportsApiProvider.isConfigured()
        ? "🟢 API REAL conectada: AllSportsApi."
        : "🟢 API REAL conectada: API-Football.",
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 60,
      matches
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const statusCode = error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.statusCode : null;

    console.error("[Football provider fixtures]", {
      httpStatus: statusCode,
      message,
      remainingRequests: error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.remainingRequests : null,
      usedRequests: error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.usedRequests : null
    });

    return NextResponse.json({
      apiState: "ERROR",
      demo: false,
      providerStatus,
      message: `ERROR FOOTBALL API: ${message}`,
      statusCode,
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 60,
      matches: []
    });
  }
}
