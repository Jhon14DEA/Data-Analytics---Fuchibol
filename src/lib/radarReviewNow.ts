import type { LiveGoalRadarCandidate } from "@/services/analysis/liveGoalRadar";

type ReviewCandidate = Pick<LiveGoalRadarCandidate,
  "fixtureId" | "market" | "minute" | "score" | "accumulated" | "components">;

export function reviewActivityLabel(combinedSot: number) {
  return combinedSot >= 8 ? "ALTA ACTIVIDAD" : combinedSot >= 6 ? "PRIORIDAD" : "REVISAR";
}

// Presentation only: consume the existing combined statistic; never recalculate or mutate candidates.
export function selectReviewNow<C extends ReviewCandidate>(matches: readonly {
  fixtureId: string; status?: string; candidates: readonly C[];
}[]) {
  const fixtures = new Map<string, { fixtureId: string; combinedSot: number; candidate: C; markets: C[] }>();
  for (const match of matches) {
    if (match.status !== "LIVE") continue;
    for (const candidate of match.candidates) {
      const combinedSot = candidate.accumulated.shotsOnTarget;
      if (candidate.fixtureId !== match.fixtureId || candidate.score.home !== 0 || candidate.score.away !== 0
        || typeof combinedSot !== "number" || !Number.isFinite(combinedSot) || combinedSot < 4) continue;
      const existing = fixtures.get(candidate.fixtureId);
      if (existing) {
        if (!existing.markets.some(item => item.market === candidate.market)) existing.markets.push(candidate);
      } else {
        fixtures.set(candidate.fixtureId, { fixtureId: candidate.fixtureId, combinedSot, candidate, markets: [candidate] });
      }
    }
  }
  return [...fixtures.values()].sort((a, b) => b.combinedSot - a.combinedSot
    || b.candidate.components.recentLiveScore - a.candidate.components.recentLiveScore
    || (b.candidate.minute ?? -Infinity) - (a.candidate.minute ?? -Infinity));
}
