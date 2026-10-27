import { HYBRID_POLICY as P, canValidate, certificateExpiresAt, isScout, priority, type Identity } from "./policy";
import type { TrainingObservation } from "../observation";

export type SimulationEvent = { at: string; identity: Identity; observation: TrainingObservation; live: boolean };

// Request-cost simulation only, not a betting backtest. No DB writes or network.
// Assumes successful unambiguous matching and missing local outcomes, so labels/results
// are neither invented nor evaluated. Estimate is explicitly conditional on input volume.
export function simulateHybridTraffic(events: SimulationEvent[], budget = 80, enforceBudget = true): Record<string, unknown> {
  const states = new Map<string, { validations: number; nextAt: Date | null; expiry: number; mapped: boolean; ht: boolean; ft: boolean }>();
  const directories = new Map<string, number>(), days = new Map<string, { validation: number; outcome: number; uncapped: number }>();
  let potentialCandidates = 0, cacheHits = 0, periodValidationRequests = 0, htResolutionRequests = 0, ftResolutionRequests = 0, blockedRequests = 0;
  const candidates = new Set<string>();
  const admissions = new Map<string, Set<string>>(), deferred = new Set<string>();
  const ordered = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || priority(b.observation) - priority(a.observation));
  for (const event of ordered) {
    const time = Date.parse(event.at), now = new Date(time), day = event.at.slice(0, 10), o = event.observation;
    const usage = days.get(day) ?? { validation: 0, outcome: 0, uncapped: 0 }; days.set(day, usage);
    const id = event.identity.providerFixtureId;
    const s = states.get(id) ?? { validations: 0, nextAt: null, expiry: 0, mapped: false, ht: false, ft: false }; states.set(id, s);
    function spend(kind: "VALIDATION" | "HT" | "FT"): boolean {
      usage.uncapped++;
      const ceiling = !enforceBudget ? Infinity : kind === "VALIDATION" ? Math.max(0, Math.min(budget, 80) - 20) : Math.min(budget, 80);
      if (usage.validation + usage.outcome >= ceiling) { blockedRequests++; return false; }
      if (kind === "VALIDATION") { usage.validation++; periodValidationRequests++; }
      else { usage.outcome++; if (kind === "HT") htResolutionRequests++; else ftResolutionRequests++; }
      return true;
    }
    if (s.mapped && ["HALFTIME", "SECOND_HALF", "FINISHED"].includes(o.period)) {
      s.expiry = 0;
      if (!s.ht) { s.ht = true; if (!o.halfTimeScore) spend("HT"); }
      if (o.period === "FINISHED" && !s.ft) { s.ft = true; if (!o.fullTimeScore) spend("FT"); }
      continue;
    }
    if (s.ht || !isScout(o, event.live, now)) continue;
    potentialCandidates++; candidates.add(id);
    if (time < s.expiry) { cacheHits++; continue; }
    if (!canValidate(s.validations, s.nextAt, now)) continue;
    if (enforceBudget && s.validations === 0) {
      const admitted = admissions.get(day) ?? new Set<string>(); admissions.set(day, admitted);
      if (!admitted.has(id) && admitted.size >= P.maxNewFixturesPerDay) { deferred.add(id); continue; }
      admitted.add(id);
    }
    s.validations++; s.nextAt = new Date(time + P.validationCooldownMs);
    if (!s.mapped) {
      const date = new Date(event.identity.kickoff).toISOString().slice(0, 10);
      const directory = directories.get(date);
      if (directory === undefined || time - directory >= P.directoryTtlMs) {
        if (!spend("VALIDATION")) continue;
        directories.set(date, time);
      } else if (time - directory >= P.confirmationTtlMs && !spend("VALIDATION")) continue;
      s.mapped = true;
    } else if (!spend("VALIDATION")) continue;
    s.expiry = Date.parse(certificateExpiresAt(event.at, o.minute!));
  }
  const peak = (pick: (s: { validation: number; outcome: number; uncapped: number }) => number) => Math.max(0, ...[...days.values()].map(pick));
  const projectedWithoutBudget = enforceBudget ? Number(simulateHybridTraffic(events, budget, false).projectedWithoutBudget) : peak(s => s.uncapped);
  return { potentialCandidates, uniqueFixtures: candidates.size, periodValidationRequests, cacheHits, htResolutionRequests, ftResolutionRequests,
    estimatedDailyRequests: peak(s => s.validation + s.outcome), projectedWithoutBudget, blockedRequests,
    deferredFixtures: deferred.size,
    activationAllowedByProjection: events.length > 0 && peak(s => s.validation + s.outcome) <= Math.min(budget, 80),
    assumptions: "Unambiguous matching succeeds; only missing HT/FT cost requests. Sample volume is not a measured typical day." };
}
