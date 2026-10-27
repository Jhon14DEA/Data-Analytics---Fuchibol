import type {
  FootballDebugStatus,
  LineupPlayer,
  MatchAnalysisContext,
  MatchDetail,
  MatchEvent,
  MatchSearchDiagnostics,
  MatchSearchResult,
  MatchStatus,
  MatchSummary,
  OddsQuote,
  PlayerStat,
  TeamSide,
  TeamStats
} from "@/types/domain";
import type { FootballProvider } from "./types";
import { strictStats } from "@/services/training/observation";
import { cachedRequest, CACHE_TTL, fetchJsonWithResilience, getPerformanceCacheAge, getPerformanceMetricRecords, invalidatePerformanceCache, measureProcess } from "@/lib/performance";
import { getFixtureLifecycleDebug, getLiveMomentumBreakdown, getLiveSnapshotTrend, getLocalAnalysisHistory, getMatchDataFreshness, getPreviousLiveStats, persistMatchDetail, reconcileMissingProviderFixture } from "@/services/persistence/footballPersistence";
import { allSportsObservation, rememberTrainingReceipt, selectFirstHalfOdds, trainingReceipt } from "@/services/training/observation";
import { resolveObservedMarketResults } from "@/services/training/liveMarketSnapshots";

const API_BASE_URL = "https://apiv2.allsportsapi.com/football/";
const PRIORITY_LEAGUE_TERMS = [
  "champions league",
  "europa league",
  "conference league",
  "premier league",
  "laliga",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "libertadores",
  "sudamericana",
  "ligapro",
  "liga pro"
];

type AllSportsEnvelope<T> = {
  success?: number;
  result?: T;
  error?: string | string[];
  errors?: string | string[] | Record<string, unknown>;
  message?: string;
};

type AllSportsMatch = {
  event_key: string;
  event_date?: string;
  event_time?: string;
  event_home_team?: string;
  home_team_key?: string;
  event_away_team?: string;
  away_team_key?: string;
  event_final_result?: string;
  event_ft_result?: string;
  event_halftime_result?: string;
  event_status?: string;
  event_live?: string;
  league_name?: string;
  league_key?: string;
  country_name?: string;
  goalscorers?: AllSportsGoal[];
  cards?: AllSportsCard[];
  substitutes?: AllSportsSubstitution[];
  lineups?: {
    home_team?: AllSportsLineupTeam;
    away_team?: AllSportsLineupTeam;
  };
  statistics?: AllSportsStatistic[];
  player_statistics?: AllSportsPlayerStat[] | Record<string, AllSportsPlayerStat[]>;
  players_statistics?: AllSportsPlayerStat[] | Record<string, AllSportsPlayerStat[]>;
};

type AllSportsGoal = {
  time?: string;
  home_scorer?: string;
  away_scorer?: string;
  score?: string;
};

type AllSportsCard = {
  time?: string;
  home_fault?: string;
  away_fault?: string;
  card?: string;
};

type AllSportsSubstitution = {
  time?: string;
  home_scorer?: { in?: string; out?: string } | [];
  away_scorer?: { in?: string; out?: string } | [];
  score?: string;
};

type AllSportsLineupTeam = {
  starting_lineups?: AllSportsLineupPlayer[];
  substitutes?: AllSportsLineupPlayer[];
};

type AllSportsLineupPlayer = {
  player?: string;
  player_number?: string;
  player_position?: string;
};

type AllSportsStatistic = {
  type?: string;
  home?: string | number | null;
  away?: string | number | null;
};

type AllSportsPlayerStat = {
  player_name?: string;
  player?: string;
  team_name?: string;
  player_position?: string;
  player_type?: string;
  player_shots_total?: string | number | null;
  player_shots_on_goal?: string | number | null;
  player_key_passes?: string | number | null;
  player_fouls_committed?: string | number | null;
  player_expected_goals?: string | number | null;
  player_minutes?: string | number | null;
  player_goals?: string | number | null;
  player_assists?: string | number | null;
  player_expected_assists?: string | number | null;
  player_fouls_received?: string | number | null;
  player_yellow_cards?: string | number | null;
  player_red_cards?: string | number | null;
};

type AllSportsOddsResult = Record<string, AllSportsOddsRow[]>;
type AllSportsOddsRow = Record<string, string | number | null | undefined> & {
  match_id?: string;
  odd_bookmakers?: string;
};

export type AllSportsMarketDebugQuote = {
  bookmaker: string;
  rawField: string;
  rawMarket: string;
  rawSelection: string;
  line: number | null;
  selection: string;
  price: number;
  normalizedMarket: string;
};

type AllSportsLiveOddsResult = Record<string, AllSportsLiveOddsRow[]>;
type AllSportsLiveOddsRow = Record<string, string | number | null | undefined> & {
  odd_name?: string;
  is_odd_suspended?: string;
  odd_type?: string;
  odd_value?: string | number | null;
  odd_participant_handicap?: string | number | null;
  odd_last_updated?: string;
};

type ReconciledRawMatch = {
  match: AllSportsMatch | null;
  source: "Fixtures" | "Livescore" | "none";
  reason: string;
  rawStatus: string | null;
};

export class AllSportsApiProvider implements FootballProvider {
  readonly status: string;
  private readonly apiKey: string | undefined;
  private readonly loadedMatches = new Map<string, MatchSummary>();

  constructor() {
    this.apiKey = process.env.ALLSPORTS_API_KEY?.trim() || undefined;
    this.status = this.apiKey ? "AllSportsApi configurada" : "AllSportsApi no configurada";
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async listMatches(): Promise<MatchSummary[]> {
    this.ensureConfigured();

    return cachedRequest(
      `allsports:list:${formatDate(new Date())}`,
      "fixtures+livescore",
      async () => {
        const today = formatDate(new Date());
        const [fixtures, livescore] = await Promise.all([
          this.request<AllSportsMatch[]>("Fixtures", { from: today, to: today, timezone: "America/Bogota" }),
          this.request<AllSportsMatch[]>("Livescore", { timezone: "America/Bogota" })
        ]);

        const raw = reconcileMatches(fixtures ?? [], livescore ?? []);
        await resolveObservedMarketResults("AllSportsApi", raw.flatMap(item => {
          const at = trainingReceipt(item);
          return at ? [allSportsObservation(item, at)] : [];
        }));
        const matches = raw.map(mapMatchSummary);
        const ordered = orderMatchesForDashboard(matches);
        this.rememberMatches(ordered);
        return ordered;
      },
      CACHE_TTL.live,
      "AllSportsApi"
    );
  }

  async searchMatches(query: string, date?: string): Promise<MatchSummary[]> {
    return (await this.searchMatchesDetailed(query, date)).matches;
  }

  async listAllMatchesToday(): Promise<MatchSummary[]> {
    this.ensureConfigured();

    return cachedRequest(
      `allsports:list-all:${formatDate(new Date())}`,
      "fixtures+livescore:all",
      async () => {
        const today = formatDate(new Date());
        const [fixtures, livescore] = await Promise.all([
          this.request<AllSportsMatch[]>("Fixtures", { from: today, to: today, timezone: "America/Bogota" }),
          this.request<AllSportsMatch[]>("Livescore", { timezone: "America/Bogota" })
        ]);
        const raw = reconcileMatches(fixtures ?? [], livescore ?? []);
        await resolveObservedMarketResults("AllSportsApi", raw.flatMap(item => {
          const at = trainingReceipt(item);
          return at ? [allSportsObservation(item, at)] : [];
        }));
        const matches = raw.map(mapMatchSummary);
        this.rememberMatches(matches);
        return matches;
      },
      CACHE_TTL.live,
      "AllSportsApi"
    );
  }

  async debugListMatches(date = formatDate(new Date())) {
    this.ensureConfigured();

    const [fixtures, livescore] = await Promise.all([
      this.request<AllSportsMatch[]>("Fixtures", { from: date, to: date, timezone: "America/Bogota" }),
      this.request<AllSportsMatch[]>("Livescore", { timezone: "America/Bogota" })
    ]);
    const rawFixtures = fixtures ?? [];
    const rawLivescore = livescore ?? [];
    const normalized = reconcileMatches(rawFixtures, rawLivescore).map(mapMatchSummary);
    const returned = orderMatchesForDashboard(normalized);
    const priority = normalized.filter((match) => isPriorityLeague(match.competition));
    const discardedByLeague = normalized
      .filter((match) => !returned.some((item) => item.id === match.id))
      .reduce<Record<string, number>>((acc, match) => {
        acc[match.competition] = (acc[match.competition] ?? 0) + 1;
        return acc;
      }, {});
    const discardedByStatus = normalized
      .filter((match) => !["LIVE", "UPCOMING", "FINISHED"].includes(match.status))
      .reduce<Record<string, number>>((acc, match) => {
        acc[match.status] = (acc[match.status] ?? 0) + 1;
        return acc;
      }, {});

    return {
      provider: "AllSportsApi",
      timezone: "America/Bogota",
      dateUsed: date,
      totals: {
        rawFixtures: rawFixtures.length,
        rawLivescore: rawLivescore.length,
        afterNormalize: normalized.length,
        priorityMatches: priority.length,
        liveMatches: normalized.filter((match) => match.status === "LIVE").length,
        returnedByListMatches: returned.length
      },
      priorityLeagueTerms: PRIORITY_LEAGUE_TERMS,
      discardedLeagues: Object.entries(discardedByLeague)
        .sort((a, b) => b[1] - a[1])
        .map(([league, count]) => ({ league, count })),
      discardedStatuses: Object.entries(discardedByStatus).map(([status, count]) => ({ status, count })),
      returnedMatches: returned.map((match) => ({
        id: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        competition: match.competition,
        status: match.status,
        minute: match.minute,
        score: match.score,
        kickoffAt: match.kickoffAt
      })),
      nationsLeagueMatches: normalized
        .filter((match) => normalize(match.competition).includes("nations league"))
        .map((match) => ({
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          competition: match.competition,
          status: match.status,
          minute: match.minute,
          score: match.score,
          kickoffAt: match.kickoffAt,
          returnedByListMatches: returned.some((item) => item.id === match.id),
          discardReason: returned.some((item) => item.id === match.id)
            ? null
            : "DISCARDED_BY_UNKNOWN_FILTER"
        }))
    };
  }

  async searchMatchesDetailed(query: string, date?: string): Promise<MatchSearchResult> {
    this.ensureConfigured();

    const diagnostics: MatchSearchDiagnostics = {
      term: query,
      provider: "AllSportsApi",
      searchedRanges: [],
      apiResults: 0,
      filteredOut: 0,
      filterReasons: [],
      cacheHits: 0,
      cacheMisses: 0,
      endpoints: []
    };

    const cachedMatches = [...this.loadedMatches.values()];
    const cached = filterMatches(cachedMatches, query);
    diagnostics.cacheHits = cachedMatches.length;
    diagnostics.filteredOut += Math.max(0, cachedMatches.length - cached.length);
    if (cached.length) {
      diagnostics.filterReasons.push("match en cache local por equipo/competicion");
      return { matches: cached.slice(0, 20), diagnostics };
    }

    const ranges = date ? [singleDayRange(date), centeredRange(date, 7), centeredRange(date, 30)] : [centeredRange(formatDate(new Date()), 7), centeredRange(formatDate(new Date()), 30)];
    const seenRanges = new Set<string>();

    for (const range of ranges) {
      const rangeKey = `${range.from}:${range.to}`;
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);
      diagnostics.searchedRanges.push(`${range.from}..${range.to}`);
      diagnostics.endpoints.push(`Fixtures?from=${range.from}&to=${range.to}`);
      const matches = await this.searchRange(range.from, range.to);
      diagnostics.apiResults += matches.length;
      diagnostics.cacheMisses += 1;
      this.rememberMatches(matches);

      const filtered = filterMatches(matches, query);
      diagnostics.filteredOut += Math.max(0, matches.length - filtered.length);
      if (filtered.length) {
        diagnostics.filterReasons.push(`coincidencia encontrada en rango ${range.from}..${range.to}`);
        return { matches: filtered.slice(0, 20), diagnostics };
      }
    }

    diagnostics.filterReasons.push("ningun equipo/local/visitante/competicion coincidió tras normalizar el termino");
    return { matches: [], diagnostics };
  }

  async listMatchesByDate(date: string): Promise<MatchSummary[]> {
    this.ensureConfigured();

    return cachedRequest(
      `allsports:list:${date}`,
      "fixtures",
      async () => {
        const fixtures = await this.request<AllSportsMatch[]>("Fixtures", { from: date, to: date, timezone: "America/Bogota" });
        const matches = dedupeMatches(fixtures ?? []).map(mapMatchSummary);
        this.rememberMatches(matches);
        const priority = matches.filter((match) => isPriorityLeague(match.competition));
        return priority.length ? priority : matches;
      },
      CACHE_TTL.fixtures,
      "AllSportsApi"
    );
  }

  private async searchRange(from: string, to: string): Promise<MatchSummary[]> {
    return cachedRequest(
      `allsports:search:${from}:${to}`,
      "fixtures:search",
      async () => {
        const fixtures = await this.request<AllSportsMatch[]>("Fixtures", { from, to, timezone: "America/Bogota" });
        return dedupeMatches(fixtures ?? []).map(mapMatchSummary);
      },
      CACHE_TTL.historical,
      "AllSportsApi"
    );
  }

  private rememberMatches(matches: MatchSummary[]) {
    matches.forEach((match) => {
      const existing = this.loadedMatches.get(match.id);
      if (existing?.status === "FINISHED" && match.status === "LIVE") {
        this.loadedMatches.set(match.id, existing);
        return;
      }
      this.loadedMatches.set(match.id, match);
    });
  }

  async getAnalysisContext(matchId: string): Promise<MatchAnalysisContext | null> {
    this.ensureConfigured();

    const eventId = matchId.replace("allsports-", "");
    const rawMatch = await measureProcess("allsports.raw-match", () => this.getRawMatch(eventId), "AllSportsApi");
    if (!rawMatch) {
      const reconciled = await reconcileMissingProviderFixture(matchId, "AllSportsApi no devolvio el fixture en Fixtures ni Livescore durante refresh.");
      if (!reconciled) return null;
      return {
        match: reconciled,
        recentHome: [],
        recentAway: [],
        h2h: [],
        liveSnapshotTrend: null,
        liveMomentum: null,
        dataFreshness: await getMatchDataFreshness(matchId, reconciled),
        provider: "AllSportsApi+PostgreSQL",
        generatedAt: new Date().toISOString()
      };
    }

    const match = await measureProcess("allsports.map-detail", () => this.mapDetail(rawMatch), "AllSportsApi");
    await measureProcess("db.persist-match-detail", () => persistMatchDetail(match), "PostgreSQL");
    const [liveSnapshotTrend, liveMomentum, dataFreshness, localBefore] = await Promise.all([
      measureProcess("db.live-snapshot-trend", () => getLiveSnapshotTrend(match.id), "PostgreSQL"),
      measureProcess("db.live-momentum", () => getLiveMomentumBreakdown(match.id, match), "PostgreSQL"),
      measureProcess("db.data-freshness", () => getMatchDataFreshness(match.id, match), "PostgreSQL"),
      measureProcess("db.local-analysis-history", () => getLocalAnalysisHistory(match, 10), "PostgreSQL")
    ]);
    if (localBefore.recentHome.length >= 10 && localBefore.recentAway.length >= 10 && localBefore.h2h.length >= 5) {
      return {
        match,
        recentHome: localBefore.recentHome,
        recentAway: localBefore.recentAway,
        h2h: localBefore.h2h,
        liveSnapshotTrend,
        liveMomentum,
        dataFreshness,
        provider: "AllSportsApi+PostgreSQL",
        generatedAt: new Date().toISOString()
      };
    }

    if (match.status === "LIVE") {
      return {
        match,
        recentHome: localBefore.recentHome,
        recentAway: localBefore.recentAway,
        h2h: localBefore.h2h,
        liveSnapshotTrend,
        liveMomentum,
        dataFreshness,
        provider: "AllSportsApi+PostgreSQL(live-fast)",
        generatedAt: new Date().toISOString()
      };
    }

    const { from, to } = recentWindow();
    const homeTeamKey = rawMatch.home_team_key;
    const awayTeamKey = rawMatch.away_team_key;

    const [homeRaw, awayRaw, h2hRaw] = await Promise.all([
      localBefore.recentHome.length >= 10 || !homeTeamKey
        ? Promise.resolve([])
        : homeTeamKey
        ? measureProcess("allsports.history.home", () => this.request<AllSportsMatch[]>("Fixtures", { teamId: homeTeamKey, from, to, timezone: "America/Bogota", withPlayerStats: "1" }), "AllSportsApi").catch(() => [])
        : Promise.resolve([]),
      localBefore.recentAway.length >= 10 || !awayTeamKey
        ? Promise.resolve([])
        : awayTeamKey
        ? measureProcess("allsports.history.away", () => this.request<AllSportsMatch[]>("Fixtures", { teamId: awayTeamKey, from, to, timezone: "America/Bogota", withPlayerStats: "1" }), "AllSportsApi").catch(() => [])
        : Promise.resolve([]),
      localBefore.h2h.length >= 5 || !homeTeamKey || !awayTeamKey
        ? Promise.resolve({ H2H: [] })
        : homeTeamKey && awayTeamKey
        ? measureProcess("allsports.h2h", () => this.request<{ H2H?: AllSportsMatch[] }>("H2H", {
            firstTeamId: homeTeamKey,
            secondTeamId: awayTeamKey,
            timezone: "America/Bogota"
          }), "AllSportsApi").catch(() => ({ H2H: [] }))
        : Promise.resolve({ H2H: [] })
    ]);
    const fetchedHistory = [...homeRaw, ...awayRaw, ...(h2hRaw.H2H ?? [])].filter((item) => item.event_key !== rawMatch.event_key);
    await measureProcess("db.persist-history", async () => {
      for (const item of fetchedHistory) {
        await persistMatchDetail(this.mapDetailFromRaw(item));
      }
    }, "PostgreSQL");
    const localAfter = await measureProcess("db.local-analysis-history.after", () => getLocalAnalysisHistory(match, 10), "PostgreSQL");

    return {
      match,
      recentHome: localAfter.recentHome.length ? localAfter.recentHome : homeRaw.filter((item) => item.event_key !== rawMatch.event_key).slice(-10).map((item) => this.mapDetailFromRaw(item)),
      recentAway: localAfter.recentAway.length ? localAfter.recentAway : awayRaw.filter((item) => item.event_key !== rawMatch.event_key).slice(-10).map((item) => this.mapDetailFromRaw(item)),
      h2h: localAfter.h2h.length ? localAfter.h2h : (h2hRaw.H2H ?? []).slice(0, 10).map((item) => this.mapDetailFromRaw(item)),
      liveSnapshotTrend,
      liveMomentum,
      dataFreshness,
      provider: "AllSportsApi+PostgreSQL",
      generatedAt: new Date().toISOString()
    };
  }

  async getMatch(matchId: string): Promise<MatchDetail | null> {
    this.ensureConfigured();

    const eventId = matchId.replace("allsports-", "");
    if (!eventId || eventId === matchId) {
      return null;
    }

    const resolved = await this.getRawMatchWithTrace(eventId);
    if (!resolved.match) {
      return reconcileMissingProviderFixture(matchId, "AllSportsApi no devolvio el fixture en Fixtures ni Livescore durante refresh.");
    }

    const detail = await this.mapDetail(resolved.match);
    await persistMatchDetail(detail);
    return detail;
  }

  invalidateMatchCache(matchId: string) {
    const eventId = matchId.replace("allsports-", "");
    if (!eventId || eventId === matchId) return 0;
    return invalidatePerformanceCache((key) => key.includes(`matchId=${eventId}`));
  }

  invalidateListCache() {
    return invalidatePerformanceCache((key) => key.startsWith("allsports:list:") || key.startsWith("allsports:list-all:"));
  }

  async mapDetail(match: AllSportsMatch): Promise<MatchDetail> {
    const eventId = match.event_key;
    const minute = parseMinute(match.event_status);
    const status = mapStatus(match);
    const [odds, liveOdds] = await Promise.all([
      this.request<AllSportsOddsResult>("Odds", { matchId: eventId }).catch(() => ({})),
      status === "LIVE"
        ? this.request<AllSportsLiveOddsResult>("OddsLive", { matchId: eventId, timezone: "America/Bogota" }).catch(() => ({}))
        : Promise.resolve({})
    ]);

    const currentOdds = [...mapOdds(odds, null), ...mapLiveOdds(liveOdds, minute)];
    const received = trainingReceipt(match);
    const trainingObservation = received ? allSportsObservation(match, received) : undefined;
    if (trainingObservation) {
      // Only live quotes with an explicit provider timestamp; never prematch/FT substitutes.
      const confirmed = Object.fromEntries(Object.entries(liveOdds).map(([key, rows]) => [key,
        rows.flatMap(row => {
          // Check the original market before display normalization can erase scope/period.
          if (/team|home|away|local|visitante|corner|card|handicap|2nd|second|full.?time|\b(ft|2h|2t)\b/i.test(String(row.odd_name ?? ""))) return [];
          const rawDate = String(row.odd_last_updated ?? "");
          // OddsLive is requested in America/Bogota (UTC-05, no DST).
          const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawDate)
            ? `${rawDate.replace(" ", "T")}-05:00` : rawDate;
          return /(?:Z|[+-]\d{2}:?\d{2})$/.test(date) && Number.isFinite(Date.parse(date))
            ? [{ ...row, odd_last_updated: date }] : [];
        })
      ]));
      trainingObservation.odds = selectFirstHalfOdds(mapLiveOdds(confirmed, minute), received!, trainingReceipt(liveOdds));
    }

    return {
      ...mapMatchSummary(match),
      trainingObservation,
      demo: false,
      providerStatus: this.status,
      stats: mapStats(match.statistics ?? [], match.cards ?? []),
      lineups: {
        home: mapLineup(match.lineups?.home_team),
        away: mapLineup(match.lineups?.away_team)
      },
      substitutions: mapSubstitutions(match.substitutes ?? []),
      events: [...mapGoals(match.goalscorers ?? []), ...mapCards(match.cards ?? []), ...mapSubstitutions(match.substitutes ?? [])].sort(
        (a, b) => a.minute - b.minute
      ),
      playerStats: mapPlayerStats(match),
      odds: currentOdds,
      oddsHistory: currentOdds,
      analysis: [],
      alerts: []
    };
  }

  private mapDetailFromRaw(match: AllSportsMatch): MatchDetail {
    const received = trainingReceipt(match);
    return {
      ...mapMatchSummary(match),
      trainingObservation: received ? allSportsObservation(match, received) : undefined,
      demo: false,
      providerStatus: this.status,
      stats: mapStats(match.statistics ?? [], match.cards ?? []),
      lineups: {
        home: mapLineup(match.lineups?.home_team),
        away: mapLineup(match.lineups?.away_team)
      },
      substitutions: mapSubstitutions(match.substitutes ?? []),
      events: [...mapGoals(match.goalscorers ?? []), ...mapCards(match.cards ?? []), ...mapSubstitutions(match.substitutes ?? [])].sort(
        (a, b) => a.minute - b.minute
      ),
      playerStats: mapPlayerStats(match),
      odds: [],
      oddsHistory: [],
      analysis: [],
      alerts: []
    };
  }

  private async getRawMatch(eventId: string) {
    return (await this.getRawMatchWithTrace(eventId)).match;
  }

  private async getRawMatchWithTrace(eventId: string): Promise<ReconciledRawMatch> {
    const [fixtures, liveMatches] = await Promise.all([
      this.request<AllSportsMatch[]>("Fixtures", {
        matchId: eventId,
        timezone: "America/Bogota",
        withPlayerStats: "1"
      }).catch(() => []),
      this.request<AllSportsMatch[]>("Livescore", {
        matchId: eventId,
        timezone: "America/Bogota",
        withPlayerStats: "1"
      }).catch(() => [])
    ]);

    return reconcileFixtureRaw(fixtures?.[0] ?? null, liveMatches?.[0] ?? null);
  }

  async getPreviousSnapshot(matchId: string) {
    return getPreviousLiveStats(matchId);
  }

  async getCurrentOdds(matchId: string): Promise<OddsQuote[]> {
    const match = await this.getMatch(matchId);
    return match?.odds ?? [];
  }

  async getOddsHistory(matchId: string): Promise<OddsQuote[]> {
    const match = await this.getMatch(matchId);
    return match?.oddsHistory ?? [];
  }

  async debugMarkets(matchId: string) {
    this.ensureConfigured();
    const eventId = matchId.replace("allsports-", "");
    const [odds, liveOdds] = await Promise.all([
      this.request<AllSportsOddsResult>("Odds", { matchId: eventId }).catch(() => ({})),
      this.request<AllSportsLiveOddsResult>("OddsLive", { matchId: eventId, timezone: "America/Bogota" }).catch(() => ({}))
    ]);

    const preMatch = debugOdds(odds);
    const live = debugLiveOdds(liveOdds);
    return {
      provider: "AllSportsApi",
      fixtureId: matchId,
      endpointConsulted: [`Odds?matchId=${eventId}`, `OddsLive?matchId=${eventId}`],
      total: preMatch.length + live.length,
      markets: [...preMatch, ...live]
    };
  }

  async debugStatus(): Promise<FootballDebugStatus> {
    if (!this.apiKey) {
      const debug = {
        configured: false,
        provider: "AllSportsApi" as const,
        statusCode: null,
        message: "AllSportsApi no configurada",
        remainingRequests: null,
        usedRequests: null
      };
      logDebug(debug);
      return debug;
    }

    try {
      const response = await this.rawRequest<unknown>("Countries", {});
      const debug = {
        configured: true,
        provider: "AllSportsApi" as const,
        statusCode: response.statusCode,
        message: "AllSportsApi conectada",
        remainingRequests: response.remainingRequests,
        usedRequests: response.usedRequests
      };
      logDebug(debug);
      return debug;
    } catch (error) {
      if (error instanceof AllSportsApiError) {
        const debug = {
          configured: true,
          provider: "AllSportsApi" as const,
          statusCode: error.statusCode,
          message: error.message,
          remainingRequests: error.remainingRequests,
          usedRequests: error.usedRequests
        };
        logDebug(debug);
        return debug;
      }

      const debug = {
        configured: true,
        provider: "AllSportsApi" as const,
        statusCode: null,
        message: error instanceof Error ? error.message : "Error desconocido",
        remainingRequests: null,
        usedRequests: null
      };
      logDebug(debug);
      return debug;
    }
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new AllSportsApiError("AllSportsApi no configurada", null, null, null);
    }
  }

  private async request<T>(met: string, params: Record<string, string>): Promise<T> {
    const response = await this.rawRequest<T>(met, params);
    return (response.payload.result ?? ([] as T)) as T;
  }

  async debugFixture(matchId: string) {
    this.ensureConfigured();
    const before = getPerformanceMetricRecords().length;
    const eventId = matchId.replace("allsports-", "");
    this.invalidateMatchCache(matchId);
    const resolved = await this.getRawMatchWithTrace(eventId);
    const rawMatch = resolved.match;
    const reconciledMissing = rawMatch
      ? null
      : await reconcileMissingProviderFixture(matchId, "AllSportsApi no devolvio el fixture en Fixtures ni Livescore durante debug/refresh.");
    const mapped = rawMatch ? await this.mapDetail(rawMatch) : null;
    if (mapped) {
      await persistMatchDetail(mapped);
    }
    const { from, to } = recentWindow();
    const [homeRaw, awayRaw, h2hRaw] = rawMatch
      ? await Promise.all([
          rawMatch.home_team_key ? this.request<AllSportsMatch[]>("Fixtures", { teamId: rawMatch.home_team_key, from, to, timezone: "America/Bogota", withPlayerStats: "1" }).catch(() => []) : Promise.resolve([]),
          rawMatch.away_team_key ? this.request<AllSportsMatch[]>("Fixtures", { teamId: rawMatch.away_team_key, from, to, timezone: "America/Bogota", withPlayerStats: "1" }).catch(() => []) : Promise.resolve([]),
          rawMatch.home_team_key && rawMatch.away_team_key
            ? this.request<{ H2H?: AllSportsMatch[] }>("H2H", { firstTeamId: rawMatch.home_team_key, secondTeamId: rawMatch.away_team_key, timezone: "America/Bogota" }).catch(() => ({ H2H: [] }))
            : Promise.resolve({ H2H: [] })
        ])
      : [[], [], { H2H: [] }];
    const metrics = getPerformanceMetricRecords().slice(before);
    const lifecycle = await getFixtureLifecycleDebug(
      matchId,
      resolved.rawStatus,
      mapped?.status ?? null,
      resolved.source,
      resolved.reason
    );
    const cache = getPerformanceCacheAge(`allsports:Fixtures:matchId=${eventId}`);

    return {
      provider: "AllSportsApi",
      endpointConsulted: [
        `Fixtures?matchId=${eventId}&withPlayerStats=1`,
        `Livescore?matchId=${eventId}&withPlayerStats=1`,
        rawMatch?.home_team_key ? `Fixtures?teamId=${rawMatch.home_team_key}&from=${from}&to=${to}` : null,
        rawMatch?.away_team_key ? `Fixtures?teamId=${rawMatch.away_team_key}&from=${from}&to=${to}` : null,
        rawMatch?.home_team_key && rawMatch?.away_team_key ? `H2H?firstTeamId=${rawMatch.home_team_key}&secondTeamId=${rawMatch.away_team_key}` : null,
        rawMatch ? `Odds?matchId=${eventId}` : null,
        rawMatch && mapped?.status === "LIVE" ? `OddsLive?matchId=${eventId}` : null
      ].filter(Boolean),
      rawFields: rawMatch ? summarizeRawFixture(rawMatch, homeRaw.length, awayRaw.length, h2hRaw.H2H?.length ?? 0) : null,
      mappedFields: mapped ? summarizeMappedFixture(mapped) : reconciledMissing ? summarizeMappedFixture(reconciledMissing) : null,
      lifecycle: { ...lifecycle, cacheAge: cache },
      discardedFields: rawMatch ? Object.keys(rawMatch).filter((key) => !USED_RAW_FIELDS.has(key)) : [],
      unavailable: mapped ? unavailableMappedFields(mapped, homeRaw.length, awayRaw.length, h2hRaw.H2H?.length ?? 0) : reconciledMissing ? ["fixture no encontrado en proveedor; usando estado reconciliado local"] : ["fixture no encontrado"],
      requestsUsed: metrics.filter((item) => item.provider && item.cache === "miss").length
    };
  }

  private async rawRequest<T>(met: string, params: Record<string, string>) {
    const url = new URL(API_BASE_URL);
    url.searchParams.set("met", met);
    url.searchParams.set("APIkey", this.apiKey ?? "");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const key = `allsports:${met}:${[...Object.entries(params)].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")}`;
    const result = await cachedRequest(
      key,
      `allsports:${met.toLowerCase()}`,
      async () => {
        const response = await fetchJsonWithResilience<AllSportsEnvelope<T>>(url, {}, `allsports:${met.toLowerCase()}`, "AllSportsApi");
        if (met === "Fixtures" || met === "Livescore" || met === "OddsLive") rememberTrainingReceipt(response.payload.result);
        return response;
      },
      cacheTtlForAllSportsRequest(met, params),
      "AllSportsApi"
    );
    const response = result.response;
    const payload = result.payload;
    const message = extractMessage(payload);
    const statusCode = response.status;
    const remainingRequests = parseHeaderNumber(response.headers, "x-ratelimit-remaining");
    const usedRequests = parseHeaderNumber(response.headers, "x-ratelimit-used");

    if (!response.ok || payload.success === 0 || message) {
      throw new AllSportsApiError(message || `AllSportsApi error ${statusCode}`, statusCode, remainingRequests, usedRequests);
    }

    return { payload, statusCode, remainingRequests, usedRequests };
  }
}

function cacheTtlForAllSportsRequest(met: string, params: Record<string, string>) {
  if (met === "Livescore" || met === "OddsLive") return CACHE_TTL.live;
  if (met === "Odds") return CACHE_TTL.fixtures;
  if (met === "Fixtures" && (params.matchId || rangeTouchesToday(params.from, params.to))) return CACHE_TTL.live;
  return CACHE_TTL.fixtures;
}

function rangeTouchesToday(from?: string, to?: string) {
  if (!from && !to) return false;
  const today = formatDate(new Date());
  return (!from || from <= today) && (!to || to >= today);
}

export class AllSportsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly remainingRequests: number | null,
    readonly usedRequests: number | null
  ) {
    super(message);
    this.name = "AllSportsApiError";
  }
}

const USED_RAW_FIELDS = new Set([
  "event_key",
  "event_date",
  "event_time",
  "event_home_team",
  "home_team_key",
  "event_away_team",
  "away_team_key",
  "event_final_result",
  "event_ft_result",
  "event_status",
  "event_live",
  "league_name",
  "league_key",
  "country_name",
  "goalscorers",
  "cards",
  "substitutes",
  "lineups",
  "statistics",
  "player_statistics",
  "players_statistics"
]);

function summarizeRawFixture(match: AllSportsMatch, homeForm: number, awayForm: number, h2h: number) {
  const stat = (names: string[]) =>
    match.statistics?.find((item) => {
      const type = normalizeSearch(item.type ?? "");
      return names.some((name) => name === "attacks" ? type === "attacks" : type.includes(name));
    }) ?? null;
  return {
    score: match.event_final_result || match.event_ft_result || null,
    minute: match.event_status || null,
    status: match.event_status || null,
    possession: stat(["possession"]),
    shots: stat(["shots total", "total shots"]),
    shotsOffTarget: stat(["off target", "shots off target"]),
    shotsOnTarget: stat(["shots on goal", "shots on target", "on target"]),
    xg: stat(["expected goals", "xg"]),
    attacks: stat(["attacks"]),
    corners: stat(["corners", "corner kicks"]),
    cards: { yellowRedRows: match.cards?.length ?? 0, raw: match.cards ?? [] },
    dangerousAttacks: stat(["dangerous attacks"]),
    substitutions: match.substitutes?.length ?? 0,
    lineups: {
      home: match.lineups?.home_team?.starting_lineups?.length ?? 0,
      away: match.lineups?.away_team?.starting_lineups?.length ?? 0
    },
    playerStatistics: Array.isArray(match.player_statistics) ? match.player_statistics.length : match.player_statistics ? Object.values(match.player_statistics).flat().length : 0,
    h2h,
    form: { home: homeForm, away: awayForm }
  };
}

function summarizeMappedFixture(match: MatchDetail) {
  return {
    score: `${match.score.home}-${match.score.away}`,
    minute: match.minute,
    status: match.status,
    possession: match.stats,
    shots: { home: match.stats.home.shots, away: match.stats.away.shots },
    shotsOffTarget: { home: match.stats.home.shotsOffTarget ?? null, away: match.stats.away.shotsOffTarget ?? null },
    shotsOnTarget: { home: match.stats.home.shotsOnTarget, away: match.stats.away.shotsOnTarget },
    xg: { home: match.stats.home.xg, away: match.stats.away.xg },
    attacks: { home: match.stats.home.attacks ?? null, away: match.stats.away.attacks ?? null },
    corners: { home: match.stats.home.corners, away: match.stats.away.corners },
    cards: {
      home: (match.stats.home.yellowCards ?? 0) + (match.stats.home.redCards ?? 0),
      away: (match.stats.away.yellowCards ?? 0) + (match.stats.away.redCards ?? 0)
    },
    dangerousAttacks: { home: match.stats.home.dangerousAttacks ?? null, away: match.stats.away.dangerousAttacks ?? null },
    substitutions: match.substitutions.length,
    lineups: { home: match.lineups.home.length, away: match.lineups.away.length },
    playerStatistics: match.playerStats.length,
    odds: match.odds.length
  };
}

function unavailableMappedFields(match: MatchDetail, homeForm: number, awayForm: number, h2h: number) {
  const items: string[] = [];
  if (match.stats.home.possession === null && match.stats.away.possession === null) items.push("possession");
  if (match.stats.home.shots === null && match.stats.away.shots === null) items.push("shots");
  if (match.stats.home.shotsOnTarget === null && match.stats.away.shotsOnTarget === null) items.push("shotsOnTarget");
  if (match.stats.home.xg === null && match.stats.away.xg === null) items.push("xG");
  if (match.stats.home.corners === null && match.stats.away.corners === null) items.push("corners");
  if (match.stats.home.dangerousAttacks === null && match.stats.away.dangerousAttacks === null) items.push("dangerousAttacks");
  if (!match.lineups.home.length && !match.lineups.away.length) items.push("lineups");
  if (!match.playerStats.length) items.push("playerStatistics");
  if (!match.odds.length) items.push("odds");
  if (!h2h) items.push("H2H");
  if (!homeForm || !awayForm) items.push("teamForm");
  return items;
}

function mapMatchSummary(match: AllSportsMatch): MatchSummary {
  const [home, away] = parseScore(match.event_final_result || match.event_ft_result);

    return {
      id: `allsports-${match.event_key}`,
      source: "allsports",
      leagueExternalId: match.league_key ?? null,
      homeTeamExternalId: match.home_team_key ?? null,
      awayTeamExternalId: match.away_team_key ?? null,
      homeTeam: match.event_home_team || "N/D",
    awayTeam: match.event_away_team || "N/D",
    competition: match.league_name || "N/D",
    status: mapStatus(match),
    minute: parseMinute(match.event_status),
    score: { home, away },
    kickoffAt: match.event_date && match.event_time ? `${match.event_date}T${match.event_time}:00` : match.event_date
  };
}

function mapStatus(match: AllSportsMatch): MatchStatus {
  const status = normalizeStatusLabel(match.event_status);
  const result = `${match.event_final_result ?? ""} ${match.event_ft_result ?? ""}`.trim();
  const hasFinalScore = /\d+\s*-\s*\d+/.test(result);
  if (isTerminalRawStatus(match) || (hasFinalScore && !match.event_live && !status)) {
    return "FINISHED";
  }
  if (isStaleLiveRawMatch(match)) {
    return "FINISHED";
  }
  if (isLiveRawStatus(match)) {
    return "LIVE";
  }
  return "UPCOMING";
}

function normalizeStatusLabel(value?: string) {
  return (value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTerminalRawStatus(match: AllSportsMatch | null | undefined) {
  if (!match) return false;
  const status = normalizeStatusLabel(match.event_status);
  return [
    "ft",
    "finished",
    "full time",
    "fulltime",
    "aet",
    "after et",
    "after extra time",
    "pen",
    "after pen",
    "after penalties",
    "penalties",
    "cancelled",
    "canceled",
    "postponed",
    "abandoned",
    "ended",
    "walkover",
    "awarded"
  ].includes(status) ||
    status.includes("finish") ||
    status.includes("final") ||
    status.includes("after et") ||
    status.includes("after pen") ||
    status.includes("cancel") ||
    status.includes("postpon") ||
    status.includes("abandon") ||
    status.includes("award") ||
    status.includes("walkover");
}

function isLiveRawStatus(match: AllSportsMatch | null | undefined) {
  if (!match) return false;
  const status = normalizeStatusLabel(match.event_status);
  return match.event_live === "1" ||
    /^\d+/.test(status) ||
    status.includes("half") ||
    status === "ht" ||
    status.includes("stoppage") ||
    status.includes("injury");
}

function isStaleLiveRawMatch(match: AllSportsMatch | null | undefined) {
  if (!match || !isLiveRawStatus(match)) return false;
  const minute = parseMinute(match.event_status);
  if (minute === null || minute < 90 || !match.event_date || !match.event_time) return false;
  return minutesSinceKickoff(match.event_date, match.event_time) >= 195;
}

function informationalStats(statistics: AllSportsStatistic[], side: TeamSide) {
  const stats = strictStats(names => statistics.find(s => names.includes((s.type ?? "").trim().toLowerCase()))?.[side]);
  return { bigChances: stats.bigChances, shotsInsideBox: stats.shotsInsideBox };
}

export function mapStats(statistics: AllSportsStatistic[], cards: AllSportsCard[] = []): { home: TeamStats; away: TeamStats } {
  const value = (names: string | string[], side: TeamSide) => {
    const candidates = Array.isArray(names) ? names : [names];
    const stat = statistics.find((item) => {
      const type = normalize(item.type);
      return candidates.some((name) => name === "attacks" ? type === "attacks" : type.includes(name));
    });
    return parseStat(side === "home" ? stat?.home : stat?.away);
  };
  const homeYellow = cards.filter((card) => Boolean(card.home_fault) && normalize(card.card).includes("yellow")).length;
  const awayYellow = cards.filter((card) => Boolean(card.away_fault) && normalize(card.card).includes("yellow")).length;
  const homeRed = cards.filter((card) => Boolean(card.home_fault) && normalize(card.card).includes("red")).length;
  const awayRed = cards.filter((card) => Boolean(card.away_fault) && normalize(card.card).includes("red")).length;

  return {
    home: {
      ...informationalStats(statistics, "home"),
      possession: value(["possession", "ball possession"], "home"),
      shots: value(["shots total", "total shots", "shots", "goal attempts"], "home"),
      shotsOffTarget: value(["off target", "shots off target"], "home"),
      shotsOnTarget: value(["shots on goal", "shots on target", "on target"], "home"),
      xg: value(["expected goals", "xg"], "home"),
      corners: value(["corners", "corner kicks"], "home"),
      yellowCards: value("yellow", "home") ?? (homeYellow || null),
      redCards: value("red", "home") ?? (homeRed || null),
      fouls: value(["fouls", "fouls committed"], "home"),
      attacks: value(["attacks"], "home"),
      dangerousAttacks: value("dangerous attacks", "home")
    },
    away: {
      ...informationalStats(statistics, "away"),
      possession: value(["possession", "ball possession"], "away"),
      shots: value(["shots total", "total shots", "shots", "goal attempts"], "away"),
      shotsOffTarget: value(["off target", "shots off target"], "away"),
      shotsOnTarget: value(["shots on goal", "shots on target", "on target"], "away"),
      xg: value(["expected goals", "xg"], "away"),
      corners: value(["corners", "corner kicks"], "away"),
      yellowCards: value("yellow", "away") ?? (awayYellow || null),
      redCards: value("red", "away") ?? (awayRed || null),
      fouls: value(["fouls", "fouls committed"], "away"),
      attacks: value(["attacks"], "away"),
      dangerousAttacks: value("dangerous attacks", "away")
    }
  };
}

function mapLineup(team?: AllSportsLineupTeam): LineupPlayer[] {
  return (team?.starting_lineups ?? [])
    .filter((player) => Boolean(player.player))
    .map((player) => ({
      name: player.player || "N/D",
      number: parseStat(player.player_number) ?? 0,
      position: player.player_position || "N/D"
    }));
}

function mapGoals(goals: AllSportsGoal[]): MatchEvent[] {
  return goals.map((goal) => {
    const isHome = Boolean(goal.home_scorer);
    return {
      minute: parseStat(goal.time) ?? 0,
      type: "goal",
      team: isHome ? "home" : "away",
      title: "Gol",
      detail: `${isHome ? goal.home_scorer : goal.away_scorer || "N/D"} - ${goal.score || "N/D"}`
    };
  });
}

function mapCards(cards: AllSportsCard[]): MatchEvent[] {
  return cards.map((card) => {
    const isHome = Boolean(card.home_fault);
    return {
      minute: parseStat(card.time) ?? 0,
      type: "card",
      team: isHome ? "home" : "away",
      title: card.card || "Tarjeta",
      detail: isHome ? card.home_fault || "N/D" : card.away_fault || "N/D"
    };
  });
}

function mapSubstitutions(substitutions: AllSportsSubstitution[]): MatchEvent[] {
  return substitutions.flatMap((substitution) => {
    const events: MatchEvent[] = [];
    const minute = parseStat(substitution.time) ?? 0;
    const home = normalizeSubstitution(substitution.home_scorer);
    const away = normalizeSubstitution(substitution.away_scorer);

    if (home) {
      events.push({
        minute,
        type: "substitution",
        team: "home",
        title: "Sustitucion",
        detail: `Entra ${home.in || "N/D"} - Sale ${home.out || "N/D"}`
      });
    }

    if (away) {
      events.push({
        minute,
        type: "substitution",
        team: "away",
        title: "Sustitucion",
        detail: `Entra ${away.in || "N/D"} - Sale ${away.out || "N/D"}`
      });
    }

    return events;
  });
}

function mapPlayerStats(match: AllSportsMatch): PlayerStat[] {
  const raw = match.player_statistics ?? match.players_statistics ?? [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw).flat();

  return rows.map((player) => ({
    player: player.player_name || player.player || "N/D",
    team: player.team_name === match.event_away_team ? "away" : "home",
    position: player.player_position || player.player_type || "N/D",
    minutes: parseStat(player.player_minutes),
    goals: parseStat(player.player_goals),
    assists: parseStat(player.player_assists),
    shots: parseStat(player.player_shots_total),
    shotsOnTarget: parseStat(player.player_shots_on_goal),
    xg: parseStat(player.player_expected_goals),
    xa: parseStat(player.player_expected_assists),
    keyPasses: parseStat(player.player_key_passes),
    foulsCommitted: parseStat(player.player_fouls_committed),
    foulsReceived: parseStat(player.player_fouls_received),
    yellowCards: parseStat(player.player_yellow_cards),
    redCards: parseStat(player.player_red_cards)
  }));
}

function mapOdds(result: AllSportsOddsResult, minute: number | null): OddsQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows.flatMap((row) => {
      const bookmaker = String(row.odd_bookmakers || "AllSportsApi");
      return Object.entries(row)
        .filter(([key, value]) => isOddPriceField(key) && key !== "odd_bookmakers" && value !== null && value !== undefined && value !== "")
        .map(([key, value]) => {
          const normalized = normalizeOddKey(key);
          return {
            bookmaker,
            market: normalized.market,
            selection: normalized.selection,
            price: Number(value),
            quotedAt: new Date().toISOString(),
            minute
          };
        })
        .filter((quote) => Number.isFinite(quote.price));
    })
  );
}

function mapLiveOdds(result: AllSportsLiveOddsResult, minute: number | null): OddsQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows
      .filter((row) => normalize(row.is_odd_suspended) !== "yes")
      .map((row) => {
        const normalized = normalizeLiveOdd(row);
        return {
          bookmaker: "AllSportsApi Live",
          market: normalized.market,
          selection: normalized.selection,
          price: Number(row.odd_value),
          quotedAt: parseAllSportsDate(row.odd_last_updated)?.toISOString() ?? new Date().toISOString(),
          minute
        };
      })
      .filter((quote) => Number.isFinite(quote.price) && quote.price > 0)
  );
}

function isOddPriceField(key: string) {
  const nonPriceFields = ["odd_name", "odd_bookmakers", "odd_value", "odd_handicap", "odd_participant_handicap", "odd_suspend"];
  return key.startsWith("odd_") && !nonPriceFields.includes(key);
}

function parseScore(score?: string): [number, number] {
  const parts = (score || "0 - 0").split("-").map((part) => Number(part.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
}

function parseMinute(status?: string) {
  const normalized = normalizeStatusLabel(status);
  if (normalized === "ht" || normalized.includes("half time")) return 45;
  const parsed = Number(String(status ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStat(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value?: string | number | null) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSubstitution(value: AllSportsSubstitution["home_scorer"]) {
  return Array.isArray(value) ? null : value;
}

function normalizeOddKey(key: string, liveMarket?: string) {
  const raw = key.replace(/^odd_/, "");
  const normalizedRaw = raw.replace(/_/g, ".").toLowerCase();
  const isFirstHalf = /(1st.?half|first.?half|1h|1t|ht)/i.test(raw) || (liveMarket ? /(1st half|first half|1h|1t)/i.test(liveMarket) : false);

  if (["1", "x", "2"].includes(normalizedRaw)) {
    return { market: "Resultado", selection: normalizedRaw.toUpperCase() };
  }

  if (["1x", "12", "x2"].includes(normalizedRaw)) {
    return { market: "Doble oportunidad", selection: normalizedRaw.toUpperCase() };
  }

  const total = normalizedRaw.match(/^([ou])\+?(\d+(?:\.\d+)?)$/);
  if (total) {
    return {
      market: isFirstHalf ? "Total goles 1T" : liveMarket && !/live odds/i.test(liveMarket) ? liveMarket : "Total goles",
      selection: `${total[1] === "o" ? "Over" : "Under"} ${total[2]}${isFirstHalf ? " 1T" : ""}`
    };
  }

  if (normalizedRaw.includes("bts")) {
    const positive = /yes|si|1|y/.test(normalizedRaw);
    const negative = /no|0|n/.test(normalizedRaw);
    return { market: "Ambos marcan", selection: positive ? "Si" : negative ? "No" : raw.replaceAll("_", " ") };
  }

  return { market: liveMarket ?? normalizeOddMarket(key), selection: raw.replaceAll("_", " ") };
}

function normalizeLiveOdd(row: AllSportsLiveOddsRow) {
  const rawMarket = String(row.odd_name || "Live odds").trim();
  const rawType = String(row.odd_type || "").trim();
  const line = parseStat(row.odd_participant_handicap);
  const marketText = normalize(rawMarket);
  const selectionLine = line !== null ? ` ${line}` : "";

  if (/(1st half|first half|1h|1t)/i.test(rawMarket) && /(match goals|over\/under line|over\/under|goals)/i.test(rawMarket)) {
    return {
      market: "Total goles 1T",
      selection: /under/i.test(rawType) ? `Under${selectionLine} 1T` : /over/i.test(rawType) ? `Over${selectionLine} 1T` : `${rawType || "N/D"} 1T`
    };
  }

  if (!/1st half/i.test(rawMarket) && /(match goals|over\/under line|over\/under)/i.test(rawMarket)) {
    return {
      market: "Total goles",
      selection: /under/i.test(rawType) ? `Under${selectionLine}` : /over/i.test(rawType) ? `Over${selectionLine}` : rawType || "N/D"
    };
  }

  if (/match corners|total corners|corners/i.test(rawMarket)) {
    return {
      market: "Corners",
      selection: /under/i.test(rawType) ? `Under${selectionLine}` : /over/i.test(rawType) ? `Over${selectionLine}` : rawType || "N/D"
    };
  }

  if (/team goals|team score|how many goals/i.test(rawMarket)) {
    return {
      market: rawMarket,
      selection: /under|over/i.test(rawType) && line !== null ? `${rawType} ${line}` : rawType || "N/D"
    };
  }

  if (/1x2/i.test(rawMarket)) {
    return {
      market: rawMarket,
      selection: rawType === "Home" ? "1" : rawType === "Draw" ? "X" : rawType === "Away" ? "2" : rawType || "N/D"
    };
  }

  return {
    market: rawMarket || (marketText || "Live odds"),
    selection: line !== null && /over|under/i.test(rawType) ? `${rawType} ${line}` : rawType || "N/D"
  };
}

function normalizeOddMarket(key: string) {
  if (["odd_1", "odd_x", "odd_2"].includes(key)) {
    return "Resultado";
  }
  if (["odd_1x", "odd_12", "odd_x2"].includes(key)) {
    return "Doble oportunidad";
  }
  if (key.includes("o+") || key.includes("u+")) {
    return "Total goles";
  }
  if (key.includes("bts")) {
    return "Ambos marcan";
  }
  return "Cuotas";
}

function debugOdds(result: AllSportsOddsResult): AllSportsMarketDebugQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows.flatMap((row) => {
      const bookmaker = String(row.odd_bookmakers || "AllSportsApi");
      return Object.entries(row)
        .filter(([key, value]) => isOddPriceField(key) && value !== null && value !== undefined && value !== "")
        .map(([key, value]) => {
          const normalized = normalizeOddKey(key);
          const selection = key.replace(/^odd_/, "").replaceAll("_", " ");
          return {
            bookmaker,
            rawField: key,
            rawMarket: normalizeOddMarket(key),
            rawSelection: selection,
            line: normalized.market === "Total goles" ? extractOddLine(normalized.selection) : null,
            selection: normalized.selection,
            price: Number(value),
            normalizedMarket: normalized.market
          };
        })
        .filter((quote) => Number.isFinite(quote.price));
    })
  );
}

function debugLiveOdds(result: AllSportsLiveOddsResult): AllSportsMarketDebugQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows
      .filter((row) => row.odd_value !== null && row.odd_value !== undefined && row.odd_value !== "" && normalize(row.is_odd_suspended) !== "yes")
      .map((row) => {
        const normalized = normalizeLiveOdd(row);
        return {
          bookmaker: "AllSportsApi Live",
          rawField: "odd_value",
          rawMarket: String(row.odd_name || "Live odds"),
          rawSelection: String(row.odd_type || "N/D"),
          line: extractOddLine(normalized.selection),
          selection: normalized.selection,
          price: Number(row.odd_value),
          normalizedMarket: normalized.market
        };
      })
      .filter((quote) => Number.isFinite(quote.price))
  );
}

function parseAllSportsDate(value: string | number | null | undefined) {
  if (!value) return null;
  const text = String(value).trim();
  const parsed = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractOddLine(value: string) {
  const match = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function dedupeMatches(matches: AllSportsMatch[]) {
  return [...new Map(matches.map((match) => [match.event_key, match])).values()];
}

function orderMatchesForDashboard(matches: MatchSummary[]) {
  return [...new Map(matches.map((match) => [match.id, match])).values()]
    .sort((a, b) => {
      const groupDiff = dashboardGroupRank(a) - dashboardGroupRank(b);
      if (groupDiff !== 0) return groupDiff;
      if (a.status === "LIVE" && b.status === "LIVE") return (b.minute ?? 0) - (a.minute ?? 0);
      const kickoffA = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
      const kickoffB = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (a.status === "FINISHED" && b.status === "FINISHED") return kickoffB - kickoffA;
      return kickoffA - kickoffB;
    });
}

function dashboardGroupRank(match: MatchSummary) {
  const priority = isPriorityLeague(match.competition);
  if (match.status === "LIVE" && priority) return 1;
  if (match.status === "LIVE") return 2;
  if (match.status === "UPCOMING" && priority) return 3;
  if (match.status === "UPCOMING") return 4;
  return 5;
}

function reconcileMatches(fixtures: AllSportsMatch[], livescore: AllSportsMatch[]) {
  const byId = new Map<string, { fixture: AllSportsMatch | null; live: AllSportsMatch | null }>();
  for (const fixture of fixtures) {
    byId.set(fixture.event_key, { fixture, live: byId.get(fixture.event_key)?.live ?? null });
  }
  for (const live of livescore) {
    byId.set(live.event_key, { fixture: byId.get(live.event_key)?.fixture ?? null, live });
  }
  return [...byId.values()]
    .map(({ fixture, live }) => reconcileFixtureRaw(fixture, live).match)
    .filter((match): match is AllSportsMatch => Boolean(match));
}

function reconcileFixtureRaw(fixture: AllSportsMatch | null, live: AllSportsMatch | null): ReconciledRawMatch {
  if (isTerminalRawStatus(fixture)) {
    return {
      match: fixture,
      source: "Fixtures",
      rawStatus: fixture?.event_status ?? null,
      reason: "Fixtures reporta estado terminal; domina sobre Livescore."
    };
  }
  if (isTerminalRawStatus(live)) {
    return {
      match: live,
      source: "Livescore",
      rawStatus: live?.event_status ?? null,
      reason: "Livescore reporta estado terminal."
    };
  }
  if (isStaleLiveRawMatch(fixture)) {
    return {
      match: fixture,
      source: "Fixtures",
      rawStatus: fixture?.event_status ?? null,
      reason: "Fixtures conserva 90+ LIVE despues de la ventana razonable; se trata como stale finalizado."
    };
  }
  if (isStaleLiveRawMatch(live)) {
    return {
      match: live,
      source: "Livescore",
      rawStatus: live?.event_status ?? null,
      reason: "Livescore conserva 90+ LIVE despues de la ventana razonable; se trata como stale finalizado."
    };
  }
  if (live && isLiveRawStatus(live)) {
    return {
      match: live,
      source: "Livescore",
      rawStatus: live.event_status ?? null,
      reason: "Livescore reporta partido en vivo."
    };
  }
  if (fixture) {
    return {
      match: fixture,
      source: "Fixtures",
      rawStatus: fixture.event_status ?? null,
      reason: live ? "Fixtures tiene el estado no terminal mas reciente utilizable." : "No aparece en Livescore; se reconcilia con Fixtures."
    };
  }
  if (live) {
    return {
      match: live,
      source: "Livescore",
      rawStatus: live.event_status ?? null,
      reason: "Solo Livescore devolvio el fixture."
    };
  }
  return { match: null, source: "none", rawStatus: null, reason: "Fixture no encontrado en Fixtures ni Livescore." };
}

function isPriorityLeague(name: string) {
  const normalized = normalize(name);
  return PRIORITY_LEAGUE_TERMS.some((term) => normalized.includes(term));
}

function filterMatches(matches: MatchSummary[], query: string) {
  const terms = searchTerms(query);
  if (!terms.length) return matches;

  return matches
    .map((match) => ({ match, score: matchSearchScore(match, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(new Date(a.match.kickoffAt ?? 0).getTime() - Date.now()) - Math.abs(new Date(b.match.kickoffAt ?? 0).getTime() - Date.now());
    })
    .map((item) => item.match);
}

function matchSearchScore(match: MatchSummary, terms: string[]) {
  const home = normalizeSearch(match.homeTeam);
  const away = normalizeSearch(match.awayTeam);
  const competition = normalizeSearch(match.competition);
  const haystack = `${home} ${away} ${competition}`;
  const homeHits = terms.filter((term) => home.includes(term)).length;
  const awayHits = terms.filter((term) => away.includes(term)).length;
  const totalHits = terms.filter((term) => haystack.includes(term)).length;

  if (terms.length >= 2 && homeHits > 0 && awayHits > 0) return 100 + totalHits;
  if (homeHits || awayHits) return 50 + totalHits;
  if (totalHits === terms.length) return 20 + totalHits;
  return 0;
}

function searchTerms(query: string) {
  return normalizeSearch(query)
    .replace(/\b(vs|v|versus)\b/g, " ")
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !["fc", "cf", "sc", "club", "de", "the"].includes(term));
}

function normalizeSearch(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bcrew sc\b/g, "crew")
    .replace(/\bnashville soccer club\b/g, "nashville")
    .replace(/\s+/g, " ")
    .trim();
}

function singleDayRange(date: string) {
  return { from: date, to: date };
}

function centeredRange(date: string, days: number) {
  const center = parseDate(date);
  const from = new Date(center);
  from.setDate(center.getDate() - days);
  const to = new Date(center);
  to.setDate(center.getDate() + days);
  return { from: formatDate(from), to: formatDate(to) };
}

function parseDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function minutesSinceKickoff(date: string, time: string) {
  const kickoff = new Date(`${date}T${time}:00`);
  if (Number.isNaN(kickoff.getTime())) return 0;
  return (Date.now() - kickoff.getTime()) / 60_000;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function recentWindow() {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - 150);

  return {
    from: formatDate(fromDate),
    to: formatDate(toDate)
  };
}

function extractMessage(payload: AllSportsEnvelope<unknown>) {
  if (Array.isArray(payload.result)) {
    const resultMessages = payload.result
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const row = item as { msg?: unknown; cod?: unknown };
        return row.msg ? `${String(row.msg)}${row.cod ? ` (cod: ${String(row.cod)})` : ""}` : "";
      })
      .filter(Boolean);

    if (resultMessages.length) {
      return resultMessages.join(" | ");
    }
  }

  if (payload.message) {
    return payload.message;
  }
  const error = payload.error ?? payload.errors;
  if (!error) {
    return "";
  }
  if (Array.isArray(error)) {
    return error.filter(Boolean).join(" | ");
  }
  if (typeof error === "object") {
    return Object.values(error).flat().filter(Boolean).map(String).join(" | ");
  }
  return String(error);
}

function parseHeaderNumber(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function logDebug(debug: FootballDebugStatus) {
  console.info("[AllSportsApi debug]", {
    httpStatus: debug.statusCode,
    message: debug.message,
    remainingRequests: debug.remainingRequests,
    usedRequests: debug.usedRequests ?? null
  });
}
