import { DashboardClient } from "@/components/DashboardClient";
import { AllSportsApiError } from "@/providers/football/allSportsApi";
import { ApiFootballError } from "@/providers/football/apiFootball";
import { allSportsApiProvider, apiFootballProvider, demoFootballProvider, footballProvider, providerStatus } from "@/providers";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!allSportsApiProvider.isConfigured() && !apiFootballProvider.isConfigured()) {
    const matches = await demoFootballProvider.listMatches();
    const data = {
      apiState: "DEMO" as const,
      demo: true,
      providerStatus: "DEMO",
      message: "AllSportsApi y API-Football no configuradas. Se muestran datos DEMO hasta agregar una clave.",
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 120,
      matches
    };

    return <DashboardClient initialData={data} />;
  }

  try {
    const matches = await footballProvider.listMatches();
    const data = {
      apiState: "REAL" as const,
      demo: false,
      providerStatus,
      message: allSportsApiProvider.isConfigured()
        ? "🟢 API REAL conectada: AllSportsApi. Mostrando fixtures reales del dia actual."
        : "🟢 API REAL conectada: API-Football. Mostrando fixtures reales del dia actual.",
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 120,
      matches
    };

    return <DashboardClient initialData={data} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[Football provider dashboard]", {
      httpStatus: error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.statusCode : null,
      message,
      remainingRequests: error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.remainingRequests : null,
      usedRequests: error instanceof ApiFootballError || error instanceof AllSportsApiError ? error.usedRequests : null
    });

    const data = {
      apiState: "ERROR" as const,
      demo: false,
      providerStatus,
      message: `ERROR FOOTBALL API: ${message}`,
      lastUpdatedAt: new Date().toISOString(),
      liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 120,
      matches: []
    };

    return <DashboardClient initialData={data} />;
  }
}
