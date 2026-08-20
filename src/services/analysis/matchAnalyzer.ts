import type {
  AnalyzedMarket,
  CurrentRecommendation,
  CurrentRecommendationOption,
  LiveTrendState,
  MatchAnalysisContext,
  MatchAnalysisResult,
  MatchDetail,
  OddsQuote,
  TeamSide,
  TeamStats
} from "@/types/domain";

const NO_OPPORTUNITY = "NO HAY OPORTUNIDAD CON RESPALDO SUFICIENTE";

export function analyzeMatchContext(context: MatchAnalysisContext): MatchAnalysisResult {
  const markets = [
    analyzeOverGoals(context),
    analyzeBothTeamsScore(context),
    analyzeCorners(context),
    analyzeCards(context),
    analyzeShots(context),
    analyzeTeamGoals(context),
    analyzePlayerShots(context),
    analyzeOneXTwo(context),
    analyzeDoubleChance(context)
  ].filter((market): market is AnalyzedMarket => Boolean(market));

  const qualifiedMarkets = markets
    .filter((market) => market.confidence >= 6 && market.supportingData.length >= 2)
    .sort((a, b) => b.confidence - a.confidence);

  const opportunityScore = qualifiedMarkets[0]?.confidence ?? 0;
  const displayedMarkets = qualifiedMarkets.length
    ? qualifiedMarkets
    : [
        {
          market: "General",
          selection: "Sin entrada",
          confidence: 1,
          classification: "DESCARTAR" as const,
          supportingData: [NO_OPPORTUNITY],
          risks: ["No hay evidencia estadistica suficiente en los datos disponibles."],
          invalidators: ["Esperar mas datos reales de forma, alineaciones, cuotas o partido en vivo."]
        }
      ];

  return {
    ...context,
    markets: displayedMarkets,
    currentRecommendation: buildCurrentRecommendation(context, qualifiedMarkets),
    opportunityScore,
    liveState: evaluateLiveState(context.match),
    noOpportunityMessage: qualifiedMarkets.length ? undefined : NO_OPPORTUNITY
  };
}

export function buildOpportunityRadar(contexts: MatchAnalysisContext[]) {
  return contexts
    .map(analyzeMatchContext)
    .filter((result) => result.opportunityScore >= 6)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 8);
}

function buildCurrentRecommendation(context: MatchAnalysisContext, markets: AnalyzedMarket[]): CurrentRecommendation {
  const match = context.match;

  if (match.status !== "LIVE") {
    return { message: "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE AHORA", options: [] };
  }

  const liveDataPoints = [
    sumStat(match.stats, "shots"),
    sumStat(match.stats, "shotsOnTarget"),
    sumStat(match.stats, "xg"),
    sumStat(match.stats, "corners"),
    sumStat(match.stats, "yellowCards"),
    sumStat(match.stats, "redCards"),
    sumStat(match.stats, "dangerousAttacks"),
    sumStat(match.stats, "possession")
  ].filter((value) => value !== null).length;

  if (liveDataPoints < 3 || !match.odds.length) {
    return { message: "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE AHORA", options: [] };
  }

  const missingShotCore =
    sumStat(match.stats, "shots") === null && sumStat(match.stats, "shotsOnTarget") === null && sumStat(match.stats, "xg") === null;
  const maxConfidence = missingShotCore ? 6.5 : 10;

  const options = markets
    .flatMap((market) => pairMarketWithOdds(market, match.odds, match.oddsHistory))
    .map((option) => {
      const confidence = Math.min(option.confidence, maxConfidence);
      return {
        ...option,
        confidence,
        state: recommendationState(confidence),
        decision: recommendationDecision(confidence)
      };
    })
    .filter((option) => option.confidence >= 5.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return options.length ? { options } : { message: "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE AHORA", options: [] };
}

function pairMarketWithOdds(market: AnalyzedMarket, odds: OddsQuote[], oddsHistory: OddsQuote[]): CurrentRecommendationOption[] {
  return odds
    .filter((quote) => isCompatibleOdd(market, quote))
    .slice(0, 8)
    .map((quote) => {
      const confidence = adjustConfidenceByOdd(market.confidence, quote.price);
      return {
        market: market.market,
        selection: quote.selection || market.selection,
        bookmaker: quote.bookmaker,
        odd: quote.price,
        confidence,
        state: recommendationState(confidence),
        reasons: [...market.supportingData, `Cuota usada: ${quote.price.toFixed(2)} en ${quote.bookmaker}.`, describeOddsMovement(quote, oddsHistory)]
          .filter(Boolean)
          .slice(0, 3),
        risks: market.risks.slice(0, 2),
        decision: recommendationDecision(confidence)
      };
    });
}

function isCompatibleOdd(market: AnalyzedMarket, quote: OddsQuote) {
  const marketText = `${market.market} ${market.selection}`.toLowerCase();
  const quoteText = `${quote.market} ${quote.selection}`.toLowerCase();

  if (marketText.includes("corner") && quoteText.includes("corner")) return true;
  if (marketText.includes("tarjeta") && (quoteText.includes("card") || quoteText.includes("tarjeta"))) return true;
  if ((marketText.includes("goles") || marketText.includes("over")) && (quoteText.includes("over") || quoteText.includes("mas") || quoteText.includes("o+") || quoteText.includes("total"))) return true;
  if (marketText.includes("ambos") && (quoteText.includes("bts") || quoteText.includes("both") || quoteText.includes("ambos"))) return true;
  if (marketText.includes("doble") && ["1x", "x2", "12"].some((value) => quoteText.includes(value))) return true;
  if (marketText.includes("1x2") && (quoteText.includes("resultado") || [" 1", " x", " 2"].some((value) => quoteText.includes(value)))) return true;
  if (marketText.includes("remates") && (quoteText.includes("shot") || quoteText.includes("remate"))) return true;

  return false;
}

function adjustConfidenceByOdd(confidence: number, odd: number) {
  if (!Number.isFinite(odd) || odd <= 1) return 1;
  if (odd >= 6) return Math.max(1, confidence - 2);
  if (odd >= 4) return Math.max(1, confidence - 1);
  if (odd < 1.25) return Math.max(1, confidence - 1);
  return confidence;
}

function describeOddsMovement(quote: OddsQuote, oddsHistory: OddsQuote[]) {
  const history = oddsHistory.filter(
    (item) => item.bookmaker === quote.bookmaker && item.market === quote.market && item.selection === quote.selection
  );
  const first = history[0];
  if (!first || first.price === quote.price) {
    return "Movimiento de cuota: N/D.";
  }
  const direction = quote.price < first.price ? "bajó" : "subió";
  return `Movimiento de cuota: ${direction} de ${first.price.toFixed(2)} a ${quote.price.toFixed(2)}.`;
}

function recommendationState(confidence: number): CurrentRecommendationOption["state"] {
  if (confidence >= 8) return "RESPALDO FUERTE";
  if (confidence >= 6.5) return "INTERESANTE";
  if (confidence >= 5) return "VIGILAR";
  return "DESCARTAR";
}

function recommendationDecision(confidence: number): CurrentRecommendationOption["decision"] {
  if (confidence >= 7) return "CONSIDERAR";
  if (confidence >= 5.5) return "ESPERAR";
  return "DESCARTAR";
}

function analyzeOverGoals(context: MatchAnalysisContext): AnalyzedMarket | null {
  const recentGoals = avg([...context.recentHome, ...context.recentAway].map(totalGoals));
  const h2hGoals = avg(context.h2h.map(totalGoals));
  const liveShots = sumStat(context.match.stats, "shots");
  const liveXg = sumStat(context.match.stats, "xg");
  const evidence = compact([
    recentGoals !== null ? `Promedio reciente combinado: ${recentGoals.toFixed(2)} goles.` : null,
    h2hGoals !== null ? `H2H reciente: ${h2hGoals.toFixed(2)} goles por partido.` : null,
    liveShots !== null && context.match.status === "LIVE" ? `Remates actuales: ${liveShots}.` : null,
    liveXg !== null && context.match.status === "LIVE" ? `xG actual combinado: ${liveXg.toFixed(2)}.` : null
  ]);

  const score = scoreFrom([
    recentGoals !== null && recentGoals >= 2.7,
    h2hGoals !== null && h2hGoals >= 2.5,
    liveShots !== null && liveShots >= 16,
    liveXg !== null && liveXg >= 1.8
  ]);

  return makeMarket("Over/Under goles", "Mas de 2.5 goles", score, evidence, [
    "Gol temprano puede cambiar ritmo y precio.",
    "Si no hay remates al arco, el volumen puede ser esteril."
  ]);
}

function analyzeBothTeamsScore(context: MatchAnalysisContext): AnalyzedMarket | null {
  const homeScored = rate(context.recentHome.map((match) => teamGoals(match, sideForTeam(match, context.match.homeTeam)) > 0));
  const awayScored = rate(context.recentAway.map((match) => teamGoals(match, sideForTeam(match, context.match.awayTeam)) > 0));
  const evidence = compact([
    homeScored !== null ? `${context.match.homeTeam} marco en ${(homeScored * 100).toFixed(0)}% de recientes.` : null,
    awayScored !== null ? `${context.match.awayTeam} marco en ${(awayScored * 100).toFixed(0)}% de recientes.` : null
  ]);
  const score = scoreFrom([homeScored !== null && homeScored >= 0.7, awayScored !== null && awayScored >= 0.7]);
  return makeMarket("Ambos marcan", "Si", score, evidence, ["Una alineacion alternativa o planteo conservador reduce respaldo."]);
}

function analyzeCorners(context: MatchAnalysisContext): AnalyzedMarket | null {
  const recentCorners = avg([...context.recentHome, ...context.recentAway].map((match) => sumStat(match.stats, "corners")));
  const liveCorners = sumStat(context.match.stats, "corners");
  const evidence = compact([
    recentCorners !== null ? `Promedio reciente: ${recentCorners.toFixed(1)} corners totales.` : null,
    liveCorners !== null && context.match.status === "LIVE" ? `Corners actuales: ${liveCorners}.` : null
  ]);
  const score = scoreFrom([recentCorners !== null && recentCorners >= 9, liveCorners !== null && liveCorners >= 6]);
  return makeMarket("Corners", "Mas de linea disponible", score, evidence, ["Si baja la presion por bandas, la lectura pierde fuerza."]);
}

function analyzeCards(context: MatchAnalysisContext): AnalyzedMarket | null {
  const recentCards = avg([...context.recentHome, ...context.recentAway].map((match) => sumCards(match)));
  const liveCards = sumCards(context.match);
  const evidence = compact([
    recentCards !== null ? `Promedio reciente: ${recentCards.toFixed(1)} tarjetas.` : null,
    context.match.status === "LIVE" ? `Tarjetas actuales: ${liveCards}.` : null
  ]);
  const score = scoreFrom([recentCards !== null && recentCards >= 4.5, context.match.status === "LIVE" && liveCards >= 3]);
  return makeMarket("Tarjetas", "Mas de linea disponible", score, evidence, ["Arbitro permisivo o partido resuelto invalida el ritmo disciplinario."]);
}

function analyzeShots(context: MatchAnalysisContext): AnalyzedMarket | null {
  const liveShots = sumStat(context.match.stats, "shots");
  const onTarget = sumStat(context.match.stats, "shotsOnTarget");
  const evidence = compact([
    liveShots !== null ? `Remates actuales: ${liveShots}.` : null,
    onTarget !== null ? `Remates al arco actuales: ${onTarget}.` : null
  ]);
  const score = scoreFrom([liveShots !== null && liveShots >= 18, onTarget !== null && onTarget >= 6]);
  return makeMarket("Remates", "Mas de linea disponible", score, evidence, ["Cambios defensivos o ventaja comoda pueden frenar volumen."]);
}

function analyzeTeamGoals(context: MatchAnalysisContext): AnalyzedMarket | null {
  const homeAvg = avg(context.recentHome.map((match) => teamGoals(match, sideForTeam(match, context.match.homeTeam))));
  const evidence = compact([homeAvg !== null ? `${context.match.homeTeam} promedio reciente: ${homeAvg.toFixed(2)} goles.` : null]);
  const score = scoreFrom([homeAvg !== null && homeAvg >= 1.8]);
  return makeMarket("Goles por equipo", `${context.match.homeTeam} mas de 1.5`, score, evidence, ["No recomendar por favoritismo: requiere alineacion ofensiva y volumen real."]);
}

function analyzePlayerShots(context: MatchAnalysisContext): AnalyzedMarket | null {
  const top = context.match.playerStats
    .filter((player) => (player.shots ?? 0) >= 3 || (player.shotsOnTarget ?? 0) >= 2)
    .sort((a, b) => (b.shots ?? 0) - (a.shots ?? 0))[0];

  if (!top) {
    return null;
  }

  return makeMarket(
    "Mercados de jugadores",
    `${top.player} remates`,
    7,
    [`${top.player}: ${top.shots ?? "N/D"} remates, ${top.shotsOnTarget ?? "N/D"} al arco.`],
    ["Solo usar si la casa ofrece linea razonable y el jugador sigue en cancha."]
  );
}

function analyzeOneXTwo(context: MatchAnalysisContext): AnalyzedMarket | null {
  const homeForm = pointsRate(context.recentHome, context.match.homeTeam);
  const awayForm = pointsRate(context.recentAway, context.match.awayTeam);
  const evidence = compact([
    homeForm !== null ? `Forma reciente ${context.match.homeTeam}: ${homeForm.toFixed(2)} puntos/partido.` : null,
    awayForm !== null ? `Forma reciente ${context.match.awayTeam}: ${awayForm.toFixed(2)} puntos/partido.` : null
  ]);

  const edge = homeForm !== null && awayForm !== null ? homeForm - awayForm : 0;
  const score = scoreFrom([edge >= 0.8, evidence.length >= 2]);
  return makeMarket("1X2", `${context.match.homeTeam} o empate segun mercado`, Math.min(score, 6), evidence, [
    "No se recomienda solo por favorito; faltan cuotas, alineacion y contexto si la evidencia es baja."
  ]);
}

function analyzeDoubleChance(context: MatchAnalysisContext): AnalyzedMarket | null {
  const homeLossRate = lossRate(context.recentHome, context.match.homeTeam);
  const evidence = compact([homeLossRate !== null ? `${context.match.homeTeam} perdio ${(homeLossRate * 100).toFixed(0)}% de recientes.` : null]);
  const score = scoreFrom([homeLossRate !== null && homeLossRate <= 0.25, evidence.length >= 1]);
  return makeMarket("Doble oportunidad", `${context.match.homeTeam} o Empate`, Math.min(score, 6), evidence, [
    "Precio bajo sin volumen estadistico no tiene respaldo suficiente."
  ]);
}

function makeMarket(market: string, selection: string, score: number, supportingData: string[], risks: string[]): AnalyzedMarket | null {
  if (!supportingData.length) {
    return null;
  }

  const confidence = Math.max(1, Math.min(10, score));
  return {
    market,
    selection,
    confidence,
    classification: classify(confidence),
    supportingData,
    risks,
    invalidators: ["Cambio fuerte de alineacion, roja, lesion clave, ritmo bajo sostenido o movimiento de cuota contra la lectura."]
  };
}

function scoreFrom(flags: boolean[]) {
  return 3 + flags.filter(Boolean).length * 2;
}

function classify(confidence: number): AnalyzedMarket["classification"] {
  if (confidence >= 8) return "RESPALDO FUERTE";
  if (confidence >= 6) return "INTERESANTE";
  if (confidence >= 4) return "RIESGO ALTO";
  return "DESCARTAR";
}

function evaluateLiveState(match: MatchDetail): LiveTrendState {
  if (match.status !== "LIVE") return "N/D";
  const shots = sumStat(match.stats, "shots");
  const xg = sumStat(match.stats, "xg");
  const redCards = sumStat(match.stats, "redCards");
  if ((redCards ?? 0) > 0) return "CAMBIO FUERTE";
  if ((shots ?? 0) >= 18 || (xg ?? 0) >= 2) return "MEJORO";
  if ((shots ?? 0) <= 6 && (match.minute ?? 0) >= 35) return "EMPEORO";
  return "IGUAL";
}

function totalGoals(match: MatchDetail) {
  return match.score.home + match.score.away;
}

function teamGoals(match: MatchDetail, side: TeamSide) {
  return side === "home" ? match.score.home : match.score.away;
}

function sideForTeam(match: MatchDetail, teamName: string): TeamSide {
  return match.homeTeam === teamName ? "home" : "away";
}

function sumStat(stats: MatchDetail["stats"], key: keyof TeamStats) {
  const home = stats.home[key];
  const away = stats.away[key];
  if (home === null && away === null) return null;
  return (home ?? 0) + (away ?? 0);
}

function sumCards(match: MatchDetail) {
  return (match.stats.home.yellowCards ?? 0) + (match.stats.away.yellowCards ?? 0) + (match.stats.home.redCards ?? 0) + (match.stats.away.redCards ?? 0);
}

function avg(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function rate(values: boolean[]) {
  if (!values.length) return null;
  return values.filter(Boolean).length / values.length;
}

function pointsRate(matches: MatchDetail[], teamName: string) {
  if (!matches.length) return null;
  const points = matches.reduce((total, match) => {
    const side = sideForTeam(match, teamName);
    const own = teamGoals(match, side);
    const other = side === "home" ? match.score.away : match.score.home;
    return total + (own > other ? 3 : own === other ? 1 : 0);
  }, 0);
  return points / matches.length;
}

function lossRate(matches: MatchDetail[], teamName: string) {
  if (!matches.length) return null;
  return (
    matches.filter((match) => {
      const side = sideForTeam(match, teamName);
      const own = teamGoals(match, side);
      const other = side === "home" ? match.score.away : match.score.home;
      return own < other;
    }).length / matches.length
  );
}

function compact(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value));
}
