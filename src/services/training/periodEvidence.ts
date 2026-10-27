import type { AllSportsTrainingRaw, TrainingPeriod } from "./observation";

export type PeriodEvidence = {
  provider: "AllSportsApi" | "API-Football";
  period: TrainingPeriod;
  confidence: "CONFIRMED" | "DERIVED_HIGH" | "UNKNOWN";
  source: string;
  rawValue: string | null;
  rawLive: string | null;
  normalizedMinute: number | null;
  elapsedStoppageTime: number | null;
  reason: string;
};

// Only fields observed in AllSports' original payload are considered. This module
// does not feed app status, display clocks, recommendations or betting decisions.
export function resolveMatchPeriodEvidence(raw: AllSportsTrainingRaw, observedAt: string, now = new Date()): PeriodEvidence {
  const rawValue = typeof raw.event_status === "string" ? raw.event_status.slice(0, 80) : null;
  const status = (rawValue ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const label = status.match(/^(1h|first half|1st half|2h|second half|2nd half)(?:\s*[: ]\s*(.*))?$/);
  const clock = (label?.[2] ?? status).match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2})?)?\s*['′]?$/);
  const minute = clock ? Number(clock[1]) : null;
  const extra = clock?.[2] !== undefined ? Number(clock[2]) : null;
  const base = { provider: "AllSportsApi" as const, source: "event_status", rawValue,
    rawLive: typeof raw.event_live === "string" ? raw.event_live.slice(0, 8) : null,
    normalizedMinute: minute, elapsedStoppageTime: extra };
  const result = (period: TrainingPeriod, confidence: PeriodEvidence["confidence"], reason: string, source = base.source): PeriodEvidence => ({ ...base, period, confidence, reason, source });
  if (["ht", "half time", "halftime"].includes(status)) return result("HALFTIME", "CONFIRMED", "EXPLICIT_HALFTIME_STATUS");
  if (["ft", "finished", "full time", "fulltime", "ended", "aet", "after et", "after extra time", "after pen", "after penalties", "pen"].includes(status)) return result("FINISHED", "CONFIRMED", "EXPLICIT_FINISHED_STATUS");
  if (label) {
    const first = ["1h", "first half", "1st half"].includes(label[1]);
    if (minute !== null && (first ? minute < 1 || minute > 45 : minute < 46 || minute > 90)) return result("UNKNOWN", "UNKNOWN", "CONTRADICTORY_PERIOD_CLOCK");
    // Raw halftime_result is also populated in observed numeric 25/29 payloads;
    // its presence alone is not proof that halftime has occurred.
    return result(first ? "FIRST_HALF" : "SECOND_HALF", "CONFIRMED", "EXPLICIT_PERIOD_STATUS");
  }
  if (minute === 45) return result("UNKNOWN", "UNKNOWN", "AMBIGUOUS_45_OR_ADDED_TIME");
  const score = (value?: string) => value?.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  const ht = score(raw.event_halftime_result), current = score(raw.event_final_result);
  const age = now.getTime() - Date.parse(observedAt);
  if (minute !== null && minute >= 46 && minute < 90 && /^\d+$/.test(status) && raw.event_live === "1" && ht && current
      && !score(raw.event_ft_result)
      && Number(current[1]) >= Number(ht[1]) && Number(current[2]) >= Number(ht[2])
      && age >= 0 && age <= 180000) {
    return result("SECOND_HALF", "DERIVED_HIGH", "LIVE_CLOCK_AFTER_45_WITH_CONFIRMED_HT_AND_CURRENT_SCORE",
      "event_status+event_live+event_halftime_result+event_final_result+receiptTime");
  }
  // LIVE + fresh score + empty HT are not positive independent evidence of 1T:
  // event_live can remain 1 after FT, and missing HT can be lack of coverage.
  return result("UNKNOWN", "UNKNOWN", minute !== null && minute >= 1 && minute <= 44
    ? "INSUFFICIENT_FIRST_HALF_EVIDENCE" : "INSUFFICIENT_PERIOD_EVIDENCE");
}
