import { detectHighGoalPressure } from "@/services/analysis/highGoalPressure";
import { after, NextResponse } from "next/server";
import { scheduleHybridBatch } from "@/services/training/hybrid/trigger";
import { footballProvider, getMatchAnalysisContext, providerStatus } from "@/providers";
import { getPerformanceMetricRecords, measureProcess } from "@/lib/performance";
import { evaluateLiveGoalRadar } from "@/services/analysis/liveGoalRadar";
import { getLiveSnapshotCoverageDebug } from "@/services/persistence/footballPersistence";
import { getLiveHistoricalContext } from "@/services/historical/liveContext";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixtureId = url.searchParams.get("fixtureId") ?? url.searchParams.get("matchId");
  const refresh = url.searchParams.has("refresh");
  const beforeMetrics = getPerformanceMetricRecords().length;

  const liveMatches = fixtureId
    ? [{ id: fixtureId, status: "LIVE" as const }]
    : (await measureProcess("live-goal-radar.list-matches", () => footballProvider.listMatches(), providerStatus))
        .filter((match) => match.status === "LIVE");

  const results = await Promise.allSettled(
    liveMatches.map(async (summary) => {
      if (refresh && "invalidateMatchCache" in footballProvider) {
        footballProvider.invalidateMatchCache(summary.id);
      }
      const context = await measureProcess(
        "live-goal-radar.context",
        () => getMatchAnalysisContext(summary.id),
        providerStatus
      );
      if (!context) {
        return {
          fixtureId: summary.id,
          error: "No se pudo construir contexto de análisis.",
          candidates: []
        };
      }
      const candidates = await measureProcess(
        "live-goal-radar.evaluate",
        () => evaluateLiveGoalRadar(context),
        "local"
      );
      const snapshotDebug = await measureProcess(
        "live-goal-radar.snapshot-debug",
        () => getLiveSnapshotCoverageDebug(context.match.id),
        "PostgreSQL"
      );
      const result = {
        fixtureId: context.match.id,
        match: `${context.match.homeTeam} vs ${context.match.awayTeam}`,
        competition: context.match.competition,
        status: context.match.status,
        minute: context.match.minute,
        score: context.match.score,
        provider: context.provider,
        generatedAt: context.generatedAt,
        snapshotDebug,
        historicalContext: await getLiveHistoricalContext(context.match),
        candidates
      };
      return { ...result, goalPressure: detectHighGoalPressure(context, result.historicalContext) };
    })
  );

  const matches = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      fixtureId: liveMatches[index]?.id ?? "N/D",
      error: result.reason instanceof Error ? result.reason.message : "Error desconocido",
      candidates: []
    };
  });
  const candidates = matches.flatMap((match) => match.candidates);
  const metrics = getPerformanceMetricRecords().slice(beforeMetrics);
  scheduleHybridBatch(after);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      providerStatus,
      scannedLiveMatches: liveMatches.length,
      candidatesCount: candidates.length,
      summary: {
        noAlert: candidates.filter((candidate) => candidate.decision === "NO_ALERT").length,
        watch: candidates.filter((candidate) => candidate.decision === "WATCH").length,
        strongAlert: candidates.filter((candidate) => candidate.decision === "STRONG_ALERT").length,
        priorityAlert: candidates.filter((candidate) => candidate.decision === "PRIORITY_ALERT").length
      },
      matches,
      performance: {
        requestsConsumed: metrics.filter((metric) => metric.provider && metric.cache === "miss").length,
        metrics: metrics.map((metric) => ({
          process: metric.process,
          durationMs: Math.round(metric.durationMs),
          cache: metric.cache,
          provider: metric.provider ?? null,
          error: metric.error ?? null
        }))
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
