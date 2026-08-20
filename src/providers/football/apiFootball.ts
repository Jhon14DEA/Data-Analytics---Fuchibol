import type {
  LineupPlayer,
  MatchDetail,
  MatchEvent,
  MatchStatus,
  MatchSummary,
  OddsQuote,
  PlayerStat,
  TeamSide,
  TeamStats,
  FootballDebugStatus
} from "@/types/domain";
import type { FootballProvider } from "./types";
import { cachedRequest, CACHE_TTL, fetchJsonWithResilience } from "@/lib/performance";

const API_BASE_URL = "https://v3.football.api-sports.io";
const PRIORITY_LEAGUES = [2, 3, 848, 39, 140, 135, 78, 61, 13, 11, 242];

type ApiEnvelope<T> = {
  response?: T;
  errors?: unknown;
  message?: string;
};

type ApiFixture = {
  fixture: {
    id: number;
    date?: string;
    timestamp?: number;
    status: {
      long?: string;
      short?: string;
      elapsed?: number | null;
    };
  };
  league: {
    id: number;
    name: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
};

type ApiStatistic = {
  team: { id: number };
  statistics: { type: string; value: number | string | null }[];
};

type ApiEvent = {
  time: { elapsed: number | null };
  team: { id: number; name: string };
  player?: { name?: string };
  assist?: { name?: string };
  type: string;
  detail: string;
  comments?: string | null;
};

type ApiLineup = {
  team: { id: number };
  startXI?: { player: { name: string; number: number; pos: string } }[];
  substitutes?: { player: { name: string; number: number; pos: string } }[];
};

type ApiPlayers = {
  team: { id: number };
  players?: {
    player: { name: string };
    statistics: {
      games?: { position?: string };
      shots?: { total?: number | null; on?: number | null };
      expected_goals?: string | number | null;
      passes?: { key?: number | null };
      fouls?: { committed?: number | null };
    }[];
  }[];
};

type ApiOdds = {
  update?: string;
  bookmakers?: {
    name: string;
    bets?: {
      name: string;
      values?: { value: string; odd?: string }[];
    }[];
  }[];
};

type ApiLiveOdds = {
  fixture?: { id: number };
  update?: string;
  bookmakers?: ApiOdds["bookmakers"];
};

export class ApiFootballProvider implements FootballProvider {
  readonly status: string;
  private readonly apiKey: string | undefined;
  private readonly season: number;

  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY?.trim() || undefined;
    this.status = this.apiKey ? "API-Football configurada" : "API-Football no configurada";
    this.season = Number(process.env.API_FOOTBALL_SEASON) || new Date().getFullYear();
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async listMatches(): Promise<MatchSummary[]> {
    this.ensureConfigured();

    return cachedRequest(
      `api-football:list:${formatDate(new Date())}`,
      "fixtures+livescore",
      async () => {
        const date = formatDate(new Date());
        const [daily, live] = await Promise.all([
          this.request<ApiFixture[]>("/fixtures", { date, timezone: "America/Bogota" }),
          this.request<ApiFixture[]>("/fixtures", { live: PRIORITY_LEAGUES.join("-"), timezone: "America/Bogota" })
        ]);

        return dedupeFixtures([...(daily ?? []), ...(live ?? [])])
          .filter((fixture) => PRIORITY_LEAGUES.includes(fixture.league.id))
          .map(mapFixtureSummary);
      },
      CACHE_TTL.fixtures,
      "API-Football"
    );
  }

  async getMatch(matchId: string): Promise<MatchDetail | null> {
    this.ensureConfigured();

    const fixtureId = Number(matchId.replace("api-football-", ""));
    if (!Number.isFinite(fixtureId)) {
      return null;
    }

    const fixtures = await this.request<ApiFixture[]>("/fixtures", { id: String(fixtureId), timezone: "America/Bogota" });
    const fixture = fixtures?.[0];
    if (!fixture) {
      return null;
    }

    const [statistics, events, lineups, players, odds, liveOdds] = await Promise.all([
      this.request<ApiStatistic[]>("/fixtures/statistics", { fixture: String(fixtureId) }).catch(() => []),
      this.request<ApiEvent[]>("/fixtures/events", { fixture: String(fixtureId) }).catch(() => []),
      this.request<ApiLineup[]>("/fixtures/lineups", { fixture: String(fixtureId) }).catch(() => []),
      this.request<ApiPlayers[]>("/fixtures/players", { fixture: String(fixtureId) }).catch(() => []),
      this.request<ApiOdds[]>("/odds", { fixture: String(fixtureId), season: String(this.season) }).catch(() => []),
      this.request<ApiLiveOdds[]>("/odds/live", { fixture: String(fixtureId) }).catch(() => [])
    ]);

    const currentOdds = [...mapOdds(odds ?? [], null), ...mapLiveOdds(liveOdds ?? [], fixture.fixture.status.elapsed ?? null)];
    const summary = mapFixtureSummary(fixture);
    const homeStats = mapTeamStats(statistics ?? [], fixture.teams.home.id);
    const awayStats = mapTeamStats(statistics ?? [], fixture.teams.away.id);

    return {
      ...summary,
      demo: false,
      providerStatus: this.status,
      stats: { home: homeStats, away: awayStats },
      lineups: {
        home: mapLineup(lineups ?? [], fixture.teams.home.id),
        away: mapLineup(lineups ?? [], fixture.teams.away.id)
      },
      substitutions: mapEvents(events ?? [], fixture, "subst"),
      events: mapEvents(events ?? [], fixture),
      playerStats: mapPlayerStats(players ?? [], fixture),
      odds: currentOdds,
      oddsHistory: currentOdds,
      analysis: [],
      alerts: []
    };
  }

  async getPreviousSnapshot(_matchId: string) {
    return null;
  }

  async getCurrentOdds(matchId: string): Promise<OddsQuote[]> {
    const match = await this.getMatch(matchId);
    return match?.odds ?? [];
  }

  async getOddsHistory(matchId: string): Promise<OddsQuote[]> {
    const match = await this.getMatch(matchId);
    return match?.oddsHistory ?? [];
  }

  async debugStatus(): Promise<FootballDebugStatus> {
    if (!this.apiKey) {
      const debug = {
        configured: false,
        provider: "API-Football" as const,
        statusCode: null,
        message: "API-Football no configurada",
        remainingRequests: null,
        usedRequests: null
      };
      logDebug(debug);
      return debug;
    }

    try {
      const result = await this.rawRequest<unknown>("/status", {});
      const message = extractMessage(result.payload) || "API-Football conectada";
      const debug = {
        configured: true,
        provider: "API-Football" as const,
        statusCode: result.statusCode,
        message,
        remainingRequests: result.remainingRequests,
        usedRequests: result.usedRequests
      };
      logDebug(debug);
      return debug;
    } catch (error) {
      if (error instanceof ApiFootballError) {
        const debug = {
          configured: true,
          provider: "API-Football" as const,
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
        provider: "API-Football" as const,
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
      throw new Error("API-Football no configurada");
    }
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const result = await this.rawRequest<T>(path, params);
    return (result.payload.response ?? ([] as T)) as T;
  }

  private async rawRequest<T>(path: string, params: Record<string, string>) {
    const url = new URL(`${API_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const key = `api-football:${path}:${[...Object.entries(params)].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")}`;
    const result = await cachedRequest(
      key,
      `api-football:${path}`,
      () => fetchJsonWithResilience<ApiEnvelope<T>>(url, { headers: { "x-apisports-key": this.apiKey ?? "" } }, `api-football:${path}`, "API-Football"),
      path.includes("odds") ? CACHE_TTL.live : path.includes("statistics") || path.includes("events") ? CACHE_TTL.stats : CACHE_TTL.fixtures,
      "API-Football"
    );
    const response = result.response;
    const statusCode = response.status;
    const remainingRequests = parseHeaderNumber(response.headers, "x-ratelimit-requests-remaining");
    const usedRequests = parseHeaderNumber(response.headers, "x-ratelimit-requests-used");
    const payload = result.payload;
    const apiMessage = extractMessage(payload);

    if (!response.ok) {
      throw new ApiFootballError(apiMessage || `API-Football error ${response.status}`, statusCode, remainingRequests, usedRequests);
    }

    if (apiMessage) {
      throw new ApiFootballError(apiMessage, statusCode, remainingRequests, usedRequests);
    }

    return { payload, statusCode, remainingRequests, usedRequests };
  }
}

export class ApiFootballError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly remainingRequests: number | null,
    readonly usedRequests: number | null
  ) {
    super(message);
    this.name = "ApiFootballError";
  }
}

function mapFixtureSummary(item: ApiFixture): MatchSummary {
  return {
    id: `api-football-${item.fixture.id}`,
    source: "api-football",
    homeTeam: item.teams.home.name,
    awayTeam: item.teams.away.name,
    competition: item.league.name,
    status: mapStatus(item.fixture.status.short),
    minute: item.fixture.status.elapsed ?? null,
    score: {
      home: item.goals.home ?? 0,
      away: item.goals.away ?? 0
    },
    kickoffAt: item.fixture.date
  };
}

function mapStatus(short?: string): MatchStatus {
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(short ?? "")) {
    return "LIVE";
  }
  if (["FT", "AET", "PEN"].includes(short ?? "")) {
    return "FINISHED";
  }
  return "UPCOMING";
}

function mapTeamStats(stats: ApiStatistic[], teamId: number): TeamStats {
  const row = stats.find((item) => item.team.id === teamId);
  const values = new Map(row?.statistics.map((item) => [normalize(item.type), item.value]) ?? []);

  return {
    possession: parseStat(values.get("ball possession")),
    shots: parseStat(values.get("total shots")),
    shotsOnTarget: parseStat(values.get("shots on goal")),
    xg: parseStat(values.get("expected goals")),
    corners: parseStat(values.get("corner kicks")),
    yellowCards: parseStat(values.get("yellow cards")),
    redCards: parseStat(values.get("red cards")),
    fouls: parseStat(values.get("fouls")),
    dangerousAttacks: parseStat(values.get("dangerous attacks"))
  };
}

function mapLineup(lineups: ApiLineup[], teamId: number): LineupPlayer[] {
  const lineup = lineups.find((item) => item.team.id === teamId);
  return (lineup?.startXI ?? []).map(({ player }) => ({
    name: player.name,
    number: player.number,
    position: player.pos
  }));
}

function mapEvents(events: ApiEvent[], fixture: ApiFixture, only?: "subst"): MatchEvent[] {
  return events
    .filter((event) => (only === "subst" ? event.type.toLowerCase() === "subst" : true))
    .map((event) => ({
      minute: event.time.elapsed ?? 0,
      type: mapEventType(event.type, event.detail),
      team: event.team.id === fixture.teams.home.id ? "home" : "away",
      title: event.detail || event.type,
      detail: [event.player?.name, event.assist?.name ? `Asist: ${event.assist.name}` : null, event.comments].filter(Boolean).join(" - ") || "N/D"
    }));
}

function mapEventType(type: string, detail: string): MatchEvent["type"] {
  const raw = `${type} ${detail}`.toLowerCase();
  if (raw.includes("goal")) return "goal";
  if (raw.includes("card")) return "card";
  if (raw.includes("subst")) return "substitution";
  if (raw.includes("var")) return "var";
  if (raw.includes("penalty")) return "penalty";
  return "note";
}

function mapPlayerStats(players: ApiPlayers[], fixture: ApiFixture): PlayerStat[] {
  return players.flatMap((team) =>
    (team.players ?? []).map(({ player, statistics }) => {
      const stat = statistics[0] ?? {};
      return {
        player: player.name,
        team: (team.team.id === fixture.teams.home.id ? "home" : "away") as TeamSide,
        position: stat.games?.position ?? "N/D",
        shots: stat.shots?.total ?? null,
        shotsOnTarget: stat.shots?.on ?? null,
        xg: parseStat(stat.expected_goals),
        keyPasses: stat.passes?.key ?? null,
        foulsCommitted: stat.fouls?.committed ?? null
      };
    })
  );
}

function mapOdds(odds: ApiOdds[], minute: number | null): OddsQuote[] {
  return odds.flatMap((item) =>
    (item.bookmakers ?? []).flatMap((bookmaker) =>
      (bookmaker.bets ?? []).flatMap((bet) =>
        (bet.values ?? []).map((value) => ({
          bookmaker: bookmaker.name,
          market: bet.name,
          selection: value.value,
          price: Number(value.odd),
          quotedAt: item.update ?? new Date().toISOString(),
          minute
        }))
      )
    )
  ).filter((quote) => Number.isFinite(quote.price));
}

function mapLiveOdds(odds: ApiLiveOdds[], minute: number | null): OddsQuote[] {
  return mapOdds(odds, minute);
}

function parseStat(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function dedupeFixtures(fixtures: ApiFixture[]) {
  return [...new Map(fixtures.map((fixture) => [fixture.fixture.id, fixture])).values()];
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function extractMessage(payload: ApiEnvelope<unknown>) {
  if (payload.message) {
    return payload.message;
  }

  if (!payload.errors) {
    return "";
  }

  if (Array.isArray(payload.errors) && payload.errors.length === 0) {
    return "";
  }

  if (typeof payload.errors === "string") {
    return payload.errors;
  }

  if (typeof payload.errors === "object") {
    const values = Object.values(payload.errors as Record<string, unknown>)
      .flat()
      .filter(Boolean)
      .map(String);
    return values.join(" | ");
  }

  return String(payload.errors);
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
  console.info("[API-Football debug]", {
    httpStatus: debug.statusCode,
    message: debug.message,
    remainingRequests: debug.remainingRequests,
    usedRequests: debug.usedRequests ?? null
  });
}
