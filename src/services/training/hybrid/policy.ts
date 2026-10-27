import type { MatchDetail } from "@/types/domain";
import type { ApiFootballTrainingRaw, TrainingObservation } from "../observation";

// Dataset collection policy only. None of these values feed betting decisions.
export const HYBRID_POLICY = {
  confirmationTtlMs: 10 * 60_000, observationMaxAgeMs: 180_000,
  validationCooldownMs: 10 * 60_000, directoryTtlMs: 15 * 60_000,
  kickoffToleranceMs: 5 * 60_000, maxValidationsPerFixture: 4,
  maxValidationRequestsPerBatch: 2, maxOutcomeRequestsPerBatch: 2,
  maxNewFixturesPerDay: 10,
  automaticCeiling: 80, outcomeReserve: 20, accountLimit: 100
} as const;

export type Identity = { providerFixtureId: string; home: string; away: string; league: string; kickoff: string };
export type PeriodFixture = ApiFootballTrainingRaw & {
  fixture: ApiFootballTrainingRaw["fixture"] & { date?: string; timestamp?: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  league: { id: number; name: string };
};
export type Certificate = { apiFixtureId: string; allSportsFixtureId: string; identityKey: string;
  observedAt: string; expiresAt: string; minute: number; observation: TrainingObservation };

export function normalizeExact(value: string): string {
  // Preserve FC/U21/women/reserve qualifiers; no token deletion or fuzzy matching.
  return value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}
export function identityKey(i: Identity): string {
  return JSON.stringify([i.providerFixtureId, normalizeExact(i.home), normalizeExact(i.away), normalizeExact(i.league), i.kickoff]);
}
export function identityFromMatch(m: MatchDetail): Identity | null {
  const id = m.trainingObservation?.providerFixtureId;
  if (m.source !== "allsports" || m.demo || !id || !/^\d+$/.test(id) || m.id !== `allsports-${id}` || !m.kickoffAt || !Number.isFinite(Date.parse(m.kickoffAt))) return null;
  return { providerFixtureId: id, home: m.homeTeam, away: m.awayTeam, league: m.competition, kickoff: m.kickoffAt };
}
export function compatibleIdentity(i: Identity, f: PeriodFixture): boolean {
  const kickoff = f.fixture.date ? Date.parse(f.fixture.date) : (f.fixture.timestamp ?? NaN) * 1000;
  return !!normalizeExact(i.home) && !!normalizeExact(i.away) && !!normalizeExact(i.league)
    && Math.abs(Date.parse(i.kickoff) - kickoff) <= HYBRID_POLICY.kickoffToleranceMs
    && normalizeExact(i.home) === normalizeExact(f.teams.home.name)
    && normalizeExact(i.away) === normalizeExact(f.teams.away.name)
    && normalizeExact(i.league) === normalizeExact(f.league.name);
}
export function matchFixture(i: Identity, fixtures: PeriodFixture[], persistedId?: string | null) {
  const matches = fixtures.filter(f => compatibleIdentity(i, f) && (!persistedId || String(f.fixture.id) === persistedId));
  const unique = new Map(matches.map(f => [String(f.fixture.id), f]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}
export function statsCoverage(o: TrainingObservation): number {
  return [...Object.values(o.stats.home), ...Object.values(o.stats.away)].filter(v => v !== null).length;
}
export function fresh(o: TrainingObservation, now: Date): boolean {
  const age = now.getTime() - Date.parse(o.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= HYBRID_POLICY.observationMaxAgeMs;
}
export function contradictory(o: TrainingObservation): boolean {
  return ["HALFTIME", "SECOND_HALF", "FINISHED"].includes(o.period) || o.halfTimeScore !== null || o.fullTimeScore !== null
    || (o.score !== null && (o.score.home !== 0 || o.score.away !== 0)) || (o.minute !== null && o.minute >= 45);
}
export function isScout(o: TrainingObservation, live: boolean, now = new Date()): boolean {
  return live && fresh(o, now) && !contradictory(o) && !!o.score && o.score.home === 0 && o.score.away === 0
    && o.minute !== null && Number.isInteger(o.minute) && o.minute >= 8 && o.minute <= 40 && statsCoverage(o) > 0;
}
export function priority(o: TrainingObservation): number {
  return statsCoverage(o) * 100 + (o.minute === null ? 0 : Math.max(0, 40 - Math.abs(24 - o.minute)));
}
export function canValidate(count: number, nextAt: Date | null, now: Date): boolean {
  return count < HYBRID_POLICY.maxValidationsPerFixture && (!nextAt || now >= nextAt);
}
// End certificates before minute 43, even if the normal 10-minute lease has time left.
// Late certificates are shorter; they never authorize capture around halftime.
export function certificateExpiresAt(observedAt: string, minute: number): string {
  return new Date(Date.parse(observedAt) + Math.min(HYBRID_POLICY.confirmationTtlMs, Math.max(0, 43 - minute) * 60_000)).toISOString();
}
export function hybridObservation(i: Identity, o: TrainingObservation, c: Certificate | null, live: boolean, now = new Date()): TrainingObservation | null {
  if (!c || !live || !fresh(o, now) || contradictory(o) || !o.score || o.score.home !== 0 || o.score.away !== 0
    || c.allSportsFixtureId !== o.providerFixtureId || c.identityKey !== identityKey(i)
    || now.getTime() >= Date.parse(c.expiresAt) || now.getTime() < Date.parse(c.observedAt)
    || o.minute === null || o.minute < 1 || o.minute >= 43 || !Number.isInteger(o.minute)) return null;
  const age = (now.getTime() - Date.parse(c.observedAt)) / 60_000;
  if (o.minute < c.minute + Math.max(-1, Math.floor(age) - 2) || o.minute - c.minute > Math.ceil(age) + 2
    || !Number.isFinite(Date.parse(c.observedAt)) || Date.parse(c.observedAt) > Date.parse(o.observedAt)) return null;
  const api = c.observation;
  if (api.period !== "FIRST_HALF" || api.periodEvidence?.confidence !== "CONFIRMED"
    || api.periodEvidence.provider !== "API-Football" || !api.score || api.score.home !== 0 || api.score.away !== 0
    || api.providerFixtureId !== c.apiFixtureId) return null;
  return { ...o, period: "FIRST_HALF", periodEvidence: { ...api.periodEvidence, source: "fixture.status.short+persisted_mapping+TTL",
    reason: "API_FIRST_HALF_CERTIFICATE_WITH_FRESH_ALLSPORTS" },
    periodProvider: "API_FOOTBALL", statsProvider: "ALLSPORTS", oddsProvider: o.odds ? "ALLSPORTS" : null,
    hybridEvidence: { apiFixtureId: c.apiFixtureId, observedAt: c.observedAt, expiresAt: c.expiresAt, identityKey: c.identityKey } };
}
