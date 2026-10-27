import { demoFootballProvider } from "@/providers/football/demoProvider";
import { demoOddsProvider } from "@/providers/odds/demoProvider";
import { ApiFootballProvider } from "@/providers/football/apiFootball";
import { AllSportsApiError, AllSportsApiProvider } from "@/providers/football/allSportsApi";
import type { FootballDebugStatus, MatchAnalysisContext, MatchSearchResult } from "@/types/domain";

const allSportsApiProvider = new AllSportsApiProvider();
const apiFootballProvider = new ApiFootballProvider();

export const providerStatus = allSportsApiProvider.isConfigured() ? allSportsApiProvider.status : apiFootballProvider.status;
export { allSportsApiProvider, apiFootballProvider, demoFootballProvider };

export async function getFootballDebugStatus(): Promise<FootballDebugStatus> {
  if (allSportsApiProvider.isConfigured()) {
    const allSports = await allSportsApiProvider.debugStatus();
    if (allSports.message === "AllSportsApi conectada") {
      return allSports;
    }

    if (!apiFootballProvider.isConfigured()) {
      return allSports;
    }
  }

  if (apiFootballProvider.isConfigured()) {
    return apiFootballProvider.debugStatus();
  }

  return {
    configured: false,
    provider: "DEMO",
    statusCode: null,
    message: "AllSportsApi y API-Football no configuradas. Usando DEMO.",
    remainingRequests: null,
    usedRequests: null
  };
}

export const footballProvider = {
  async listMatches() {
    if (allSportsApiProvider.isConfigured()) {
      try {
        return await allSportsApiProvider.listMatches();
      } catch (error) {
        if (!apiFootballProvider.isConfigured()) {
          throw error;
        }
        console.error("[AllSportsApi fixtures]", logProviderError(error));
      }
    }

    if (apiFootballProvider.isConfigured()) {
      return apiFootballProvider.listMatches();
    }

    return demoFootballProvider.listMatches();
  },
  async getMatch(matchId: string) {
    if (matchId.startsWith("demo-")) {
      return demoFootballProvider.getMatch(matchId);
    }

    if (matchId.startsWith("allsports-")) {
      return allSportsApiProvider.getMatch(matchId);
    }

    if (matchId.startsWith("api-football-")) {
      return apiFootballProvider.getMatch(matchId);
    }

    return null;
  },
  async getPreviousSnapshot(matchId: string) {
    if (matchId.startsWith("demo-")) {
      return demoFootballProvider.getPreviousSnapshot(matchId);
    }

    if (matchId.startsWith("allsports-")) {
      return allSportsApiProvider.getPreviousSnapshot(matchId);
    }

    if (matchId.startsWith("api-football-")) {
      return apiFootballProvider.getPreviousSnapshot(matchId);
    }

    return null;
  },
  invalidateMatchCache(matchId: string) {
    if (matchId.startsWith("allsports-")) {
      return allSportsApiProvider.invalidateMatchCache(matchId);
    }
    return 0;
  },
  invalidateListCache() {
    if (allSportsApiProvider.isConfigured()) {
      return allSportsApiProvider.invalidateListCache();
    }
    return 0;
  }
};

export async function searchFootballMatches(query: string, date?: string) {
  return (await searchFootballMatchesDetailed(query, date)).matches;
}

export async function searchFootballMatchesDetailed(query: string, date?: string): Promise<MatchSearchResult> {
  if (allSportsApiProvider.isConfigured()) {
    try {
      return await allSportsApiProvider.searchMatchesDetailed(query, date);
    } catch (error) {
      if (!apiFootballProvider.isConfigured()) {
        throw error;
      }
      console.error("[AllSportsApi search]", logProviderError(error));
    }
  }

  const matches = await footballProvider.listMatches();
  const normalized = query.trim().toLowerCase().replace(/\s+vs\s+|\s+v\s+/g, " ");
  const terms = normalized.split(/\s+/).filter(Boolean);
  const filtered = matches.filter((match) => {
    const haystack = `${match.homeTeam} ${match.awayTeam} ${match.competition}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return {
    matches: filtered,
    diagnostics: {
      term: query,
      provider: apiFootballProvider.isConfigured() ? "API-Football" : "DEMO",
      searchedRanges: date ? [date] : ["dashboard/cache"],
      apiResults: matches.length,
      filteredOut: Math.max(0, matches.length - filtered.length),
      filterReasons: filtered.length ? ["coincidencia en datos cargados"] : ["sin coincidencias en datos cargados"],
      cacheHits: matches.length,
      cacheMisses: 0,
      endpoints: apiFootballProvider.isConfigured() ? ["/fixtures"] : ["DEMO"]
    }
  };
}

export async function getMatchAnalysisContext(matchId: string): Promise<MatchAnalysisContext | null> {
  if (matchId.startsWith("allsports-")) {
    return allSportsApiProvider.getAnalysisContext(matchId);
  }

  const match = await footballProvider.getMatch(matchId);
  if (!match) {
    return null;
  }

  return {
    match,
    recentHome: [],
    recentAway: [],
    h2h: [],
    dataFreshness: null,
    provider: match.source === "api-football" ? "API-Football" : "DEMO",
    generatedAt: new Date().toISOString()
  };
}

export const oddsProvider = {
  async getCurrentOdds(matchId: string) {
    if (matchId.startsWith("demo-")) {
      return demoOddsProvider.getCurrentOdds(matchId);
    }

    if (matchId.startsWith("allsports-")) {
      return allSportsApiProvider.getCurrentOdds(matchId);
    }

    if (matchId.startsWith("api-football-")) {
      return apiFootballProvider.getCurrentOdds(matchId);
    }

    return [];
  },
  async getOddsHistory(matchId: string) {
    if (matchId.startsWith("demo-")) {
      return demoOddsProvider.getOddsHistory(matchId);
    }

    if (matchId.startsWith("allsports-")) {
      return allSportsApiProvider.getOddsHistory(matchId);
    }

    if (matchId.startsWith("api-football-")) {
      return apiFootballProvider.getOddsHistory(matchId);
    }

    return [];
  }
};

function logProviderError(error: unknown) {
  return {
    httpStatus: error instanceof AllSportsApiError ? error.statusCode : null,
    message: error instanceof Error ? error.message : "Error desconocido",
    remainingRequests: error instanceof AllSportsApiError ? error.remainingRequests : null,
    usedRequests: error instanceof AllSportsApiError ? error.usedRequests : null
  };
}
