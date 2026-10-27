import { resolveMatchPeriodEvidence, type PeriodEvidence } from "./periodEvidence";
import { parseGoalTotal, timestampIssue } from "./oddsIntegrity";
// Dataset-only metadata. Existing display/decision mappings are deliberately unchanged.
export type TrainingPeriod = "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "FINISHED" | "UNKNOWN";
export type ConfirmedScore = { home: number; away: number };
export type TrainingStats = {
  shots: number | null; sot: number | null; xg: number | null;
  bigChances: number | null; shotsInsideBox: number | null;
  corners: number | null; dangerousAttacks: number | null; redCards: number | null;
};
export type TrainingObservation = {
  providerFixtureId: string;
  observedAt: string;
  receipts?: { fixture: string; stats: string | null };
  period: TrainingPeriod;
  periodEvidence?: PeriodEvidence;
  periodProvider?: "API_FOOTBALL" | "ALLSPORTS" | null;
  statsProvider?: "API_FOOTBALL" | "ALLSPORTS" | null;
  oddsProvider?: "API_FOOTBALL" | "ALLSPORTS" | null;
  hybridEvidence?: { apiFixtureId: string; observedAt: string; expiresAt: string; identityKey: string };
  minute: number | null;
  elapsedStoppageTime: number | null;
  // Announced TOTAL added time, not added time already played.
  stoppageTime: number | null;
  score: ConfirmedScore | null;
  halfTimeScore: ConfirmedScore | null;
  fullTimeScore: ConfirmedScore | null;
  stats: { home: TrainingStats; away: TrainingStats };
  odds: { price: number; bookmaker: string; quotedAt: string; receivedAt?: string } | null;
};

export function knownNumber(value: unknown, integer = false): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && (!integer || Number.isInteger(n)) ? n : null;
}

export function confirmedScore(home: unknown, away: unknown): ConfirmedScore | null {
  const h = knownNumber(home, true), a = knownNumber(away, true);
  return h === null || a === null ? null : { home: h, away: a };
}

function scoreText(value: unknown): ConfirmedScore | null {
  const parts = typeof value === "string" ? value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/) : null;
  return parts ? confirmedScore(parts[1], parts[2]) : null;
}

export function strictStats(read: (names: string[]) => unknown): TrainingStats {
  return {
    shots: knownNumber(read(["shots total", "total shots", "goal attempts"]), true),
    sot: knownNumber(read(["shots on goal", "shots on target"]), true),
    xg: knownNumber(read(["expected goals", "expected_goals", "xg"])),
    bigChances: knownNumber(read(["big chances", "big chances total"]), true),
    shotsInsideBox: knownNumber(read(["shots insidebox", "shots inside box", "shots inside the box"]), true),
    corners: knownNumber(read(["corners", "corner kicks"]), true),
    dangerousAttacks: knownNumber(read(["dangerous attacks"]), true),
    redCards: knownNumber(read(["red cards"]), true)
  };
}

export type AllSportsTrainingRaw = {
  event_key: string; event_status?: string; event_live?: string;
  event_final_result?: string; event_halftime_result?: string; event_ft_result?: string;
  statistics?: { type?: string; home?: unknown; away?: unknown }[];
};

export function allSportsObservation(raw: AllSportsTrainingRaw, observedAt: string): TrainingObservation {
  const evidence = resolveMatchPeriodEvidence(raw, observedAt);
  const { period, normalizedMinute: minute, elapsedStoppageTime: extra } = evidence;
  const status = (raw.event_status ?? "").trim().toLowerCase();
  const ft = period === "FINISHED", ht = period === "HALFTIME";
  const score = scoreText(raw.event_final_result);
  const halfTimeScore = ht ? scoreText(raw.event_halftime_result) ?? score
    : period === "SECOND_HALF" || ft ? scoreText(raw.event_halftime_result) : null;
  const fullTimeScore = ft ? scoreText(raw.event_ft_result) ?? (["ft", "finished", "full time", "fulltime", "ended"].includes(status) ? score : null) : null;
  const stats = (side: "home" | "away") => strictStats(names => raw.statistics?.find(s => names.includes((s.type ?? "").trim().toLowerCase()))?.[side]);
  return { providerFixtureId: String(raw.event_key ?? ""), observedAt, period, periodEvidence: evidence, minute,
    elapsedStoppageTime: extra, stoppageTime: null, score, halfTimeScore, fullTimeScore,
    stats: { home: stats("home"), away: stats("away") }, odds: null };
}

export type ApiFootballTrainingRaw = {
  fixture: { id: number; status: { short?: string; elapsed?: number | null; extra?: number | null } };
  goals: { home: number | null; away: number | null };
  score?: { halftime?: { home: number | null; away: number | null }; fulltime?: { home: number | null; away: number | null } };
  teams: { home: { id: number }; away: { id: number } };
};

export function apiFootballObservation(raw: ApiFootballTrainingRaw, observedAt: string, statistics: { team: { id: number }; statistics: { type: string; value: unknown }[] }[] = []): TrainingObservation {
  const status = raw.fixture.status.short;
  const period: TrainingPeriod = status === "1H" ? "FIRST_HALF" : status === "HT" ? "HALFTIME"
    : status === "2H" ? "SECOND_HALF" : ["FT", "AET", "PEN"].includes(status ?? "") ? "FINISHED" : "UNKNOWN";
  const score = confirmedScore(raw.goals.home, raw.goals.away);
  const ht = raw.score?.halftime, ft = raw.score?.fulltime;
  const stats = (id: number) => strictStats(names => statistics.find(s => s.team.id === id)?.statistics.find(s => names.includes(s.type.trim().toLowerCase()))?.value);
  return { providerFixtureId: String(raw.fixture.id), observedAt, period,
    periodEvidence: { provider: "API-Football", period, confidence: period === "UNKNOWN" ? "UNKNOWN" : "CONFIRMED",
      source: "fixture.status.short", rawValue: status ?? null, rawLive: null,
      normalizedMinute: knownNumber(raw.fixture.status.elapsed, true), elapsedStoppageTime: knownNumber(raw.fixture.status.extra, true),
      reason: period === "UNKNOWN" ? "UNKNOWN_API_FOOTBALL_STATUS" : "EXPLICIT_API_FOOTBALL_STATUS" },
    minute: knownNumber(raw.fixture.status.elapsed, true),
    elapsedStoppageTime: knownNumber(raw.fixture.status.extra, true), stoppageTime: null, score,
    halfTimeScore: period !== "FIRST_HALF" && period !== "UNKNOWN" ? confirmedScore(ht?.home, ht?.away) ?? (period === "HALFTIME" ? score : null) : null,
    fullTimeScore: period === "FINISHED" ? confirmedScore(ft?.home, ft?.away) ?? (status === "FT" ? score : null) : null,
    stats: { home: stats(raw.teams.home.id), away: stats(raw.teams.away.id) }, odds: null };
}

// Track receipt time on cache misses only. Re-reading a cached object is not a new observation.
const receivedAt = new WeakMap<object, string>();
export function rememberTrainingReceipt(payload: unknown, at = new Date().toISOString()): void {
  if (payload && typeof payload === "object") receivedAt.set(payload, at);
  if (Array.isArray(payload)) for (const row of payload) {
    if (row && typeof row === "object") receivedAt.set(row, at);
  }
}
export function trainingReceipt(raw: object): string | null { return receivedAt.get(raw) ?? null; }

// API-Football serves score/clock and statistics separately. Do not backdate newer
// statistics to a cached fixture, or pair metrics with a clock more than 30s away.
export function alignedApiFootballObservation(raw: ApiFootballTrainingRaw, statistics: Parameters<typeof apiFootballObservation>[2]) {
  const clockAt = trainingReceipt(raw);
  if (!clockAt) return undefined;
  const statsAt = trainingReceipt(statistics ?? []);
  const aligned = statsAt !== null && Math.abs(Date.parse(statsAt) - Date.parse(clockAt)) <= 30_000;
  const at = aligned && statsAt! > clockAt ? statsAt! : clockAt;
  return { ...apiFootballObservation(raw, at, aligned ? statistics : []), receipts: { fixture: clockAt, stats: aligned ? statsAt : null } };
}

export function selectFirstHalfOdds(quotes: { market: string; selection: string; price: number; quotedAt: string; bookmaker: string }[], at: string, receivedAt: string | null = null) {
  if (!receivedAt) return null;
  const timestamp = Date.parse(at);
  const eligible = quotes.filter(q => {
    const parsed = parseGoalTotal(q.market, q.selection, q.price);
    const age = timestamp - Date.parse(q.quotedAt);
    return parsed?.period === 'FIRST_HALF' && parsed.selection === 'OVER' && parsed.line === 0.5
      && !timestampIssue(q.quotedAt, receivedAt, at) && age >= 0 && age <= 180_000;
  }).sort((a, b) => Date.parse(b.quotedAt) - Date.parse(a.quotedAt) || a.bookmaker.localeCompare(b.bookmaker) || a.price - b.price);
  const q = eligible[0];
  return q ? { price: q.price, bookmaker: q.bookmaker, quotedAt: q.quotedAt, receivedAt } : null;
}
