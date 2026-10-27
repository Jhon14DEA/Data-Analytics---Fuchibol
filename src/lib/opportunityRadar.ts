import { allSportsApiProvider, footballProvider, getMatchAnalysisContext } from "@/providers";
import { getPerformanceMetricRecords } from "@/lib/performance";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";
import type { AnalyzedMarket, MatchAnalysisContext, MatchAnalysisResult, MatchSummary } from "@/types/domain";

const MAX_RADAR_DEEP_ANALYSIS = Number(process.env.RADAR_MAX_DEEP_ANALYSIS ?? 24);

export type OpportunityDebugRow = {
  matchId: string;
  match: string;
  competition: string;
  status: string;
  provider: string;
  marketsFound: number;
  recommendationsBeforeFilter: number;
  bestScore: number;
  discardReason: string;
  bestMarket: OpportunityMarketDebug | null;
  markets: Array<{
    market: string;
    selection: string;
    bookmaker: string | null;
    odd: number | null;
    line: number | null;
    confidence: number;
    decision: string | undefined;
    missing: string[];
  }>;
};

export type OpportunityMarketDebug = {
  market: string;
  selection: string;
  bookmaker: string | null;
  odd: number | null;
  line: number | null;
  statisticalScore: number;
  impliedProbability: number | null;
  estimatedProbability: number | null;
  edge: number | null;
  rawEdge: number | null;
  uncertaintyAdjustedEdge: number | null;
  betScore: number | null;
  state: "APUESTA >=8" | "VIGILAR 6.5-7.9" | "CANDIDATO FUERTE - ESPERANDO CUOTA" | "ESPERANDO CUOTA" | "DESCARTAR" | "ERROR PROVEEDOR";
};

export type OpportunityRadarDebug = {
  provider: string;
  generatedAt: string;
  matchesFoundToday: number;
  candidates: number;
  cheapCandidates: number;
  deepShortlist: number;
  matchesAnalyzed: number;
  matchesDiscarded: number;
  requestsConsumed: number;
  marketsEvaluated: number;
  recommendationsBeforeFilter: number;
  debugRows: OpportunityDebugRow[];
  opportunities: MatchAnalysisResult[];
};

export async function buildOpportunityRadarDebug(): Promise<OpportunityRadarDebug> {
  const before = getPerformanceMetricRecords().length;
  const provider = allSportsApiProvider.isConfigured() ? "AllSportsApi" : "Fallback";
  const matches = await listRadarMatches();
  const allCandidates = matches.filter((match) => match.status === "LIVE" || match.status === "UPCOMING");
  const cheapRanked = rankRadarCandidates(allCandidates);
  const candidates = cheapRanked.slice(0, MAX_RADAR_DEEP_ANALYSIS);
  const contextResults = await Promise.all(candidates.map((match) => getContextSafely(match)));
  const contexts = contextResults.filter((item): item is MatchAnalysisContext => Boolean(item && "match" in item));
  const analyses = contexts.map(analyzeMatchContext);
  const opportunities = buildRadarOpportunities(analyses);
  const shownIds = new Set(opportunities.map((opportunity) => opportunity.match.id));
  const rows = candidates.map((match) => {
    const contextOrError = contextResults.find((item) => {
      if (!item) return false;
      return isContext(item) ? item.match.id === match.id : item.matchId === match.id;
    });
    if (!contextOrError || !isContext(contextOrError)) {
      return debugRowForError(match, provider, contextOrError?.error ?? "error proveedor");
    }

    const analysis = analyses.find((item) => item.match.id === match.id);
    return analysis ? debugRowForAnalysis(analysis, shownIds.has(analysis.match.id)) : debugRowForError(match, provider, "error proveedor");
  });
  const metrics = getPerformanceMetricRecords().slice(before);

  return {
    provider,
    generatedAt: new Date().toISOString(),
    matchesFoundToday: matches.length,
    candidates: allCandidates.length,
    cheapCandidates: cheapRanked.length,
    deepShortlist: candidates.length,
    matchesAnalyzed: contexts.length,
    matchesDiscarded: rows.filter((row) => row.discardReason !== "MOSTRADO").length,
    requestsConsumed: metrics.filter((metric) => metric.provider && metric.cache === "miss").length,
    marketsEvaluated: rows.reduce((total, row) => total + row.marketsFound, 0),
    recommendationsBeforeFilter: rows.reduce((total, row) => total + row.recommendationsBeforeFilter, 0),
    debugRows: rows,
    opportunities
  };
}

function isContext(value: MatchAnalysisContext | { matchId: string; error: string } | null): value is MatchAnalysisContext {
  return Boolean(value && "match" in value);
}

async function listRadarMatches(): Promise<MatchSummary[]> {
  if (allSportsApiProvider.isConfigured()) {
    return allSportsApiProvider.listAllMatchesToday();
  }
  return footballProvider.listMatches();
}

async function getContextSafely(match: MatchSummary): Promise<MatchAnalysisContext | { matchId: string; error: string } | null> {
  try {
    return await getMatchAnalysisContext(match.id);
  } catch (error) {
    return { matchId: match.id, error: error instanceof Error ? error.message : "error proveedor" };
  }
}

function debugRowForAnalysis(analysis: MatchAnalysisResult, isShown: boolean): OpportunityDebugRow {
  const markets = analysis.allMarkets ?? analysis.markets;
  const recommendations = markets.filter((market) => market.decision === "APUESTA RECOMENDADA" || market.decision === "INTERESANTE");
  const best = rankDisplayMarkets(markets)[0];
  const bestRadarMarket = rankRadarMarkets(markets.filter(isRadarOpportunity))[0];
  const bestMarket = best ? marketOpportunityDebug(best) : null;

  return {
    matchId: analysis.match.id,
    match: `${analysis.match.homeTeam} vs ${analysis.match.awayTeam}`,
    competition: analysis.match.competition,
    status: analysis.match.status,
    provider: analysis.provider,
    marketsFound: markets.length,
    recommendationsBeforeFilter: recommendations.length,
    bestScore: bestRadarMarket?.confidence ?? bestMarket?.statisticalScore ?? 0,
    discardReason: isShown ? "MOSTRADO" : discardReason(analysis.match.status, markets),
    bestMarket,
    markets: markets.map(marketDebug).slice(0, 12)
  };
}

function debugRowForError(match: MatchSummary, provider: string, error: string): OpportunityDebugRow {
  return {
    matchId: match.id,
    match: `${match.homeTeam} vs ${match.awayTeam}`,
    competition: match.competition,
    status: match.status,
    provider,
    marketsFound: 0,
    recommendationsBeforeFilter: 0,
    bestScore: 0,
    discardReason: `error proveedor: ${error}`,
    bestMarket: {
      market: "N/D",
      selection: "N/D",
      bookmaker: null,
      odd: null,
      line: null,
      statisticalScore: 0,
      impliedProbability: null,
      estimatedProbability: null,
      edge: null,
      rawEdge: null,
      uncertaintyAdjustedEdge: null,
      betScore: null,
      state: "ERROR PROVEEDOR"
    },
    markets: []
  };
}

function marketDebug(market: AnalyzedMarket) {
  return {
    market: market.market,
    selection: market.selection,
    bookmaker: market.bookmaker ?? null,
    odd: market.odd ?? null,
    line: market.line ?? null,
    confidence: market.confidence,
    decision: market.decision,
    missing: market.missingRequirements ?? []
  };
}

function rankRadarCandidates(matches: MatchSummary[]) {
  return [...matches].sort((a, b) => radarCandidateScore(b) - radarCandidateScore(a));
}

function radarCandidateScore(match: MatchSummary) {
  const kickoff = match.kickoffAt ? new Date(match.kickoffAt).getTime() : null;
  const hoursFromNow = kickoff ? Math.abs(kickoff - Date.now()) / 36e5 : 24;
  let score = 0;
  if (match.status === "LIVE") score += 100;
  if (match.status === "UPCOMING") score += 50;
  score += Math.max(0, 24 - hoursFromNow);
  if (isPriorityCompetition(match.competition)) score += 20;
  const totalGoals = match.score.home + match.score.away;
  if (match.status === "LIVE" && totalGoals > 0) score += Math.min(12, totalGoals * 4);
  if (match.status === "LIVE" && match.minute !== null && match.minute <= 75) score += 8;
  return score;
}

function isPriorityCompetition(competition: string) {
  const value = competition.toLowerCase();
  return [
    "champions",
    "europa",
    "conference",
    "premier",
    "liga",
    "serie a",
    "bundesliga",
    "ligue 1",
    "libertadores",
    "sudamericana",
    "saudi"
  ].some((term) => value.includes(term));
}

function discardReason(status: string, markets: AnalyzedMarket[]) {
  if (status === "FINISHED") return "partido finalizado";
  if (!markets.length) return "mercado no soportado / datos insuficientes";
  if (markets.some(isRadarOpportunity)) return "fuera del top 5";
  if (markets.some((market) => market.confidence >= 8 && (market.dataQuality ?? 0) < 70)) return "calidad de datos insuficiente";
  if (markets.some((market) => market.missingRequirements?.some((item) => item.includes("cuota")))) return "falta cuota";
  if (markets.some((market) => market.missingRequirements?.some((item) => item.includes("linea")))) return "falta línea";
  if (markets.some((market) => market.decision === "INTERESANTE")) return "interesante, pero no supera filtro estricto";
  if (markets.some((market) => market.decision === "APUESTA RECOMENDADA" && (market.uncertaintyAdjustedEdge ?? market.edge ?? 0) < 0.05)) return "edge insuficiente";
  if (markets.every((market) => market.confidence < 6)) return "confianza baja";
  if (markets.every((market) => market.decision === "SIN APUESTA")) return "mercado no soportado";
  if (markets.some((market) => market.risks.some((risk) => risk.includes("cache")))) return "cache obsoleta";
  return "datos insuficientes";
}

function buildRadarOpportunities(analyses: MatchAnalysisResult[]) {
  return analyses
    .filter((analysis) => analysis.statusIndicator !== "FINAL")
    .filter((analysis) => (analysis.allMarkets ?? analysis.markets).some(isRadarOpportunity))
    .sort((a, b) => compareRadarMarkets(bestRadarMarket(b), bestRadarMarket(a)))
    .slice(0, 5);
}

function isRadarOpportunity(market: AnalyzedMarket) {
  const score = market.betScore ?? market.confidence;
  return (
    market.decision === "APUESTA RECOMENDADA" &&
    score >= 8 &&
    (market.dataQuality ?? 0) >= 70 &&
    market.odd !== null &&
    market.odd !== undefined &&
    hasRequiredLine(market) &&
    (market.uncertaintyAdjustedEdge ?? market.edge ?? 0) >= 0.05
  );
}

function bestRadarMarket(analysis: MatchAnalysisResult) {
  return rankRadarMarkets((analysis.allMarkets ?? analysis.markets).filter(isRadarOpportunity))[0];
}

function rankRadarMarkets(markets: AnalyzedMarket[]) {
  return [...markets].sort(compareRadarMarkets);
}

function compareRadarMarkets(a: AnalyzedMarket | undefined, b: AnalyzedMarket | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const confidenceScore = (b.betScore ?? b.confidence) - (a.betScore ?? a.confidence);
  if (confidenceScore !== 0) return confidenceScore;
  const qualityScore = (b.dataQuality ?? 0) - (a.dataQuality ?? 0);
  if (qualityScore !== 0) return qualityScore;
  return (b.uncertaintyAdjustedEdge ?? b.edge ?? -1) - (a.uncertaintyAdjustedEdge ?? a.edge ?? -1);
}

function rankDisplayMarkets(markets: AnalyzedMarket[]) {
  return [...markets].sort((a, b) => {
    const aDebug = marketOpportunityDebug(a);
    const bDebug = marketOpportunityDebug(b);
    const stateScore = statePriority(bDebug.state) - statePriority(aDebug.state);
    if (stateScore !== 0) return stateScore;
    const betScore = (bDebug.betScore ?? -1) - (aDebug.betScore ?? -1);
    if (betScore !== 0) return betScore;
    return bDebug.statisticalScore - aDebug.statisticalScore;
  });
}

function marketOpportunityDebug(market: AnalyzedMarket): OpportunityMarketDebug {
  const hasOdd = market.odd !== null && market.odd !== undefined;
  const lineReady = hasRequiredLine(market);
  const hasProbabilities = market.impliedProbability !== null && market.impliedProbability !== undefined && market.estimatedProbability !== null && market.estimatedProbability !== undefined;
  const hasEdge = market.edge !== null && market.edge !== undefined;
  const executable = hasOdd && lineReady && hasProbabilities && hasEdge && (market.dataQuality ?? 0) >= 70;
  const betScore = executable ? market.betScore ?? market.confidence : null;

  return {
    market: market.market,
    selection: market.selection,
    bookmaker: market.bookmaker ?? null,
    odd: market.odd ?? null,
    line: market.line ?? null,
    statisticalScore: market.statisticalScore ?? market.confidence,
    impliedProbability: market.impliedProbability ?? null,
    estimatedProbability: market.estimatedProbability ?? null,
    edge: market.edge ?? null,
    rawEdge: market.rawEdge ?? market.edge ?? null,
    uncertaintyAdjustedEdge: market.uncertaintyAdjustedEdge ?? null,
    betScore,
    state: marketState(market, executable, betScore)
  };
}

function marketState(market: AnalyzedMarket, executable: boolean, betScore: number | null): OpportunityMarketDebug["state"] {
  if (market.missingRequirements?.some((item) => item.includes("cuota"))) {
    return (market.statisticalScore ?? market.confidence) >= 8 ? "CANDIDATO FUERTE - ESPERANDO CUOTA" : "ESPERANDO CUOTA";
  }
  if (!executable) return "DESCARTAR";
  if ((market.uncertaintyAdjustedEdge ?? market.edge ?? 0) <= 0) return "DESCARTAR";
  if ((betScore ?? 0) >= 8) return "APUESTA >=8";
  if ((betScore ?? 0) >= 6.5) return "VIGILAR 6.5-7.9";
  return "DESCARTAR";
}

function hasRequiredLine(market: AnalyzedMarket) {
  if (!requiresLine(market)) return true;
  return market.line !== null && market.line !== undefined;
}

function requiresLine(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  return ["over", "under", "goles", "corner", "tarjeta", "remate"].some((term) => text.includes(term)) && !text.includes("ambos");
}

function statePriority(state: OpportunityMarketDebug["state"]) {
  if (state === "APUESTA >=8") return 5;
  if (state === "CANDIDATO FUERTE - ESPERANDO CUOTA") return 4;
  if (state === "VIGILAR 6.5-7.9") return 3;
  if (state === "ESPERANDO CUOTA") return 2;
  if (state === "ERROR PROVEEDOR") return 1;
  return 0;
}
