import type { PeriodEvidence } from "./periodEvidence";
type DatasetEvent = "DATASET_CAPTURED" | "DATASET_SKIPPED" | "DATASET_HT_RESOLVED" | "DATASET_FT_RESOLVED";
const startedAt = new Date().toISOString();
const states = new Map<string, string>();
const counters: Record<string, number> = {};
let captured = 0;
let qualityRejected = 0;

// Bounded process-local diagnostics: no timers, persistence or provider calls.
export function datasetEvent(event: DatasetEvent, fixtureId: string, reason?: string, count = 1, qualityFailure = false, periodEvidence?: PeriodEvidence) {
  if (event === "DATASET_SKIPPED") {
    const state = `${reason}:${periodEvidence?.confidence ?? ""}:${periodEvidence?.reason ?? ""}`;
    if (states.get(fixtureId) === state) return;
    if (states.size >= 5000 && !states.has(fixtureId)) states.delete(states.keys().next().value!);
    states.set(fixtureId, state);
    counters[reason!] = (counters[reason!] ?? 0) + 1;
    if (qualityFailure) qualityRejected++;
  } else if (event === "DATASET_CAPTURED") {
    states.delete(fixtureId);
    captured += count;
  }
  const context = periodEvidence ? { provider: periodEvidence.provider, rawEventStatus: periodEvidence.rawValue,
    normalizedMinute: periodEvidence.normalizedMinute, resolvedPeriod: periodEvidence.period,
    periodConfidence: periodEvidence.confidence, reason: periodEvidence.reason, source: periodEvidence.source } : undefined;
  console.info(JSON.stringify({ event, fixtureId, ...(reason ? { reason } : {}), ...(context ? { periodEvidence: context } : {}), count, at: new Date().toISOString() }));
}

export function datasetDiagnostics() {
  return { scope: "PROCESS_SINCE_START", startedAt, captured, qualityRejected, skippedTransitions: { ...counters },
    note: "Deduplicated skip transitions, not polling attempts. Resets on restart; not shared across workers." };
}
