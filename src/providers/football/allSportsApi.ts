import type {
  FootballDebugStatus,
  LineupPlayer,
  MatchAnalysisContext,
  MatchDetail,
  MatchEvent,
  MatchStatus,
  MatchSummary,
  OddsQuote,
  PlayerStat,
  TeamSide,
  TeamStats
} from "@/types/domain";
import type { FootballProvider } from "./types";
import { cachedRequest, CACHE_TTL, fetchJsonWithResilience } from "@/lib/performance";

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
};

type AllSportsOddsResult = Record<string, AllSportsOddsRow[]>;
type AllSportsOddsRow = Record<string, string | number | null | undefined> & {
  match_id?: string;
  odd_bookmakers?: string;
};

type AllSportsLiveOddsResult = Record<string, AllSportsLiveOddsRow[]>;
type AllSportsLiveOddsRow = Record<string, string | number | null | undefined> & {
  odd_name?: string;
  is_odd_suspended?: string;
};

export class AllSportsApiProvider implements FootballProvider {
  readonly status: string;
  private readonly apiKey: string | undefined;

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

        const matches = dedupeMatches([...(fixtures ?? []), ...(livescore ?? [])]).map(mapMatchSummary);
        const priority = matches.filter((match) => isPriorityLeague(match.competition));
        return priority.length ? priority : matches;
      },
      CACHE_TTL.fixtures,
      "AllSportsApi"
    );
  }

  async searchMatches(query: string): Promise<MatchSummary[]> {
    const normalized = normalize(query).replace(/\s+vs\s+|\s+v\s+/g, " ");
    const terms = normalized.split(/\s+/).filter(Boolean);

    const matches = await this.listMatches();

    if (!terms.length) {
      return matches;
    }

    return matches.filter((match) => {
      const haystack = normalize(`${match.homeTeam} ${match.awayTeam} ${match.competition}`);
      return terms.every((term) => haystack.includes(term));
    });
  }

  async getAnalysisContext(matchId: string): Promise<MatchAnalysisContext | null> {
    this.ensureConfigured();

    const eventId = matchId.replace("allsports-", "");
    const rawMatch = await this.getRawMatch(eventId);
    if (!rawMatch) {
      return null;
    }

    const match = await this.mapDetail(rawMatch);
    const { from, to } = recentWindow();

    const [homeRaw, awayRaw, h2hRaw] = await Promise.all([
      rawMatch.home_team_key
        ? this.request<AllSportsMatch[]>("Fixtures", { teamId: rawMatch.home_team_key, from, to, timezone: "America/Bogota", withPlayerStats: "1" }).catch(() => [])
        : Promise.resolve([]),
      rawMatch.away_team_key
        ? this.request<AllSportsMatch[]>("Fixtures", { teamId: rawMatch.away_team_key, from, to, timezone: "America/Bogota", withPlayerStats: "1" }).catch(() => [])
        : Promise.resolve([]),
      rawMatch.home_team_key && rawMatch.away_team_key
        ? this.request<{ H2H?: AllSportsMatch[] }>("H2H", {
            firstTeamId: rawMatch.home_team_key,
            secondTeamId: rawMatch.away_team_key,
            timezone: "America/Bogota"
          }).catch(() => ({ H2H: [] }))
        : Promise.resolve({ H2H: [] })
    ]);

    return {
      match,
      recentHome: homeRaw.filter((item) => item.event_key !== rawMatch.event_key).slice(-10).map((item) => this.mapDetailFromRaw(item)),
      recentAway: awayRaw.filter((item) => item.event_key !== rawMatch.event_key).slice(-10).map((item) => this.mapDetailFromRaw(item)),
      h2h: (h2hRaw.H2H ?? []).slice(0, 10).map((item) => this.mapDetailFromRaw(item)),
      provider: "AllSportsApi",
      generatedAt: new Date().toISOString()
    };
  }

  async getMatch(matchId: string): Promise<MatchDetail | null> {
    this.ensureConfigured();

    const eventId = matchId.replace("allsports-", "");
    if (!eventId || eventId === matchId) {
      return null;
    }

    const match = await this.getRawMatch(eventId);
    if (!match) {
      return null;
    }

    return this.mapDetail(match);
  }

  async mapDetail(match: AllSportsMatch): Promise<MatchDetail> {
    const eventId = match.event_key;
    const minute = parseMinute(match.event_status);
    const [odds, liveOdds] = await Promise.all([
      this.request<AllSportsOddsResult>("Odds", { matchId: eventId }).catch(() => ({})),
      this.request<AllSportsLiveOddsResult>("OddsLive", { matchId: eventId, timezone: "America/Bogota" }).catch(() => ({}))
    ]);

    const currentOdds = [...mapOdds(odds, null), ...mapLiveOdds(liveOdds, minute)];

    return {
      ...mapMatchSummary(match),
      demo: false,
      providerStatus: this.status,
      stats: mapStats(match.statistics ?? []),
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
    return {
      ...mapMatchSummary(match),
      demo: false,
      providerStatus: this.status,
      stats: mapStats(match.statistics ?? []),
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

    return liveMatches?.[0] ?? fixtures?.[0] ?? null;
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

  private async rawRequest<T>(met: string, params: Record<string, string>) {
    const url = new URL(API_BASE_URL);
    url.searchParams.set("met", met);
    url.searchParams.set("APIkey", this.apiKey ?? "");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const key = `allsports:${met}:${[...Object.entries(params)].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")}`;
    const result = await cachedRequest(
      key,
      `allsports:${met.toLowerCase()}`,
      () => fetchJsonWithResilience<AllSportsEnvelope<T>>(url, {}, `allsports:${met.toLowerCase()}`, "AllSportsApi"),
      met === "Livescore" || met === "OddsLive" ? CACHE_TTL.live : met === "Odds" ? CACHE_TTL.live : CACHE_TTL.fixtures,
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

function mapMatchSummary(match: AllSportsMatch): MatchSummary {
  const [home, away] = parseScore(match.event_final_result || match.event_ft_result);

  return {
    id: `allsports-${match.event_key}`,
    source: "allsports",
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
  const status = (match.event_status ?? "").toLowerCase();
  if (match.event_live === "1" || /^\d+/.test(status) || status.includes("half")) {
    return "LIVE";
  }
  if (status.includes("finish") || status.includes("after") || status.includes("pen")) {
    return "FINISHED";
  }
  return "UPCOMING";
}

function mapStats(statistics: AllSportsStatistic[]): { home: TeamStats; away: TeamStats } {
  const value = (name: string, side: TeamSide) => {
    const stat = statistics.find((item) => normalize(item.type).includes(name));
    return parseStat(side === "home" ? stat?.home : stat?.away);
  };

  return {
    home: {
      possession: value("possession", "home"),
      shots: value("shots total", "home") ?? value("total shots", "home"),
      shotsOnTarget: value("shots on goal", "home") ?? value("shots on target", "home"),
      xg: value("expected goals", "home"),
      corners: value("corners", "home") ?? value("corner kicks", "home"),
      yellowCards: value("yellow", "home"),
      redCards: value("red", "home"),
      fouls: value("fouls", "home"),
      dangerousAttacks: value("dangerous attacks", "home")
    },
    away: {
      possession: value("possession", "away"),
      shots: value("shots total", "away") ?? value("total shots", "away"),
      shotsOnTarget: value("shots on goal", "away") ?? value("shots on target", "away"),
      xg: value("expected goals", "away"),
      corners: value("corners", "away") ?? value("corner kicks", "away"),
      yellowCards: value("yellow", "away"),
      redCards: value("red", "away"),
      fouls: value("fouls", "away"),
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
    shots: parseStat(player.player_shots_total),
    shotsOnTarget: parseStat(player.player_shots_on_goal),
    xg: parseStat(player.player_expected_goals),
    keyPasses: parseStat(player.player_key_passes),
    foulsCommitted: parseStat(player.player_fouls_committed)
  }));
}

function mapOdds(result: AllSportsOddsResult, minute: number | null): OddsQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows.flatMap((row) => {
      const bookmaker = String(row.odd_bookmakers || "AllSportsApi");
      return Object.entries(row)
        .filter(([key, value]) => isOddPriceField(key) && key !== "odd_bookmakers" && value !== null && value !== undefined && value !== "")
        .map(([key, value]) => ({
          bookmaker,
          market: normalizeOddMarket(key),
          selection: key.replace(/^odd_/, "").replaceAll("_", " "),
          price: Number(value),
          quotedAt: new Date().toISOString(),
          minute
        }))
        .filter((quote) => Number.isFinite(quote.price));
    })
  );
}

function mapLiveOdds(result: AllSportsLiveOddsResult, minute: number | null): OddsQuote[] {
  return Object.values(result ?? {}).flatMap((rows) =>
    rows.flatMap((row) =>
      Object.entries(row)
        .filter(([key, value]) => isOddPriceField(key) && key !== "odd_name" && value !== null && value !== undefined && value !== "")
        .map(([key, value]) => ({
          bookmaker: "AllSportsApi Live",
          market: String(row.odd_name || "Live odds"),
          selection: key.replace(/^odd_/, "").replaceAll("_", " "),
          price: Number(value),
          quotedAt: new Date().toISOString(),
          minute
        }))
        .filter((quote) => Number.isFinite(quote.price))
    )
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

function normalize(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeSubstitution(value: AllSportsSubstitution["home_scorer"]) {
  return Array.isArray(value) ? null : value;
}

function normalizeOddMarket(key: string) {
  if (["odd_1", "odd_x", "odd_2"].includes(key)) {
    return "Resultado";
  }
  if (key.includes("o+") || key.includes("u+")) {
    return "Total goles";
  }
  if (key.includes("bts")) {
    return "Ambos marcan";
  }
  return "Cuotas";
}

function dedupeMatches(matches: AllSportsMatch[]) {
  return [...new Map(matches.map((match) => [match.event_key, match])).values()];
}

function isPriorityLeague(name: string) {
  const normalized = normalize(name);
  return PRIORITY_LEAGUE_TERMS.some((term) => normalized.includes(term));
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
