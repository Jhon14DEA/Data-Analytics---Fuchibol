import { NextResponse } from "next/server";
import { detectAlerts } from "@/lib/alertEngine";
import { evaluateConfiguredAlerts } from "@/lib/matchAlertRegistry";
import { getPerformanceMetricRecords, measureProcess } from "@/lib/performance";
import { footballProvider, getMatchAnalysisContext, providerStatus } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const url = new URL(request.url);
    const debugPerf = url.searchParams.has("debugPerf");
    const beforeMetrics = getPerformanceMetricRecords().length;
    const startedAt = performance.now();
    const snapshot = await measureProcess("match-snapshot", async () => {
      if (url.searchParams.has("refresh") && "invalidateMatchCache" in footballProvider) {
        (footballProvider as { invalidateMatchCache?: (matchId: string) => unknown }).invalidateMatchCache?.(id);
      }
      const context = await getMatchAnalysisContext(id).catch(() => null);
      const match = context?.match ?? await footballProvider.getMatch(id);
      if (!match) return null;
      const previous = await measureProcess("db.previous-live-stats", () => footballProvider.getPreviousSnapshot(id), "PostgreSQL");

      const analysisContext = context ? await measureProcess("analysis.match-analyzer", () => analyzeMatchContext(context), "local") : null;
      const snapshotAlerts = await measureProcess("alerts.diff-engine", () => detectAlerts(match, previous), "local");
      const engineAlerts = await measureProcess("alerts.configured", () => evaluateConfiguredAlerts(match, analysisContext?.currentRecommendation ?? { options: [] }), "local");
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
          events: match.events,
          liveMomentum: analysisContext?.liveMomentum ?? null
        },
        odds: match.odds.slice(0, 30),
        analysis: analysisContext?.currentRecommendation ?? { options: [] },
        dataUpdatedAt: analysisContext?.dataUpdatedAt ?? new Date().toISOString(),
        statusIndicator: analysisContext?.statusIndicator ?? (match.status === "LIVE" ? "LIVE" : match.status === "UPCOMING" ? "UPCOMING" : "FINAL"),
        dataFreshness: context?.dataFreshness ?? null,
        analysisState: analysisContext?.liveState ?? "N/D",
        alerts: [...snapshotAlerts, ...engineAlerts],
        providerStatus,
        liveRefreshSeconds: Number(process.env.LIVE_REFRESH_SECONDS) || 120
      };
    });

    if (!snapshot) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const payload = debugPerf
      ? {
          ...snapshot,
          performance: {
            totalMs: Math.round(performance.now() - startedAt),
            metrics: getPerformanceMetricRecords().slice(beforeMetrics).map((metric) => ({
              process: metric.process,
              durationMs: Math.round(metric.durationMs),
              cache: metric.cache,
              provider: metric.provider ?? null,
              timestamp: metric.recordedAt
            }))
          }
        }
      : snapshot;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[match snapshot]", error);
    return NextResponse.json({ error: "No se pudo cargar el snapshot" }, { status: 502 });
  }
}
