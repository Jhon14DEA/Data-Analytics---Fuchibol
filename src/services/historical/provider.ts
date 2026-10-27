import { classifyCompetition, scopeBinding, type CompetitionMetadata } from './scope';
import { normalizeApiFootballFixture, seasonKey } from './normalize';

export type HistoricalOperation = 'fixtures' | 'stats' | 'events' | 'lineups' | 'odds';
export type HistoricalResult<T> = { status: 'AVAILABLE'; data: T } | { status: 'NOT_AVAILABLE'; reason: string };
export interface HistoricalFootballProvider {
  fetchFixtures(): Promise<HistoricalResult<unknown[]>>;
  fetchFixtureStats(id: string): Promise<HistoricalResult<unknown[]>>;
  fetchEvents(id: string): Promise<HistoricalResult<unknown[]>>;
  fetchLineups(id: string): Promise<HistoricalResult<unknown[]>>;
  fetchOdds(id: string): Promise<HistoricalResult<unknown[]>>;
}
export type HistoricalPilotOptions = { competition: CompetitionMetadata; season: string; limit: number; dryRun?: boolean };
const paths: Record<HistoricalOperation, string> = { fixtures: '/fixtures', stats: '/fixtures/statistics', events: '/fixtures/events', lineups: '/fixtures/lineups', odds: '/odds' };
export function historicalPilotPlan(options: HistoricalPilotOptions) {
  const binding = scopeBinding('API-Football', options.competition);
  if (!binding || classifyCompetition(options.competition, binding).classification !== 'MEN_SENIOR') throw Error('COMPETITION_NOT_ALLOWED');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) throw Error('PILOT_LIMIT_INVALID');
  seasonKey(options.season);
  return { provider: 'API-Football', competition: options.competition, season: options.season, limit: options.limit,
    dryRun: options.dryRun !== false, status: 'BLOCKED_UNVERIFIED_SEASON_ACCESS',
    host: 'v3.football.api-sports.io', endpoints: [paths.fixtures, paths.stats, paths.events, paths.lineups],
    maximumRequestsIfSupported: 1 + 3 * options.limit, requests: 0,
    odds: 'NOT_AVAILABLE: historical retention not verified for this season', automaticPagination: false };
}

// Offline adapter boundary. No production transport is installed until account/season
// access and an independent durable quota have been verified. Never imports LIVE clients.
export class ApiFootballHistoricalProvider implements HistoricalFootballProvider {
  private selected = new Set<string>();
  private cache = new Map<string, unknown[]>();
  private used = 0;
  constructor(private options: HistoricalPilotOptions, private mock?: {
    kind: 'OFFLINE_TEST'; capabilities: Partial<Record<HistoricalOperation, boolean>>;
    requestLimit: number; read: (path: string, query: Record<string, string>) => Promise<unknown[]>;
  }) { historicalPilotPlan(options); }
  get requests() { return this.used; }
  private async read(operation: HistoricalOperation, id?: string): Promise<HistoricalResult<unknown[]>> {
    if (this.options.dryRun !== false) return { status: 'NOT_AVAILABLE', reason: 'DRY_RUN' };
    if (!this.mock || this.mock.kind !== 'OFFLINE_TEST') return { status: 'NOT_AVAILABLE', reason: 'UNVERIFIED_ACCOUNT_SEASON_AND_HISTORICAL_QUOTA' };
    if (!this.mock.capabilities[operation]) return { status: 'NOT_AVAILABLE', reason: 'CAPABILITY_NOT_VERIFIED' };
    if (id !== undefined && !this.selected.has(id)) return { status: 'NOT_AVAILABLE', reason: 'FIXTURE_OUTSIDE_PILOT' };
    const key = `${operation}:${id ?? ''}`;
    if (this.cache.has(key)) return { status: 'AVAILABLE', data: structuredClone(this.cache.get(key)!) };
    if (!Number.isInteger(this.mock.requestLimit) || this.used >= this.mock.requestLimit) return { status: 'NOT_AVAILABLE', reason: 'HISTORICAL_REQUEST_LIMIT' };
    this.used++; // Before await; concurrent calls cannot exceed this offline session cap.
    const query: Record<string, string> = id ? { fixture: id } : { league: this.options.competition.id, season: this.options.season, status: 'FT' };
    let data: unknown[];
    try { data = await this.mock.read(paths[operation], query); }
    catch { return { status: 'NOT_AVAILABLE', reason: 'PROVIDER_READ_FAILED' }; }
    if (!Array.isArray(data)) return { status: 'NOT_AVAILABLE', reason: 'INVALID_PROVIDER_RESPONSE' };
    if (operation === 'fixtures') {
      const unique = new Map<string, unknown>();
      for (const value of data) {
        try {
          const raw = value as Parameters<typeof normalizeApiFootballFixture>[0];
          if (String(raw.league.id) !== this.options.competition.id || String(raw.league.season) !== this.options.season) continue;
          const fixture = normalizeApiFootballFixture(raw, this.options.season);
          if (fixture && !unique.has(fixture.id)) unique.set(fixture.id, value);
        } catch { /* Malformed records are excluded before any detail operation. */ }
      }
      data = [...unique.values()].slice(0, this.options.limit);
      this.selected = new Set(data.map(value => String((value as { fixture: { id: number } }).fixture.id)));
    }
    this.cache.set(key, structuredClone(data));
    return { status: 'AVAILABLE', data: structuredClone(data) };
  }
  fetchFixtures() { return this.read('fixtures'); }
  fetchFixtureStats(id: string) { return this.read('stats', id); }
  fetchEvents(id: string) { return this.read('events', id); }
  fetchLineups(id: string) { return this.read('lineups', id); }
  fetchOdds(id: string) { return this.read('odds', id); }
}
