import type { LiveGoalRadarCandidate } from "@/services/analysis/liveGoalRadar";

export type HybridReviewState = "REVIEW_ONLY" | "HYBRID_ELIGIBLE" | "HYBRID_NOT_NEEDED" | "OUTSIDE_TIME_WINDOW" | "INSUFFICIENT_SOT";
export type HybridReviewCandidate = Pick<LiveGoalRadarCandidate,
  "fixtureId" | "match" | "competition" | "market" | "minute" | "score" | "accumulated" | "components">
  & Partial<Pick<LiveGoalRadarCandidate, "recentDataStatus">>;
export type HybridRadarMatch<C extends HybridReviewCandidate = HybridReviewCandidate> = {
  fixtureId: string; status?: string; competition?: string; candidates: C[];
};

export const hybridReviewLabels: Record<HybridReviewState, string> = {
  REVIEW_ONLY: "SOLO REVISAR", HYBRID_ELIGIBLE: "HÍBRIDO ELEGIBLE", HYBRID_NOT_NEEDED: "HÍBRIDO NO NECESARIO",
  OUTSIDE_TIME_WINDOW: "FUERA DE VENTANA", INSUFFICIENT_SOT: "SOT INSUFICIENTE"
};
const observedNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

// Visual classification only. recentDataStatus already incorporates the radar's coverage gates.
// RECENT_DEAD is observed inactivity, not missing data; an observed zero remains a valid datum.
export function classifyHybridEligibility(candidate: HybridReviewCandidate, live = true): {
  state: HybridReviewState; missingCritical: string[];
} {
  const result = (state: HybridReviewState, missingCritical: string[] = []) => ({ state, missingCritical });
  if (!live || candidate.score.home !== 0 || candidate.score.away !== 0) return result("REVIEW_ONLY");
  const sot = candidate.accumulated.shotsOnTarget;
  if (!observedNumber(sot) || sot < 4) return result("INSUFFICIENT_SOT");
  const range = candidate.market === "OVER05_1H" ? [20, 40] : candidate.market === "OVER05_FT" ? [45, 75] : null;
  if (!range) return result("REVIEW_ONLY");
  if (!observedNumber(candidate.minute) || candidate.minute < range[0] || candidate.minute > range[1]) return result("OUTSIDE_TIME_WINDOW");
  const missingCritical = [
    ...(!observedNumber(candidate.accumulated.xg) ? ["xG"] : []),
    ...(!observedNumber(candidate.accumulated.bigChances) ? ["bigChances"] : []),
    ...(!observedNumber(candidate.accumulated.shotsInsideBox) ? ["shotsInsideBox"] : []),
    ...(!observedNumber(candidate.components.recentLiveScore)
      || !["VALID_RECENT_DATA", "RECENT_DEAD"].includes(candidate.recentDataStatus ?? "") ? ["recentLive"] : [])
  ];
  return result(missingCritical.length ? "HYBRID_ELIGIBLE" : "HYBRID_NOT_NEEDED", missingCritical);
}

export function radarCompetition(match: { competition?: string; candidates: readonly { competition?: string }[] }) {
  return match.competition?.trim() || match.candidates.find(c => c.competition?.trim())?.competition?.trim() || "N/D";
}

export function listRadarCompetitions(matches: readonly HybridRadarMatch[]) {
  return [...new Set(matches.filter(m => m.status === "LIVE").map(radarCompetition))].sort((a, b) => a.localeCompare(b, "es"));
}

// Both radar sections consume this same UI-only projection. Source payload and decisions stay untouched.
export function filterRadarMatches<C extends HybridReviewCandidate>(matches: readonly HybridRadarMatch<C>[], competition = "", eligibleOnly = false) {
  return matches.filter(match => !competition || radarCompetition(match) === competition).flatMap(match => {
    if (!eligibleOnly) return [match];
    const candidates = match.candidates.filter(candidate => candidate.fixtureId === match.fixtureId
      && classifyHybridEligibility(candidate, match.status === "LIVE").state === "HYBRID_ELIGIBLE");
    return candidates.length ? [{ ...match, candidates }] : [];
  });
}
