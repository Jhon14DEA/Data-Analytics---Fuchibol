import type {
  AnalyzedMarket,
  BetScoreTraceStep,
  CurrentRecommendation,
  CurrentRecommendationOption,
  DecisionBlocker,
  LiveTrendState,
  MatchAnalysisContext,
  MatchAnalysisResult,
  MatchDetail,
  MarketStatus,
  OddsQuote,
  TeamSide,
  TeamStats
} from "@/types/domain";
import {
  estimateMarketProbabilityFromEvidence,
  liveHistoricalWeight,
  marketDataQualityForMarket,
  oddsMovementForMarket
} from "@/services/analysis/probabilityEstimators";

const NO_OPPORTUNITY = "NO HAY OPORTUNIDAD CON RESPALDO SUFICIENTE";
const NO_BET = "SIN APUESTA: mercado o cuota no disponible";

export function analyzeMatchContext(context: MatchAnalysisContext): MatchAnalysisResult {
  const dataUpdatedAt = new Date().toISOString();
  const statusIndicator = statusIndicatorFor(context.match.status);
  const analysisCacheKey = buildAnalysisCacheKey(context.match, dataUpdatedAt);

  if (!isBettable(context.match)) {
    return {
      ...context,
      markets: [],
      allMarkets: [],
    currentRecommendation: { message: "PARTIDO FINALIZADO", options: [], dataFreshness: context.dataFreshness ?? null },
      opportunityScore: 0,
      liveState: "N/D",
      dataUpdatedAt,
      statusIndicator,
      analysisCacheKey,
      noOpportunityMessage: NO_OPPORTUNITY
    };
  }

  const markets = [
    ...analyzeGoalMarkets(context),
    ...analyzeBothTeamsScoreMarkets(context),
    analyzeCorners(context),
    analyzeCards(context),
    analyzeShots(context),
    analyzeTeamGoals(context),
    analyzePlayerShots(context),
    ...analyzeOneXTwoMarkets(context),
    ...analyzeDoubleChanceMarkets(context)
  ]
    .filter((market): market is AnalyzedMarket => Boolean(market))
    .map((market) => applyLiveMarketStatus(context, market))
    .map((market) => priceMarket(context, market))
    .sort((a, b) => b.confidence - a.confidence);

  const opportunityMarkets = markets
    .filter(isStrongBet)
    .sort(compareMarkets);

  const criticalDiscards = markets.filter((market) => market.classification === "DESCARTAR" && market.supportingData.some((item) => item.includes("Evento critico")));
  const opportunityScore = opportunityMarkets[0]?.betScore ?? opportunityMarkets[0]?.confidence ?? 0;
  const displayedMarkets = rankMarkets(markets.filter((market) => isOpenMarket(market) && isPrimaryAnalysisMarket(market))).slice(0, 3);

  return {
    ...context,
    markets: displayedMarkets,
    allMarkets: markets,
    currentRecommendation: buildCurrentRecommendation(context, markets),
    opportunityScore,
    liveState: evaluateLiveState(context.match),
    dataUpdatedAt,
    statusIndicator,
    analysisCacheKey,
    noOpportunityMessage: opportunityMarkets.length ? undefined : "NO HAY APUESTA >=8/10 ACTUALMENTE"
  };
}

export function buildOpportunityRadar(contexts: MatchAnalysisContext[]) {
  return contexts
    .filter((context) => isBettable(context.match))
    .map(analyzeMatchContext)
    .filter((result) => result.statusIndicator !== "FINAL" && (result.allMarkets ?? result.markets).some(isStrongBet))
    .sort((a, b) => compareMarkets(bestStrongMarket(b), bestStrongMarket(a)))
    .slice(0, 5);
}

function buildCurrentRecommendation(context: MatchAnalysisContext, markets: AnalyzedMarket[]): CurrentRecommendation {
  const match = context.match;

  if (!isBettable(match) || match.status !== "LIVE") {
    return { message: match.status === "FINISHED" ? "PARTIDO FINALIZADO" : "SIN APUESTA AHORA", options: [], dataFreshness: context.dataFreshness ?? null };
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

  if (liveDataPoints < 2 && !context.recentHome.length && !context.h2h.length) {
    return { message: "SIN APUESTA AHORA", options: [], dataFreshness: context.dataFreshness ?? null, mainReason: "Datos live e historicos insuficientes." };
  }

  const maxConfidence = missingShotCore(match) ? 6.5 : 10;

  const ranked = rankMarkets(markets.filter(isOpenMarket));
  const bestExecutable = ranked.find((market) => market.decision === "APUESTA RECOMENDADA" && market.entryState === "ENTER_NOW");
  const earlyValueWindow = ranked.find((market) => market.entryState === "WATCH_ENTRY");
  const bestCandidate = bestExecutable ?? ranked.find((market) => market.odd !== null && market.odd !== undefined) ?? ranked[0] ?? null;
  const options = (bestExecutable ? [bestExecutable] : earlyValueWindow ? [earlyValueWindow] : [])
    .filter(isOpenMarket)
    .map((market) => currentOptionFromMarket(market, match.oddsHistory))
    .filter((option): option is CurrentRecommendationOption => Boolean(option))
    .map((option) => {
      const confidence = Math.min(option.confidence, maxConfidence);
      return {
        ...option,
        confidence,
        state: recommendationState(confidence),
        decision: recommendationDecision(confidence),
        dataFreshness: context.dataFreshness ?? null
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1);

  if (options.length) return { options, dataFreshness: context.dataFreshness ?? null };

  const blockers = bestCandidate?.decisionBlockers ?? [];
  const reason = blockers[0]?.effect ?? bestCandidate?.discardReason ?? "Ningun mercado vigente supera reglas de entrada con cuota real, edge ajustado y datos frescos.";
  return { message: "SIN APUESTA AHORA", options: [], dataFreshness: context.dataFreshness ?? null, mainReason: reason };
}

function currentOptionFromMarket(market: AnalyzedMarket, oddsHistory: OddsQuote[]): CurrentRecommendationOption | null {
  if (!isOpenMarket(market)) {
    return null;
  }

  if (!["APUESTA RECOMENDADA", "VENTANA TEMPRANA DE VALOR"].includes(market.decision ?? "") || !market.bookmaker || !market.odd) {
    return null;
  }

  const movementReason = describeOddsMovementForMarket(market, oddsHistory);

  return {
    market: market.market,
    selection: market.selection,
    bookmaker: market.bookmaker,
    odd: market.odd,
    line: market.line,
    impliedProbability: market.impliedProbability,
    estimatedProbability: market.estimatedProbability,
    edge: market.edge,
    rawEdge: market.rawEdge,
    uncertaintyAdjustedEdge: market.uncertaintyAdjustedEdge,
    betScore: market.betScore,
    confidence: market.confidence,
    goalsNeeded: market.finalTimeDebug?.goalsNeeded ?? goalsNeededForMarket(market),
    eventNeeded: eventNeededForMarket(market),
    decisionBlockers: market.decisionBlockers ?? [],
    entryState: market.entryState ?? null,
    action: market.entryState === "WATCH_ENTRY" ? "Revisar en 2 minutos o entrar con stake reducido solo si la cuota mantiene valor." : undefined,
    state: recommendationState(market.confidence, market.decision),
    reasons: [...market.supportingData, `Cuota usada: ${market.odd.toFixed(2)} en ${market.bookmaker}.`, movementReason]
      .filter((reason): reason is string => Boolean(reason))
      .slice(0, 3),
    risks: market.risks.slice(0, 2),
    decision: recommendationDecision(market.confidence)
  };
}

function isCompatibleOdd(market: AnalyzedMarket, quote: OddsQuote, requiredLine: number | null) {
  const marketText = `${market.market} ${market.selection}`.toLowerCase();
  const quoteText = `${quote.market} ${quote.selection}`.toLowerCase();
  if (!marketPeriodCompatible(market, quoteText)) return false;
  const quoteLine = extractLine(quoteText);
  const lineMatches = requiredLine === null || (quoteLine !== null && Math.abs(quoteLine - requiredLine) < 0.01);
  const marketGoalDirection = goalDirectionFromText(market.selection) ?? goalDirectionFromText(marketText);
  const quoteGoalDirection = goalDirectionFromText(quote.selection) ?? goalDirectionFromText(quoteText);

  if (marketText.includes("corner") && quoteText.includes("corner")) return quoteLine !== null && lineMatches;
  if (marketText.includes("tarjeta") && (quoteText.includes("card") || quoteText.includes("tarjeta"))) return quoteLine !== null && lineMatches;
  if ((marketText.includes("goles") || marketText.includes("over")) && (quoteText.includes("over") || quoteText.includes("mas") || quoteText.includes("o+") || quoteText.includes("total"))) {
    if (marketGoalDirection && quoteGoalDirection && marketGoalDirection !== quoteGoalDirection) return false;
    return quoteLine !== null && lineMatches;
  }
  if (marketText.includes("ambos") && (quoteText.includes("bts") || quoteText.includes("both") || quoteText.includes("ambos"))) {
    const wantsNo = /\b(no)\b/.test(marketText);
    const quoteNo = /\b(no)\b/.test(quoteText);
    const wantsYes = /\b(si|yes)\b/.test(marketText);
    const quoteYes = /\b(si|yes)\b/.test(quoteText);
    return wantsNo ? quoteNo : wantsYes ? quoteYes : true;
  }
  if (marketText.includes("doble") && ["1x", "x2", "12"].some((value) => quoteText.includes(value))) {
    return ["1x", "x2", "12"].some((value) => marketText.includes(value) && quoteText.includes(value));
  }
  if (marketText.includes("1x2") && (quoteText.includes("resultado") || /\b(1|x|2)\b/.test(quoteText))) {
    const wanted = market.selection.toLowerCase();
    const quoteSelection = quote.selection.toLowerCase();
    return wanted === quoteSelection || quoteText.endsWith(` ${wanted}`);
  }
  if (marketText.includes("remates") && (quoteText.includes("shot") || quoteText.includes("remate"))) return quoteLine !== null && lineMatches;

  return false;
}

function marketPeriodCompatible(market: AnalyzedMarket, quoteText: string) {
  const isFirstHalfMarket = market.marketPeriod === "FIRST_HALF" || /\b(1t|1h|primer tiempo|primera mitad|first half|1st half)\b/i.test(`${market.market} ${market.selection}`);
  const isFirstHalfQuote = /\b(1t|1h|primer tiempo|primera mitad|first half|1st half|half time|halftime)\b/i.test(quoteText);
  return isFirstHalfMarket ? isFirstHalfQuote : !isFirstHalfQuote;
}

function adjustConfidenceByOdd(confidence: number, odd: number) {
  if (!Number.isFinite(odd) || odd <= 1) return 1;
  if (odd >= 6) return Math.max(1, confidence - 2);
  if (odd >= 4) return Math.max(1, confidence - 1);
  if (odd < 1.25) return Math.max(1, confidence - 1);
  return confidence;
}

function describeOddsMovementForMarket(market: AnalyzedMarket, oddsHistory: OddsQuote[]) {
  const history = oddsHistory.filter((item) => item.bookmaker === market.bookmaker && item.price !== market.odd && isCompatibleOdd(market, item, market.line ?? null));
  const first = history[0];
  if (!first || !market.odd || first.price === market.odd) {
    return null;
  }
  const direction = market.odd < first.price ? "bajó" : "subió";
  return `Movimiento de cuota: ${direction} de ${first.price.toFixed(2)} a ${market.odd.toFixed(2)}.`;
}

function recommendationState(confidence: number, decision?: CurrentRecommendationOption["state"]): CurrentRecommendationOption["state"] {
  if (decision) return decision;
  if (confidence >= 8) return "APUESTA RECOMENDADA";
  if (confidence >= 6.5) return "INTERESANTE";
  if (confidence >= 5) return "ESPERAR";
  return "DESCARTAR";
}

function recommendationDecision(confidence: number): CurrentRecommendationOption["decision"] {
  if (confidence >= 7) return "CONSIDERAR";
  if (confidence >= 5.5) return "ESPERAR";
  return "DESCARTAR";
}

function priceMarket(context: MatchAnalysisContext, market: AnalyzedMarket): AnalyzedMarket {
  const statisticalScore = market.statisticalScore ?? market.confidence;

  if (!isBettable(context.match)) {
    return markMarketDecision({ ...market, statisticalScore, betScore: 0 }, "DESCARTAR", ["Partido finalizado o no disponible para apuesta."]);
  }

  if (market.classification === "DESCARTAR" && market.supportingData.some((item) => item.includes("Evento critico"))) {
    return markMarketDecision(market, "DESCARTAR");
  }

  if (market.marketStatus && !isOpenMarket(market)) {
    return markMarketDecision(
      { ...market, confidence: 0, statisticalScore: 0, betScore: 0 },
      "DESCARTAR",
      [`Mercado ${market.marketStatus}: no se muestra como recomendacion nueva.`]
    );
  }

  const requiresLine = marketRequiresLine(market);
  const requiredLine = requiresLine ? market.line ?? extractLine(`${market.market} ${market.selection}`) : null;
  const compatibleQuotes = context.match.odds
    .filter((quote) => Number.isFinite(quote.price) && quote.price > 1.01)
    .filter((quote) => context.match.status !== "LIVE" || quote.minute !== null || /live/i.test(quote.bookmaker))
    .filter((quote) => isCompatibleOdd(market, quote, requiredLine))
    .sort((a, b) => quotePriority(market, a, requiredLine) - quotePriority(market, b, requiredLine));

  const quote = compatibleQuotes[0];
  const quoteLine = quote ? extractLine(`${quote.market} ${quote.selection}`) : null;
  const exactLine = requiresLine ? requiredLine ?? quoteLine ?? null : null;

  if (!quote || (requiresLine && exactLine === null)) {
    const probability = estimateMarketProbabilityFromEvidence(market, context);
    const marketDataQuality = marketDataQualityForMarket(market, context, probability);
    const missing = [
      !quote ? "mercado/cuota real no disponible en el proveedor" : null,
      requiresLine && exactLine === null ? "linea exacta N/D" : null
    ].filter((item): item is string => Boolean(item));

    return {
      ...market,
      selection: market.selection.includes("linea") ? NO_BET : market.selection,
      decision: "SIN APUESTA",
      classification: "DESCARTAR",
      bookmaker: null,
      odd: null,
      line: exactLine,
      impliedProbability: null,
      estimatedProbability: probability.estimatedProbability,
      edge: null,
      statisticalScore,
      betScore: null,
      probabilityNote: probability.note,
      probabilityModel: probability.model,
      sampleSize: probability.sampleSize,
      rawRate: probability.rawRate,
      adjustedRate: probability.adjustedRate,
      uncertainty: probability.uncertainty,
      liveProbability: probability.liveProbability,
      prematchWeight: probability.prematchWeight,
      liveWeight: probability.liveWeight,
      concordanceScore: probability.concordanceScore,
      evidenceCoverage: probability.evidenceCoverage,
      liveAttackScore: probability.liveAttackScore,
      cumulativeAttackScore: probability.cumulativeAttackScore,
      recentMomentumScore: probability.recentMomentumScore,
      matchTrendScore: probability.matchTrendScore,
      matchTrendState: probability.matchTrendState,
      trendDirection: probability.matchTrendState,
      pressureStrength: probability.pressureStrength,
      goalPressureSignal: probability.goalPressureSignal,
      lambdaRemaining: probability.lambdaRemaining,
      remainingGoalProbabilities: probability.remainingGoalProbabilities,
      entryState: "NO_ENTRY",
      entryStateDebug: entryStateDebug(context, probability, null),
      statisticalOutlook: probability.statisticalOutlook,
      finalTimeDebug: finalizeTimeDebug(
        mergeTimeDebug(market.finalTimeDebug, probability.finalTimeDebug),
        market.confidence,
        probability.finalTimeConfidenceCap ?? market.finalTimeDebug?.timeCap ?? null,
        Math.min(market.confidence, probability.finalTimeConfidenceCap ?? market.finalTimeDebug?.timeCap ?? 10),
        probability.estimatedProbability,
        Math.min(market.confidence, probability.finalTimeConfidenceCap ?? market.finalTimeDebug?.timeCap ?? 10)
      ),
      missingRequirements: missing,
      decisionBlockers: decisionBlockersForMarket({
        quote,
        requiresLine,
        exactLine,
        hasPositiveEdge: false,
        hasEnoughEvidence: false,
        dataQuality: marketDataQuality.score,
        uncertainty: probability.uncertainty,
        confidence: market.confidence,
        betScore: null,
        dataFreshness: context.dataFreshness ?? null
      }),
      discardReason: missing.join("; "),
      dataQuality: marketDataQuality.score,
      marketDataQuality,
      supportingData: [...market.supportingData, ...probability.evidence, NO_BET].slice(0, 6),
      risks: [...market.risks, ...missing.map((item) => `Falta ${item}.`)].slice(0, 5)
    };
  }

  const confidence = adjustConfidenceByOdd(statisticalScore, quote.price);
  const impliedProbability = roundProbability(1 / quote.price);
  const probability = estimateMarketProbabilityFromEvidence(market, context);
  const marketDataQuality = marketDataQualityForMarket(market, context, probability);
  const dataQuality = marketDataQuality.score;
  const dataGap = liveLineupPlayerDataGap(context);
  const qualityCappedConfidence = Math.max(1, applyDataQualityCap(confidence, dataQuality) - dataGap.confidencePenalty);
  const finalTimeConfidenceCap = probability.finalTimeConfidenceCap ?? 10;
  const timeCappedConfidence = Math.min(qualityCappedConfidence, finalTimeConfidenceCap);
  const estimatedProbability = probability.estimatedProbability;
  const rawEdge = roundProbability(estimatedProbability - impliedProbability);
  const uncertaintyAdjustedEdge = roundProbability(rawEdge - probability.uncertainty * 0.12);
  const edge = rawEdge;
  const hasPositiveEdge = uncertaintyAdjustedEdge >= 0.05;
  const hasEnoughEvidence = market.supportingData.length >= (context.match.status === "LIVE" ? 2 : 2);
  const betScoreCalculation = calculateBetScoreWithTrace(timeCappedConfidence, dataQuality, estimatedProbability, uncertaintyAdjustedEdge, probability.uncertainty, market.risks.length, context.match.status);
  const rawBetScore = betScoreCalculation.score;
  const betScore = roundHalf(Math.min(rawBetScore, finalTimeConfidenceCap));
  const betScoreTrace = appendFinalBetScoreCapTrace(betScoreCalculation.trace, rawBetScore, betScore, finalTimeConfidenceCap);
  const baseDecision = decidePricedMarket(market, betScore, hasPositiveEdge, hasEnoughEvidence, dataQuality, probability.uncertainty, context.dataFreshness?.liveDataStale ?? false);
  const earlyValueWindow = isEarlyValueWindow(context, market, betScore, hasPositiveEdge, dataQuality, probability.uncertainty);
  const decision: NonNullable<AnalyzedMarket["decision"]> = baseDecision === "APUESTA RECOMENDADA"
    ? baseDecision
    : earlyValueWindow
    ? "VENTANA TEMPRANA DE VALOR"
    : baseDecision;
  const decisionBlockers = decisionBlockersForMarket({
    quote,
    requiresLine,
    exactLine,
    hasPositiveEdge,
    hasEnoughEvidence,
    dataQuality,
    uncertainty: probability.uncertainty,
      confidence: timeCappedConfidence,
    betScore,
    dataFreshness: context.dataFreshness ?? null
  });
  const oddsMovement = oddsMovementForMarket({ ...market, bookmaker: quote.bookmaker, odd: quote.price, line: exactLine, selection: exactSelection(market, quote, exactLine) }, context.match.oddsHistory);

  return {
    ...market,
    selection: exactSelection(market, quote, exactLine),
    confidence: betScore,
    statisticalScore: timeCappedConfidence,
    betScore,
    probabilityNote: probability.note,
    probabilityModel: probability.model,
    sampleSize: probability.sampleSize,
    rawRate: probability.rawRate,
    adjustedRate: probability.adjustedRate,
    uncertainty: probability.uncertainty,
    liveProbability: probability.liveProbability,
    prematchWeight: probability.prematchWeight,
    liveWeight: probability.liveWeight,
    concordanceScore: probability.concordanceScore,
    evidenceCoverage: probability.evidenceCoverage,
    liveAttackScore: probability.liveAttackScore,
    cumulativeAttackScore: probability.cumulativeAttackScore,
    recentMomentumScore: probability.recentMomentumScore,
    matchTrendScore: probability.matchTrendScore,
    matchTrendState: probability.matchTrendState,
    trendDirection: probability.matchTrendState,
    pressureStrength: probability.pressureStrength,
    goalPressureSignal: probability.goalPressureSignal,
    lambdaRemaining: probability.lambdaRemaining,
    remainingGoalProbabilities: probability.remainingGoalProbabilities,
    entryState: earlyValueWindow && decision !== "APUESTA RECOMENDADA" ? "WATCH_ENTRY" : entryStateForDecision(decision),
    entryStateDebug: entryStateDebug(context, probability, oddsMovement),
    statisticalOutlook: probability.statisticalOutlook,
    finalTimeDebug: finalizeTimeDebug(
      mergeTimeDebug(market.finalTimeDebug, probability.finalTimeDebug),
      qualityCappedConfidence,
      probability.finalTimeConfidenceCap,
      timeCappedConfidence,
      probability.estimatedProbability,
      betScore
    ),
    classification: classificationFromDecision(decision, betScore),
    decision,
    bookmaker: quote.bookmaker,
    odd: quote.price,
    line: exactLine,
    impliedProbability,
    estimatedProbability,
    edge,
    rawEdge,
    uncertaintyAdjustedEdge,
    decisionBlockers,
    betScoreTrace,
    discardReason: decision === "DESCARTAR" ? decisionBlockers[0]?.effect ?? discardReasonForMarket(hasPositiveEdge, hasEnoughEvidence, dataQuality, probability.uncertainty, timeCappedConfidence) : null,
    missingRequirements: [],
    dataQuality,
    marketDataQuality,
    oddsMovement,
    supportingData: [
      ...market.supportingData,
      ...probability.evidence,
      ...(earlyValueWindow ? ["VENTANA TEMPRANA DE VALOR: presión reciente acelera y la cuota todavía muestra edge ajustado positivo; falta confirmación para apuesta fuerte."] : []),
      `Cuota real: ${quote.price.toFixed(2)} en ${quote.bookmaker}.`,
      `Probabilidad implicita ${(impliedProbability * 100).toFixed(1)}%; estimacion no calibrada ${(estimatedProbability * 100).toFixed(1)}%; raw edge ${(rawEdge * 100).toFixed(1)}%; edge ajustado ${(uncertaintyAdjustedEdge * 100).toFixed(1)}%.`
    ].slice(0, 6),
    risks: [
      ...market.risks,
      ...dataGap.risks,
      ...(hasPositiveEdge ? [] : ["La cuota no muestra ventaja estadistica suficiente frente a la evidencia."]),
      ...(oddsMovement.warning ? [oddsMovement.warning] : []),
      ...(probability.uncertainty >= 0.28 ? ["Incertidumbre alta: muestra historica limitada o datos live incompletos."] : [])
    ].slice(0, 5)
  };
}

function markMarketDecision(market: AnalyzedMarket, decision: NonNullable<AnalyzedMarket["decision"]>, extraRisks: string[] = []): AnalyzedMarket {
  return {
    ...market,
    decision,
    entryState: entryStateForDecision(decision),
    classification: classificationFromDecision(decision, market.confidence),
    risks: [...market.risks, ...extraRisks]
  };
}

function entryStateForDecision(decision: NonNullable<AnalyzedMarket["decision"]>): NonNullable<AnalyzedMarket["entryState"]> {
  if (decision === "APUESTA RECOMENDADA") return "ENTER_NOW";
  if (decision === "VENTANA TEMPRANA DE VALOR") return "WATCH_ENTRY";
  if (decision === "INTERESANTE") return "WATCH";
  if (decision === "ESPERAR") return "WATCH";
  return "NO_ENTRY";
}

function entryStateDebug(
  context: MatchAnalysisContext,
  probability: ReturnType<typeof estimateMarketProbabilityFromEvidence>,
  oddsMovement: ReturnType<typeof oddsMovementForMarket> | null
): NonNullable<AnalyzedMarket["entryStateDebug"]> {
  const criticalEvents = context.match.events
    .filter((event) => context.match.minute === null || event.minute >= Math.max(0, context.match.minute - 5))
    .filter((event) => ["goal", "card", "penalty", "var", "injury", "substitution"].includes(event.type))
    .map((event) => `${event.minute}' ${event.title}`)
    .slice(0, 5);

  return {
    probabilityDelta: null,
    pressureDelta: null,
    timeDelta: probability.finalTimeConfidenceCap ?? null,
    scoreDelta: null,
    criticalEventsSinceLastAnalysis: criticalEvents.concat(oddsMovement?.warning ? [oddsMovement.warning] : [])
  };
}

function decidePricedMarket(market: AnalyzedMarket, confidence: number, hasPositiveEdge: boolean, hasEnoughEvidence: boolean, dataQuality: number, uncertainty = 0.35, liveDataStale = false): NonNullable<AnalyzedMarket["decision"]> {
  if (market.classification === "DESCARTAR") return "DESCARTAR";
  if (!hasEnoughEvidence) return "ESPERAR";
  if (liveDataStale) return confidence >= 6 ? "ESPERAR" : "DESCARTAR";
  if (confidence >= 8 && hasPositiveEdge && dataQuality >= 70 && uncertainty <= 0.27) return "APUESTA RECOMENDADA";
  if (confidence >= 7 && hasPositiveEdge) return "INTERESANTE";
  if (confidence >= 5) return "ESPERAR";
  return "DESCARTAR";
}

function isEarlyValueWindow(
  context: MatchAnalysisContext,
  market: AnalyzedMarket,
  betScore: number,
  hasPositiveEdge: boolean,
  dataQuality: number,
  uncertainty: number
) {
  if (context.match.status !== "LIVE") return false;
  if (!hasPositiveEdge || dataQuality < 65 || uncertainty > 0.32 || betScore < 6.5 || betScore >= 8) return false;
  if (context.dataFreshness?.liveDataStale) return false;
  const momentum = context.liveMomentum;
  if (!momentum) return false;
  const recent = momentum.recent.ten.isComplete ? momentum.recent.ten : momentum.recent.fifteen;
  if (!recent.isComplete || recent.dataState === "INSUFFICIENT_DATA" || recent.dataState === "INVALID_DATA") return false;
  const minute = context.match.minute ?? 0;
  const recentSot = recent.shotsOnTarget ?? 0;
  if (minute >= 70 && recentSot <= 0) return false;
  const recentCorners = recent.corners ?? 0;
  const recentDangerous = recent.dangerousAttacks ?? 0;
  const accelerating =
    momentum.matchTrendState === "SUBIENDO" ||
    momentum.goalPressureSignal === "VIGILAR" ||
    momentum.goalPressureSignal === "FUERTE" ||
    recentSot >= 2 ||
    recentCorners >= 2 ||
    recentDangerous >= 18;
  const marketText = `${market.market} ${market.selection}`.toLowerCase();
  const supportedMarket = marketText.includes("goles") || marketText.includes("corner") || marketText.includes("ambos");
  return accelerating && supportedMarket;
}

function liveLineupPlayerDataGap(context: MatchAnalysisContext) {
  if (context.match.status !== "LIVE") return { confidencePenalty: 0, risks: [] as string[] };
  const missingLineups = context.match.lineups.home.length === 0 && context.match.lineups.away.length === 0;
  const missingPlayers = context.match.playerStats.length === 0;
  const risks = [
    missingLineups ? "DATA_GAP: AllSportsApi no entrego alineaciones; requiere verificacion externa de XI/jugadores." : null,
    missingPlayers ? "DATA_GAP: AllSportsApi no entrego estadisticas individuales; requiere verificacion externa de jugadores en cancha." : null
  ].filter((item): item is string => Boolean(item));
  return { confidencePenalty: risks.length ? 0.3 : 0, risks };
}

function decisionBlockersForMarket(input: {
  quote: OddsQuote | undefined;
  requiresLine: boolean;
  exactLine: number | null;
  hasPositiveEdge: boolean;
  hasEnoughEvidence: boolean;
  dataQuality: number;
  uncertainty: number;
  confidence: number;
  betScore: number | null;
  dataFreshness: MatchAnalysisContext["dataFreshness"];
}): DecisionBlocker[] {
  const blockers: DecisionBlocker[] = [];
  if (!input.quote) {
    blockers.push({ rule: "REAL_ODDS_REQUIRED", value: null, threshold: "cuota real disponible", effect: "Sin cuota real no hay apuesta ejecutable." });
  }
  if (input.requiresLine && input.exactLine === null) {
    blockers.push({ rule: "LINE_REQUIRED", value: null, threshold: "linea compatible", effect: "El proveedor no entrego una linea compatible para este mercado." });
  }
  if (!input.hasEnoughEvidence) {
    blockers.push({ rule: "MIN_EVIDENCE", value: "insuficiente", threshold: "2 evidencias concretas", effect: "Evidencia estadistica insuficiente para entrada." });
  }
  if (input.dataFreshness?.liveDataStale) {
    blockers.push({
      rule: "LIVE_DATA_FRESHNESS",
      value: input.dataFreshness.providerAgeSeconds ?? input.dataFreshness.statsAgeSeconds,
      threshold: "provider <=180s y stats <=240s",
      effect: `LIVE DATA STALE: ${input.dataFreshness.staleReasons.join("; ")}.`
    });
  }
  if (input.dataQuality < 70) {
    blockers.push({ rule: "MARKET_DATA_QUALITY", value: input.dataQuality, threshold: 70, effect: "Calidad de datos del mercado por debajo del umbral." });
  }
  if (input.uncertainty > 0.27) {
    blockers.push({ rule: "UNCERTAINTY", value: Number(input.uncertainty.toFixed(3)), threshold: 0.27, effect: "Incertidumbre alta reduce el edge utilizable." });
  }
  if (!input.hasPositiveEdge) {
    blockers.push({ rule: "ADJUSTED_EDGE", value: "no positivo", threshold: ">= 0.05", effect: "Edge ajustado por incertidumbre insuficiente." });
  }
  if ((input.betScore ?? input.confidence) < 8) {
    blockers.push({ rule: "BET_SCORE", value: input.betScore ?? input.confidence, threshold: 8, effect: "Bet score final no alcanza entrada." });
  }
  return blockers;
}

function goalsNeededForMarket(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  const score = market.finalTimeDebug?.goalsNeeded;
  if (score !== null && score !== undefined) return score;
  return line === null ? null : undefined;
}

function eventNeededForMarket(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  if (text.includes("corner") || text.includes("tarjeta") || text.includes("remate")) return 1;
  return null;
}

function discardReasonForMarket(hasPositiveEdge: boolean, hasEnoughEvidence: boolean, dataQuality: number, uncertainty: number, confidence: number) {
  if (!hasEnoughEvidence) return "datos insuficientes";
  if (!hasPositiveEdge) return "edge ajustado por incertidumbre insuficiente";
  if (dataQuality < 70) return "calidad de datos insuficiente";
  if (uncertainty > 0.3) return "incertidumbre alta";
  if (confidence < 5) return "confidence bajo";
  return "no supera umbral de entrada";
}

function classificationFromDecision(decision: NonNullable<AnalyzedMarket["decision"]>, confidence: number): AnalyzedMarket["classification"] {
  if (decision === "APUESTA RECOMENDADA" && confidence >= 9) return "RESPALDO MUY FUERTE";
  if (decision === "APUESTA RECOMENDADA") return "RESPALDO FUERTE";
  if (decision === "VENTANA TEMPRANA DE VALOR") return "INTERESANTE";
  if (decision === "INTERESANTE") return "INTERESANTE";
  if (decision === "ESPERAR") return "VIGILAR";
  if (decision === "SIN APUESTA") return "DESCARTAR";
  return classify(confidence);
}

function finalizeTimeDebug(
  debug: AnalyzedMarket["finalTimeDebug"] | null | undefined,
  confidenceBeforeCap: number | null,
  timeCap: number | null,
  confidenceAfterCap: number,
  estimatedProbabilityAfterCap: number | null,
  confidenceRendered: number
): AnalyzedMarket["finalTimeDebug"] | undefined {
  if (!debug && timeCap === null) return undefined;
  return {
    minute: debug?.minute ?? null,
    stoppageTime: debug?.stoppageTime ?? null,
    remainingMinutes: debug?.remainingMinutes ?? null,
    goalsNeeded: debug?.goalsNeeded ?? null,
    confidenceBase: debug?.confidenceBase ?? confidenceBeforeCap,
    confidenceBeforeCap: debug?.confidenceBeforeCap ?? confidenceBeforeCap,
    timeCap,
    confidenceAfterTimeCap: debug?.confidenceAfterTimeCap ?? confidenceAfterCap,
    confidenceAfterCap: confidenceRendered,
    confidenceFinal: confidenceRendered,
    betScoreFinal: confidenceRendered,
    estimatedProbabilityBase: debug?.estimatedProbabilityBase ?? debug?.estimatedProbabilityBeforeCap ?? null,
    estimatedProbabilityFinal: debug?.estimatedProbabilityFinal ?? debug?.estimatedProbabilityAfterCap ?? estimatedProbabilityAfterCap,
    estimatedProbabilityBeforeCap: debug?.estimatedProbabilityBeforeCap ?? null,
    estimatedProbabilityAfterCap: debug?.estimatedProbabilityAfterCap ?? estimatedProbabilityAfterCap,
    confidenceRendered
  };
}

function mergeTimeDebug(
  lineDebug: AnalyzedMarket["finalTimeDebug"] | null | undefined,
  probabilityDebug: AnalyzedMarket["finalTimeDebug"] | null | undefined
): AnalyzedMarket["finalTimeDebug"] | null | undefined {
  if (!lineDebug) return probabilityDebug;
  if (!probabilityDebug) return lineDebug;
  return {
    ...lineDebug,
    ...probabilityDebug,
    confidenceBase: lineDebug.confidenceBase ?? probabilityDebug.confidenceBase ?? null,
    confidenceBeforeCap: lineDebug.confidenceBeforeCap ?? probabilityDebug.confidenceBeforeCap,
    confidenceAfterTimeCap: lineDebug.confidenceAfterTimeCap ?? probabilityDebug.confidenceAfterTimeCap ?? null
  };
}

function marketRequiresLine(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  return ["over", "under", "goles", "corner", "tarjeta", "remate"].some((term) => text.includes(term)) && !text.includes("ambos");
}

function quotePriority(market: AnalyzedMarket, quote: OddsQuote, requiredLine: number | null) {
  const quoteLine = extractLine(`${quote.market} ${quote.selection}`);
  const lineDistance = requiredLine !== null && quoteLine !== null ? Math.abs(quoteLine - requiredLine) : 0;
  const liveBonus = quote.minute !== null ? -0.25 : 0;
  const sanePricePenalty = quote.price >= 5 ? 1 : quote.price < 1.2 ? 1 : 0;
  return lineDistance + liveBonus + sanePricePenalty + (market.decision === "SIN APUESTA" ? 0.5 : 0);
}

function exactSelection(market: AnalyzedMarket, quote: OddsQuote, line: number | null) {
  if (line !== null && marketRequiresLine(market)) {
    const periodLabel = market.marketPeriod === "FIRST_HALF" ? " 1T" : "";
    if (market.market.toLowerCase().includes("corner")) return `Mas de ${line} corners`;
    if (market.market.toLowerCase().includes("tarjeta")) return `Mas de ${line} tarjetas`;
    if (market.market.toLowerCase().includes("remate")) return `Mas de ${line} remates`;
    if (market.market.toLowerCase().includes("goles por equipo")) return `${market.selection.split(" mas ")[0]} mas de ${line}`;
    if (market.selection.toLowerCase().includes("under") || market.selection.toLowerCase().includes("menos")) return `Under ${line} goles${periodLabel}`;
    return `Over ${line} goles${periodLabel}`;
  }
  return quote.selection || market.selection;
}

function extractLine(text: string) {
  const normalized = text.replace(",", ".");
  const match = normalized.match(/(?:\b|\+)(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizeLoose(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function estimateProbability(confidence: number, status: MatchDetail["status"]) {
  const base = Math.max(0.1, Math.min(0.9, confidence / 10));
  return status === "LIVE" ? Math.max(0.08, base - 0.03) : base;
}

function roundProbability(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function estimateLiveRemainingTime(match: Pick<MatchDetail, "status" | "minute">) {
  if (match.status !== "LIVE" || match.minute === null) {
    return { estimatedMinutes: null, label: "N/D", isStoppageUnknown: false };
  }

  if (match.minute < 90) {
    const estimatedMinutes = Math.max(0, 90 - match.minute);
    return { estimatedMinutes, label: `quedan aprox. ${estimatedMinutes} min + añadido`, isStoppageUnknown: false };
  }

  const addedMinute = match.minute > 90 ? match.minute - 90 : null;
  const addedTotal = (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).stoppageTime
    ?? (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).addedTime
    ?? (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).extraTime
    ?? null;

  if (addedMinute !== null && addedTotal !== null && Number.isFinite(addedTotal)) {
    const estimatedMinutes = Math.max(0, addedTotal - addedMinute);
    return { estimatedMinutes, label: `~${estimatedMinutes} min restantes`, isStoppageUnknown: false };
  }

  return {
    estimatedMinutes: null,
    label: addedMinute !== null ? `90+${addedMinute} · solo añadido · restante desconocido` : "solo añadido · restante desconocido",
    isStoppageUnknown: true
  };
}

function remainingMinutesForMarket(match: Pick<MatchDetail, "status" | "minute">, marketPeriod: AnalyzedMarket["marketPeriod"]) {
  if (match.status !== "LIVE" || match.minute === null) return null;
  if (marketPeriod === "FIRST_HALF") return Math.max(0, 45 - match.minute);
  return estimateLiveRemainingTime(match).estimatedMinutes;
}

function estimateMarketProbability(market: AnalyzedMarket, context: MatchAnalysisContext, score: number) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const scoreComponent = Math.max(0.18, Math.min(0.82, 0.28 + score * 0.045));
  const status = context.match.status;
  let adjustment = 0;

  if (status === "LIVE") {
    const minute = context.match.minute ?? 0;
    const remaining = estimateLiveRemainingTime(context.match).estimatedMinutes ?? Math.max(0, 90 - minute);
    if (text.includes("over") || text.includes("mas")) {
      adjustment += Math.min(0.08, remaining / 900);
      if (minute >= 75) adjustment -= 0.1;
      else if (minute >= 60) adjustment -= 0.05;
    }
    if (text.includes("under")) {
      adjustment += minute >= 75 ? 0.08 : minute >= 60 ? 0.04 : 0;
    }
    if (text.includes("ambos")) {
      adjustment -= minute >= 75 ? 0.08 : minute >= 60 ? 0.04 : 0;
    }
  }

  if (text.includes("1x2")) adjustment -= 0.08;
  if (text.includes("doble")) adjustment += 0.05;
  return Math.max(0.05, Math.min(0.9, scoreComponent + adjustment));
}

function calculateBetScore(statisticalScore: number, dataQuality: number, estimatedProbability: number, edge: number, uncertainty: number, riskCount: number, status: MatchDetail["status"]) {
  return calculateBetScoreWithTrace(statisticalScore, dataQuality, estimatedProbability, edge, uncertainty, riskCount, status).score;
}

function calculateBetScoreWithTrace(statisticalScore: number, dataQuality: number, estimatedProbability: number, edge: number, uncertainty: number, riskCount: number, status: MatchDetail["status"]) {
  const trace: BetScoreTraceStep[] = [];
  let running = 0;
  const add = (rule: string, delta: number, reason: string) => {
    const before = roundTraceNumber(running);
    running += delta;
    trace.push({ rule, before, delta: roundTraceNumber(delta), after: roundTraceNumber(running), reason });
  };

  const statisticalPart = statisticalScore * 0.35;
  add("STATISTICAL_SCORE", statisticalPart, `statisticalScore ${statisticalScore.toFixed(1)} * 0.35`);

  const probabilityPart = estimatedProbability * 10 * 0.2;
  add("ESTIMATED_PROBABILITY", probabilityPart, `estimatedProbability ${(estimatedProbability * 100).toFixed(1)}% * 10 * 0.20`);

  const qualityPart = Math.min(10, dataQuality / 10) * 0.2;
  add("DATA_QUALITY", qualityPart, `min(10, dataQuality ${dataQuality.toFixed(1)} / 10) * 0.20`);

  const edgePart = Math.max(-2, Math.min(2, edge * 30)) * 0.2;
  add("UNCERTAINTY_ADJUSTED_EDGE", edgePart, `clamp(edge ajustado ${(edge * 100).toFixed(1)}pp * 30, -2..2) * 0.20`);

  const uncertaintyPenalty = Math.min(2.2, uncertainty * 5);
  add("UNCERTAINTY_PENALTY", -uncertaintyPenalty, `min(2.2, uncertainty ${uncertainty.toFixed(3)} * 5)`);

  const contextPenalty = (status === "LIVE" ? 0.2 : 0) + Math.min(0.9, riskCount * 0.12);
  add("CONTEXT_AND_RISK_PENALTY", -contextPenalty, `LIVE penalty ${status === "LIVE" ? "0.20" : "0.00"} + riskCount ${riskCount} * 0.12 capped at 0.90`);

  const raw = statisticalPart + probabilityPart + qualityPart + edgePart - uncertaintyPenalty - contextPenalty;
  const capped = dataQuality < 70 || uncertainty > 0.3 || edge < 0.05 ? Math.min(raw, 7.9) : raw;
  if (capped !== raw) {
    trace.push({
      rule: "QUALITY_EDGE_UNCERTAINTY_CAP",
      before: roundTraceNumber(raw),
      delta: roundTraceNumber(capped - raw),
      after: roundTraceNumber(capped),
      reason: `Cap 7.9 si dataQuality <70, uncertainty >0.30 o edge ajustado <5pp. Valores: ${dataQuality.toFixed(1)}, ${uncertainty.toFixed(3)}, ${(edge * 100).toFixed(1)}pp.`
    });
  }

  const clamped = Math.max(1, Math.min(10, capped));
  if (clamped !== capped) {
    trace.push({
      rule: "BET_SCORE_RANGE_CLAMP",
      before: roundTraceNumber(capped),
      delta: roundTraceNumber(clamped - capped),
      after: roundTraceNumber(clamped),
      reason: "El betScore se limita al rango 1..10."
    });
  }

  const rounded = roundHalf(clamped);
  if (rounded !== clamped) {
    trace.push({
      rule: "ROUND_HALF",
      before: roundTraceNumber(clamped),
      delta: roundTraceNumber(rounded - clamped),
      after: rounded,
      reason: "Redondeo final a pasos de 0.5."
    });
  }

  return { score: rounded, trace };
}

function appendFinalBetScoreCapTrace(trace: BetScoreTraceStep[], rawBetScore: number, betScore: number, finalTimeConfidenceCap: number) {
  if (betScore === rawBetScore) return trace;
  return [
    ...trace,
    {
      rule: "FINAL_TIME_GUARDRAIL",
      before: rawBetScore,
      delta: roundTraceNumber(betScore - rawBetScore),
      after: betScore,
      reason: `Cap temporal final aplicado despues de la fusion/modelo. timeCap=${finalTimeConfidenceCap}.`
    }
  ];
}

function roundTraceNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}

function analyzeGoalMarkets(context: MatchAnalysisContext): AnalyzedMarket[] {
  const fullMatch = [
    analyzeGoalLine(context, "over", 0.5),
    analyzeGoalLine(context, "over", 1.5),
    analyzeGoalLine(context, "over", 2.5),
    analyzeGoalLine(context, "over", 3.5),
    analyzeGoalLine(context, "under", 2.5)
  ];
  const firstHalf = [
    analyzeGoalLine(context, "over", 0.5, "FIRST_HALF"),
    analyzeGoalLine(context, "over", 1.5, "FIRST_HALF"),
    analyzeGoalLine(context, "over", 2.5, "FIRST_HALF")
  ];
  return [...fullMatch, ...firstHalf].filter((item): item is AnalyzedMarket => Boolean(item));
}

function analyzeBothTeamsScoreMarkets(context: MatchAnalysisContext): AnalyzedMarket[] {
  return [analyzeBothTeamsScore(context, "Si"), analyzeBothTeamsScore(context, "No")].filter((item): item is AnalyzedMarket => Boolean(item));
}

function analyzeBothTeamsScore(context: MatchAnalysisContext, selection: "Si" | "No"): AnalyzedMarket | null {
  if (context.match.status === "LIVE" && !hasLiveAttackingEvidence(context.match)) return null;
  const critical = bttsCriticalPenalty(context.match);
  const homeScored = rate(context.recentHome.map((match) => teamGoals(match, sideForTeam(match, context.match.homeTeam)) > 0));
  const awayScored = rate(context.recentAway.map((match) => teamGoals(match, sideForTeam(match, context.match.awayTeam)) > 0));
  const combined = homeScored !== null && awayScored !== null ? (homeScored + awayScored) / 2 : null;
  const evidence = compact([
    homeScored !== null ? `${context.match.homeTeam} marco en ${(homeScored * 100).toFixed(0)}% de recientes.` : null,
    awayScored !== null ? `${context.match.awayTeam} marco en ${(awayScored * 100).toFixed(0)}% de recientes.` : null,
    context.match.status === "LIVE" ? redCardAnalysisSummary(context.match) : null,
    critical?.supportingData ?? null
  ]);
  const baseScore = weightedBttsScore(context, selection, homeScored, awayScored, combined);
  const score = critical ? Math.min(critical.maxConfidence, Math.max(1, baseScore - critical.penalty)) : baseScore;
  return makeMarket(
    "Ambos marcan",
    selection,
    score,
    evidence,
    [
      "Una alineacion alternativa o planteo conservador reduce respaldo.",
      ...(critical?.risks ?? [])
    ],
    critical?.improvements ?? [],
    { dataQuality: dataQualityForContext(context) }
  );
}

function weightedBttsScore(context: MatchAnalysisContext, selection: "Si" | "No", homeScored: number | null, awayScored: number | null, combined: number | null) {
  const match = context.match;
  const baseRate = selection === "Si" ? combined : combined === null ? null : 1 - combined;
  const liveSot = match.status === "LIVE" ? sumStat(match.stats, "shotsOnTarget") : null;
  const liveXg = match.status === "LIVE" ? sumStat(match.stats, "xg") : null;
  const livePenalty = match.status === "LIVE" && match.minute !== null && match.minute >= 70 ? 0.8 : 0;
  const historical = ratioScore(baseRate) * (match.status === "LIVE" ? 0.05 : 0.45);
  const teamBalance = ratioScore(homeScored !== null && awayScored !== null ? 1 - Math.abs(homeScored - awayScored) : null) * 0.15;
  const live = match.status === "LIVE" ? (componentScore(liveSot, 6) * 0.25 + componentScore(liveXg, 1.8) * 0.2) : 0;
  const lineup = (match.lineups.home.length && match.lineups.away.length ? 7 : 4) * (match.status === "LIVE" ? 0.05 : 0.15);
  const score = historical + teamBalance + live + lineup - livePenalty;
  return Math.max(1, Math.min(8.8, score));
}

function analyzeGoalLine(context: MatchAnalysisContext, direction: "over" | "under", line: number, marketPeriod: AnalyzedMarket["marketPeriod"] = "FULL_MATCH"): AnalyzedMarket | null {
  const match = context.match;
  const isLive = match.status === "LIVE";
  if (marketPeriod === "FIRST_HALF" && isLive && (match.minute ?? 0) >= 45) return null;
  const currentGoals = isLive ? totalGoals(match) : 0;
  const goalsNeeded = Math.max(0, Math.floor(line + 0.5) - currentGoals);

  const minute = match.minute;
  const remainingTime = estimateLiveRemainingTime(match);
  const remaining = isLive ? remainingMinutesForMarket(match, marketPeriod) : remainingTime.estimatedMinutes;
  const periodLabel = marketPeriod === "FIRST_HALF" ? " 1T" : "";
  const recentGoals = avg([...context.recentHome, ...context.recentAway].map(totalGoals));
  const h2hGoals = avg(context.h2h.map(totalGoals));
  const historicalRate = rate([...context.recentHome, ...context.recentAway].map((item) => direction === "over" ? totalGoals(item) > line : totalGoals(item) <= line));
  const h2hRate = rate(context.h2h.map((item) => direction === "over" ? totalGoals(item) > line : totalGoals(item) <= line));
  const shots = isLive ? sumStat(match.stats, "shots") : null;
  const shotsOffTarget = isLive ? sumStat(match.stats, "shotsOffTarget") : null;
  const sot = isLive ? sumStat(match.stats, "shotsOnTarget") : null;
  const xg = isLive ? sumStat(match.stats, "xg") : null;
  const corners = isLive ? sumStat(match.stats, "corners") : null;
  const attacks = isLive ? sumStat(match.stats, "attacks") : null;
  const dangerous = isLive ? sumStat(match.stats, "dangerousAttacks") : null;
  const cards = isLive ? sumStat(match.stats, "yellowCards") : null;
  const reds = isLive ? sumStat(match.stats, "redCards") : null;

  let score = 2.5;
  const supportingData: string[] = isLive
    ? [`Marcador actual ${match.score.home}-${match.score.away}; faltan ${goalsNeeded} gol(es) para ${direction === "over" ? "over" : "under"} ${line}${periodLabel}.`]
    : [`Prepartido: evaluacion historica para ${direction === "over" ? "Over" : "Under"} ${line}${periodLabel}.`];
  const periodEvidence = direction === "over" ? periodGoalHistoryEvidence(context) : null;
  if (periodEvidence) supportingData.push(periodEvidence);
  const risks: string[] = [];
  const improvements: string[] = [];

  if (isLive) {
    score += 0.8;
    if (remaining !== null) {
      const timeScore = goalsNeeded === 1 ? Math.min(2.2, remaining / 18) : Math.min(1.3, remaining / 35);
      score += timeScore;
      supportingData.push(`Tiempo restante del mercado: ${remaining} min${marketPeriod === "FIRST_HALF" ? " hasta HT" : " + añadido"}.`);
      if (remaining < 20 || remainingTime.isStoppageUnknown) risks.push("Minuto avanzado reduce margen para otro gol.");
    }
  }

  if (sot !== null) {
    score += Math.min(2.2, sot * 0.25);
    supportingData.push(`Tiros al arco combinados: ${sot}.`);
  } else if (isLive) {
    risks.push("Tiros al arco live N/D.");
    improvements.push("Confirmar tiros al arco o ocasiones claras en el siguiente refresh.");
  }

  if (shots !== null) {
    score += Math.min(1.4, shots * 0.08);
    supportingData.push(`Remates combinados: ${shots}.`);
  } else if (isLive) {
    risks.push("Remates totales N/D.");
  }

  if (shotsOffTarget !== null) {
    supportingData.push(`Remates desviados: ${shotsOffTarget} (evidencia parcial, no equivale a remate claro).`);
  }

  if (xg !== null) {
    score += Math.min(1.4, xg * 0.8);
    supportingData.push(`xG combinado: ${xg.toFixed(2)}.`);
  } else if (isLive) {
    risks.push("xG live N/D.");
  }

  if (corners !== null) {
    score += Math.min(0.9, corners * 0.14);
    supportingData.push(`Corners live: ${corners}.`);
  }

  if (dangerous !== null) {
    score += Math.min(0.9, dangerous / 55);
    supportingData.push(`Ataques peligrosos: ${dangerous}.`);
  }

  if (attacks !== null) {
    supportingData.push(`Ataques totales: ${attacks}.`);
  }

  if (recentGoals !== null) {
    score += Math.min(1.1, recentGoals / 3);
    supportingData.push(`Promedio reciente combinado: ${recentGoals.toFixed(2)} goles.`);
  }

  if (historicalRate !== null) {
    score += Math.min(1.3, historicalRate * 1.3);
    supportingData.push(`Forma reciente cumple ${direction === "over" ? "Over" : "Under"} ${line}${periodLabel} en ${(historicalRate * 100).toFixed(0)}%.`);
  }

  if (h2hGoals !== null) {
    score += Math.min(0.8, h2hGoals / 3.5);
    supportingData.push(`H2H: ${h2hGoals.toFixed(2)} goles promedio.`);
  }

  if (h2hRate !== null) {
    score += Math.min(0.8, h2hRate * 0.8);
    supportingData.push(`H2H cumple ${direction === "over" ? "Over" : "Under"} ${line}${periodLabel} en ${(h2hRate * 100).toFixed(0)}%.`);
  }

  if ((reds ?? 0) > 0) risks.push("Roja activa puede alterar el ritmo de forma no lineal.");
  if ((cards ?? 0) >= 4) supportingData.push(`Partido con tensión disciplinaria: ${cards} amarillas.`);
  if (direction === "over" && goalsNeeded >= 2) {
    score -= 0.8 * (goalsNeeded - 1);
    risks.push(`La linea exige ${goalsNeeded} goles adicionales.`);
  }

  const weightedScore = weightedGoalLineScore(context, direction, line, {
    goalsNeeded,
    remaining,
    historicalRate,
    h2hRate,
    recentGoals,
    shots,
    shotsOffTarget,
    sot,
    xg,
    corners,
    attacks,
    dangerous,
    reds
  });
  const timeCap = direction === "over" ? liveGoalTimeCap(match.status, goalsNeeded, remaining, match.minute) : 10;
  const confidenceBeforeCap = roundHalf(Math.max(1, Math.min(10, weightedScore)));
  const confidence = roundHalf(Math.max(1, Math.min(timeCap, weightedScore)));
  return makeMarket("Over/Under goles", `${direction === "over" ? "Over" : "Under"} ${line} goles${periodLabel}`, confidence, supportingData.slice(0, 6), risks.slice(0, 4), improvements, {
    line,
    marketPeriod,
    remainingMarketMinutes: remaining,
    dataQuality: dataQualityForContext(context),
    finalTimeDebug: isLive && direction === "over"
      ? {
          minute: match.minute,
          stoppageTime: null,
          remainingMinutes: remaining,
          goalsNeeded,
          confidenceBase: confidenceBeforeCap,
          confidenceBeforeCap,
          timeCap,
          confidenceAfterTimeCap: confidence,
          confidenceAfterCap: confidence,
          confidenceFinal: confidence,
          betScoreFinal: null,
          estimatedProbabilityBase: null,
          estimatedProbabilityFinal: null,
          estimatedProbabilityBeforeCap: null,
          estimatedProbabilityAfterCap: null,
          confidenceRendered: confidence
        }
      : undefined
  });
}

export function classifyLiveMarketStatus(match: Pick<MatchDetail, "status" | "score" | "minute"> & Partial<Pick<MatchDetail, "stats" | "homeTeam" | "awayTeam" | "playerStats">>, market: Pick<AnalyzedMarket, "market" | "selection" | "line">): MarketStatus {
  if (match.status !== "LIVE") return match.status === "FINISHED" ? "UNRESOLVED" : "OPEN";
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const goals = match.score.home + match.score.away;
  const line = market.line ?? extractLine(text);
  const goalDirection = goalDirectionFromText(market.selection) ?? goalDirectionFromText(text);

  if (text.includes("ambos")) {
    const homeScored = match.score.home > 0;
    const awayScored = match.score.away > 0;
    const wantsNo = /\b(no)\b/.test(text);
    if (homeScored && awayScored) return wantsNo ? "LOST" : "WON";
    return "OPEN";
  }

  if (line !== null && goalDirection === "over") {
    const targetGoals = Math.floor(line) + 1;
    return goals >= targetGoals ? "WON" : "OPEN";
  }

  if (line !== null && goalDirection === "under") {
    return goals > line ? "LOST" : "OPEN";
  }

  if (line !== null && match.stats && text.includes("corner")) {
    return cumulativeLineStatus(sumStat(match.stats, "corners"), line, text);
  }

  if (line !== null && match.stats && text.includes("tarjeta")) {
    const cards = sumStat(match.stats, "yellowCards");
    const reds = sumStat(match.stats, "redCards");
    const totalCards = cards === null && reds === null ? null : (cards ?? 0) + (reds ?? 0);
    return cumulativeLineStatus(totalCards, line, text);
  }

  if (line !== null && match.stats && text.includes("remate") && !text.includes("jugador")) {
    return cumulativeLineStatus(sumStat(match.stats, "shots"), line, text);
  }

  if (line !== null && match.playerStats && text.includes("remate")) {
    const playerName = market.selection.toLowerCase().replace(/remates?.*/, "").trim();
    const player = match.playerStats.find((item) => item.player.toLowerCase().includes(playerName));
    return cumulativeLineStatus(player?.shots ?? null, line, text);
  }

  return "OPEN";
}

function cumulativeLineStatus(value: number | null, line: number, text: string): MarketStatus {
  if (value === null) return "UNRESOLVED";
  const direction = goalDirectionFromText(text) ?? "over";
  if (direction === "under") return value > line ? "LOST" : "OPEN";
  return value > line ? "WON" : "OPEN";
}

function goalDirectionFromText(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(under|menos|u\+)\b/.test(normalized)) return "under" as const;
  if (/\b(over|mas|más|o\+)\b/.test(normalized)) return "over" as const;
  return null;
}

function applyLiveMarketStatus(context: MatchAnalysisContext, market: AnalyzedMarket): AnalyzedMarket {
  if (context.match.status !== "LIVE") return market;
  const marketStatus = classifyLiveMarketStatus(context.match, market);
  if (isOpenMarket({ marketStatus })) {
    return { ...market, marketStatus, supportingData: [...market.supportingData, `Estado mercado: OPEN. ${estimateLiveRemainingTime(context.match).label}.`].slice(0, 6) };
  }
  return {
    ...market,
    marketStatus,
    confidence: 0,
    statisticalScore: 0,
    betScore: 0,
    finalTimeDebug: undefined,
    decision: "DESCARTAR",
    classification: "DESCARTAR",
    supportingData: [...market.supportingData, `Mercado ya resuelto: ${marketStatus}.`].slice(0, 6),
    risks: [`No recomendar: la seleccion esta ${marketStatus}.`, ...market.risks].slice(0, 5)
  };
}

function isOpenMarket(market: Pick<AnalyzedMarket, "marketStatus">) {
  return !market.marketStatus || market.marketStatus === "OPEN" || market.marketStatus === "PENDING";
}

function weightedGoalLineScore(
  context: MatchAnalysisContext,
  direction: "over" | "under",
  line: number,
  values: {
    goalsNeeded: number;
    remaining: number | null;
    historicalRate: number | null;
    h2hRate: number | null;
    recentGoals: number | null;
    shots: number | null;
    shotsOffTarget: number | null;
    sot: number | null;
    xg: number | null;
    corners: number | null;
    attacks: number | null;
    dangerous: number | null;
    reds: number | null;
  }
) {
  if (context.match.status === "LIVE") {
    return weightedLiveGoalScore(context, direction, values);
  }
  return weightedPrematchGoalScore(context, direction, line, values);
}

function periodGoalHistoryEvidence(context: MatchAnalysisContext) {
  const samples = [...context.recentHome, ...context.recentAway].filter((match) => match.status === "FINISHED");
  if (samples.length < 5) return null;
  const currentMinute = context.match.minute ?? 0;
  const period = currentMinute >= 76 ? [76, 130, "76-90+"] as const
    : currentMinute >= 61 ? [61, 75, "61-75"] as const
    : currentMinute >= 46 ? [46, 60, "46-60"] as const
    : currentMinute >= 31 ? [31, 45, "31-45+"] as const
    : currentMinute >= 16 ? [16, 30, "16-30"] as const
    : [0, 15, "0-15"] as const;
  const [start, end, label] = period;
  const goalMatches = samples.filter((sample) => sample.events.some((event) => event.type === "goal" && event.minute >= start && event.minute <= end));
  const lateAfter75 = samples.filter((sample) => sample.events.some((event) => event.type === "goal" && event.minute >= 75));
  return `Histórico por periodo: gol en ${label} en ${Math.round(goalMatches.length / samples.length * 100)}%; gol tardío 75+ en ${Math.round(lateAfter75.length / samples.length * 100)}%.`;
}

function weightedPrematchGoalScore(context: MatchAnalysisContext, direction: "over" | "under", line: number, values: { historicalRate: number | null; h2hRate: number | null; recentGoals: number | null }) {
  const homeVenue = context.recentHome.filter((match) => sideForTeam(match, context.match.homeTeam) === "home");
  const awayVenue = context.recentAway.filter((match) => sideForTeam(match, context.match.awayTeam) === "away");
  const historicalMatches = [...homeVenue, ...awayVenue, ...context.recentHome, ...context.recentAway];
  const venueRate = rate([...homeVenue, ...awayVenue].map((item) => direction === "over" ? totalGoals(item) > line : totalGoals(item) <= line));
  const goalsForAgainst = avg([
    avg(context.recentHome.map((match) => teamGoals(match, sideForTeam(match, context.match.homeTeam)))),
    avg(context.recentHome.map((match) => opponentGoals(match, context.match.homeTeam))),
    avg(context.recentAway.map((match) => teamGoals(match, sideForTeam(match, context.match.awayTeam)))),
    avg(context.recentAway.map((match) => opponentGoals(match, context.match.awayTeam)))
  ]);
  const xgForAgainst = avg([
    avg(context.recentHome.map((match) => teamStat(match, context.match.homeTeam, "xg"))),
    avg(context.recentAway.map((match) => teamStat(match, context.match.awayTeam, "xg"))),
    avg(context.recentHome.map((match) => opponentStat(match, context.match.homeTeam, "xg"))),
    avg(context.recentAway.map((match) => opponentStat(match, context.match.awayTeam, "xg")))
  ]);
  const shotVolume = avg(historicalMatches.map((match) => sumStat(match.stats, "shots")));
  const sotVolume = avg(historicalMatches.map((match) => sumStat(match.stats, "shotsOnTarget")));
  const lineupScore = context.match.lineups.home.length + context.match.lineups.away.length >= 18 ? 7 : context.match.lineups.home.length + context.match.lineups.away.length > 0 ? 5 : 3.5;
  const contextScore = /champions|europa|libertadores|sudamericana|cup|copa/i.test(context.match.competition) ? 5.5 : 5;
  const otherData = dataQualityForContext(context) / 10;
  const components = [
    weightedComponent(componentScore(values.recentGoals, 3.2), 0.12, values.recentGoals),
    weightedComponent(ratioScore(venueRate), 0.14, venueRate),
    weightedComponent(componentScore(goalsForAgainst, 2.6), 0.16, goalsForAgainst),
    weightedComponent(ratioScore(values.historicalRate), 0.13, values.historicalRate),
    weightedComponent(ratioScore(values.h2hRate), 0.08, values.h2hRate),
    weightedComponent(componentScore(xgForAgainst, 2.2), 0.12, xgForAgainst),
    weightedComponent(componentScore(shotVolume, 22), 0.09, shotVolume),
    weightedComponent(componentScore(sotVolume, 8), 0.08, sotVolume),
    { score: lineupScore, weight: 0.08 },
    { score: contextScore, weight: 0.04 },
    { score: otherData, weight: 0.06 }
  ].filter((item): item is { score: number; weight: number } => Boolean(item));
  const totalWeight = components.reduce((total, item) => total + item.weight, 0) || 1;
  const score = components.reduce((total, item) => total + item.score * item.weight, 0) / totalWeight;
  return Math.min(9.2, Math.max(1, score));
}

function weightedLiveGoalScore(context: MatchAnalysisContext, direction: "over" | "under", values: { goalsNeeded: number; remaining: number | null; shots: number | null; shotsOffTarget: number | null; sot: number | null; xg: number | null; corners: number | null; attacks: number | null; dangerous: number | null; reds: number | null; historicalRate: number | null }) {
  const remaining = values.remaining ?? 45;
  const minute = context.match.minute ?? 0;
  const momentum = context.liveMomentum;
  const timeNeedScore = direction === "under"
    ? Math.min(9, 4 + minute / 15)
    : Math.max(1, Math.min(9, (remaining / 9) - Math.max(0, values.goalsNeeded - 1) * 2));
  const xgScore = componentScore(values.xg, 2.1);
  const sotScore = componentScore(values.sot, 7);
  const partialAttemptScore = componentScore(values.shotsOffTarget, 14);
  const attacksScore = componentScore(values.attacks, 100);
  const rhythm = momentum ? momentum.recentMomentumScore / 10 : recentLiveRhythmScore(context);
  const cumulative = momentum ? momentum.cumulativeAttackScore / 10 : avg([componentScore(values.shots, 22), componentScore(values.sot, 7), componentScore(values.xg, 2.1)]) ?? 4;
  const trendScore = momentum ? momentum.matchTrendScore / 10 : 5;
  const trendAdjustment = momentum?.matchTrendState === "SUBIENDO" ? 0.35 : momentum?.matchTrendState === "CAYENDO" ? -0.55 : 0;
  const eventScore = values.goalsNeeded <= 1 ? 6 : 4;
  const pressureScore = avg([componentScore(values.corners, 7), componentScore(values.dangerous, 55)]) ?? 4;
  const redScore = (values.reds ?? 0) > 0 ? 3.5 : 6;
  const historicalWeight = liveHistoricalWeight(minute) * 0.2;
  const minuteWeights = liveTemporalWeights(minute);
  const score =
    timeNeedScore * 0.18 +
    xgScore * 0.1 +
    sotScore * 0.1 +
    partialAttemptScore * 0.04 +
    attacksScore * 0.03 +
    cumulative * minuteWeights.cumulative +
    Math.min(10, rhythm) * minuteWeights.recent +
    trendScore * minuteWeights.trend +
    eventScore * 0.1 +
    pressureScore * 0.08 +
    redScore * 0.1 +
    ratioScore(values.historicalRate) * historicalWeight +
    trendAdjustment;
  return Math.min(9, Math.max(1, score));
}

function liveTemporalWeights(minute: number) {
  if (minute >= 85) return { cumulative: 0.04, recent: 0.22, trend: 0.12 };
  if (minute >= 76) return { cumulative: 0.07, recent: 0.2, trend: 0.1 };
  if (minute >= 61) return { cumulative: 0.11, recent: 0.17, trend: 0.08 };
  if (minute >= 31) return { cumulative: 0.14, recent: 0.14, trend: 0.07 };
  return { cumulative: 0.17, recent: 0.1, trend: 0.05 };
}

function recentLiveRhythmScore(context: MatchAnalysisContext) {
  const trend = context.liveSnapshotTrend;
  if (!trend?.available) return 3.5;
  const five = avg([componentScore(trend.five.shots, 3), componentScore(trend.five.shotsOnTarget, 1), componentScore(trend.five.xg, 0.3)]) ?? 3.5;
  const ten = avg([componentScore(trend.ten.shots, 5), componentScore(trend.ten.shotsOnTarget, 2), componentScore(trend.ten.xg, 0.45), componentScore(trend.ten.corners, 2), componentScore(trend.ten.dangerousAttacks, 12)]) ?? 3.5;
  const fifteen = avg([componentScore(trend.fifteen.shots, 7), componentScore(trend.fifteen.shotsOnTarget, 3), componentScore(trend.fifteen.xg, 0.7)]) ?? 3.5;
  const eventBoost = (trend.ten.goals ?? 0) > 0 ? -0.8 : 0;
  const redPenalty = (trend.ten.cards ?? 0) > 0 ? -0.3 : 0;
  return Math.max(1, Math.min(10, five * 0.45 + ten * 0.35 + fifteen * 0.2 + eventBoost + redPenalty));
}

function bttsCriticalPenalty(match: MatchDetail) {
  if (match.status !== "LIVE") return null;
  const minute = match.minute ?? 0;
  const sidesNeedingGoal: TeamSide[] = [];
  if (match.score.home === 0) sidesNeedingGoal.push("home");
  if (match.score.away === 0) sidesNeedingGoal.push("away");
  if (!sidesNeedingGoal.length) return null;

  const issues = sidesNeedingGoal.flatMap((side) => offensiveCriticalIssues(match, side));
  if (!issues.length) return null;

  const scoringIssues = issues.filter((issue) => issue.penalty > 0);
  if (!scoringIssues.length) return null;

  const hasRedAndZeroSotLate = scoringIssues.some((issue) => issue.code === "RED_ZERO_SOT_LATE");
  const lateThreeGoalDeficit = scoringIssues.some((issue) => issue.code === "THREE_GOAL_DEFICIT_LATE");
  const penalty = scoringIssues.reduce((total, issue) => total + issue.penalty, 0);
  const maxConfidence = hasRedAndZeroSotLate ? 2 : lateThreeGoalDeficit ? 3 : 4;

  return {
    penalty,
    maxConfidence,
    supportingData: `Evento critico detectado: ${scoringIssues.map((issue) => issue.label).join("; ")}.`,
    risks: scoringIssues.map((issue) => issue.risk),
    improvements: [
      "Para mejorar: el equipo que necesita marcar debe generar tiros al arco u ocasiones claras reales.",
      "Para mejorar: reducción visible del dominio rival o cambio ofensivo efectivo.",
      "DESCARTAR si sigue sin tiros al arco en el siguiente tramo live."
    ]
  };
}

function offensiveCriticalIssues(match: MatchDetail, side: TeamSide) {
  const stats = match.stats[side];
  const opponent = match.stats[side === "home" ? "away" : "home"];
  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  const ownScore = side === "home" ? match.score.home : match.score.away;
  const oppScore = side === "home" ? match.score.away : match.score.home;
  const minute = match.minute ?? 0;
  const issues: { code: string; label: string; risk: string; penalty: number }[] = [];
  const redCard = currentRedCardAssessment(match, side);
  const hasRed = redCard.status === "RED_CARD_CONFIRMED";
  const zeroSot = stats.shotsOnTarget === 0;
  const ownDangerous = stats.dangerousAttacks;
  const opponentDangerous = opponent.dangerousAttacks;

  if (hasRed && minute > 70 && zeroSot) {
    issues.push({
      code: "RED_ZERO_SOT_LATE",
      label: `${teamName} necesita marcar, tiene roja y 0 tiros al arco despues del 70'`,
      risk: "Impacto de la roja: reduce fuertemente la probabilidad de gol del equipo que necesita anotar.",
      penalty: 6
    });
  } else if (hasRed) {
    issues.push({
      code: "RED",
      label: `${teamName} juega con roja`,
      risk: "La roja reduce proyeccion ofensiva y aumenta incertidumbre del mercado BTTS.",
      penalty: 3
    });
  }

  if (redCard.status === "RED_CARD_UNCONFIRMED") {
    issues.push({
      code: "RED_UNCONFIRMED",
      label: `${teamName} tiene roja sin confirmar por discrepancia de fuentes`,
      risk: "Roja actual: SIN CONFIRMAR. No se modifica el pronostico hasta confirmacion.",
      penalty: 0
    });
  }

  if (minute > 70 && oppScore - ownScore >= 3) {
    issues.push({
      code: "THREE_GOAL_DEFICIT_LATE",
      label: `${teamName} pierde por 3+ goles despues del 70'`,
      risk: "Marcador muy amplio: el historico ofensivo pierde peso frente al estado live.",
      penalty: 3
    });
  }

  if (minute > 70 && zeroSot) {
    issues.push({
      code: "ZERO_SOT_LATE",
      label: `${teamName} tiene 0 tiros al arco despues del 70'`,
      risk: "0 tiros al arco en minuto avanzado es penalizacion severa para gol de ese equipo.",
      penalty: 3
    });
  }

  if (stats.possession !== null && stats.possession < 35) {
    issues.push({
      code: "LOW_POSSESSION",
      label: `${teamName} tiene posesion inferior al 35%`,
      risk: "Dominio bajo reduce confianza ofensiva.",
      penalty: 1.5
    });
  }

  if (ownDangerous !== null && ownDangerous !== undefined && opponentDangerous !== null && opponentDangerous !== undefined && ownDangerous <= opponentDangerous * 0.45) {
    issues.push({
      code: "LOW_DANGER",
      label: `${teamName} tiene ataques peligrosos muy inferiores`,
      risk: "Ataques peligrosos muy inferiores reducen probabilidad de gol.",
      penalty: 1.5
    });
  }

  if (stats.shots !== null && opponent.shots !== null && stats.shots <= opponent.shots * 0.4) {
    issues.push({
      code: "LOW_SHOTS",
      label: `${teamName} tiene remates muy inferiores`,
      risk: "Volumen de remates muy inferior limita respaldo ofensivo.",
      penalty: 1.5
    });
  }

  return issues;
}

type RedCardStatus =
  | "RED_CARD_CONFIRMED"
  | "RED_CARD_CANCELLED_BY_VAR"
  | "RED_CARD_UNCONFIRMED"
  | "HISTORICAL_RED_CARD"
  | "NO_RED_CARD";

function currentRedCardAssessment(match: MatchDetail, side: TeamSide): {
  status: RedCardStatus;
  player: string;
  team: string;
  minute: number | null;
  source: string;
} {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const redEvents = match.events.filter((event) => event.team === side && event.type === "card" && isRedCardText(`${event.title} ${event.detail}`));
  const latestRed = redEvents.sort((a, b) => b.minute - a.minute)[0] ?? null;
  const statsRed = match.stats[side].redCards;
  const cancelled = latestRed ? hasVarCancellationForRed(match, side, latestRed.minute) : false;

  if (match.status !== "LIVE") {
    if (latestRed || (statsRed ?? 0) > 0) {
      return {
        status: "HISTORICAL_RED_CARD",
        player: latestRed?.detail ?? "N/D",
        team,
        minute: latestRed?.minute ?? null,
        source: latestRed ? `fixture:${match.id}:events` : `fixture:${match.id}:stats`
      };
    }
    return { status: "NO_RED_CARD", player: "N/D", team, minute: null, source: `fixture:${match.id}` };
  }

  if (cancelled && latestRed) {
    return {
      status: "RED_CARD_CANCELLED_BY_VAR",
      player: latestRed.detail || "N/D",
      team,
      minute: latestRed.minute,
      source: `fixture:${match.id}:events+VAR`
    };
  }

  if (latestRed && statsRed === 0) {
    return {
      status: "RED_CARD_UNCONFIRMED",
      player: latestRed.detail || "N/D",
      team,
      minute: latestRed.minute,
      source: `fixture:${match.id}:events disagrees stats`
    };
  }

  if (!latestRed && (statsRed ?? 0) > 0) {
    return {
      status: "RED_CARD_UNCONFIRMED",
      player: "N/D",
      team,
      minute: null,
      source: `fixture:${match.id}:stats without event`
    };
  }

  if (latestRed) {
    return {
      status: "RED_CARD_CONFIRMED",
      player: latestRed.detail || "N/D",
      team,
      minute: latestRed.minute,
      source: statsRed === null ? `fixture:${match.id}:events` : `fixture:${match.id}:events+stats`
    };
  }

  return { status: "NO_RED_CARD", player: "N/D", team, minute: null, source: `fixture:${match.id}` };
}

function redCardAnalysisSummary(match: MatchDetail) {
  const assessments = (["home", "away"] as TeamSide[]).map((side) => currentRedCardAssessment(match, side));
  const confirmed = assessments.find((item) => item.status === "RED_CARD_CONFIRMED");
  const unconfirmed = assessments.find((item) => item.status === "RED_CARD_UNCONFIRMED");
  const cancelled = assessments.find((item) => item.status === "RED_CARD_CANCELLED_BY_VAR");

  if (confirmed) {
    return `Roja actual: SÍ; jugador ${confirmed.player}; equipo ${confirmed.team}; minuto ${confirmed.minute ?? "N/D"}; fuente ${confirmed.source}.`;
  }
  if (unconfirmed) {
    return `Roja actual: SIN CONFIRMAR; jugador ${unconfirmed.player}; equipo ${unconfirmed.team}; minuto ${unconfirmed.minute ?? "N/D"}; fuente ${unconfirmed.source}.`;
  }
  if (cancelled) {
    return `Roja actual: NO; evento cancelado por VAR; jugador ${cancelled.player}; equipo ${cancelled.team}; minuto ${cancelled.minute ?? "N/D"}; fuente ${cancelled.source}.`;
  }
  return `Roja actual: NO; jugador N/D; equipo N/D; minuto N/D; fuente fixture:${match.id}.`;
}

function hasVarCancellationForRed(match: MatchDetail, side: TeamSide, redMinute: number) {
  return match.events.some((event) => {
    if (event.team !== side || event.minute < redMinute) return false;
    const text = `${event.title} ${event.detail}`.toLowerCase();
    return event.type === "var" && /(cancel|anulad|revoc|overturn|no red|no roja|sin roja)/i.test(text);
  });
}

function isRedCardText(value: string) {
  return /red|roja/i.test(value) && !/(no red|no roja|sin roja|cancel|anulad|revoc|overturn)/i.test(value);
}

function liveGoalTimeCap(status: MatchDetail["status"], goalsNeeded: number, remaining: number | null, minute: number | null) {
  if (status !== "LIVE") return 10;
  if (remaining === null) {
    if ((minute ?? 0) < 90) return 10;
    return goalsNeeded <= 1 ? 4.5 : 2;
  }
  if (goalsNeeded <= 1) {
    if (remaining <= 2) return 4.5;
    if (remaining <= 5) return 6;
    if (remaining <= 10) return 7;
    if (remaining <= 20) return 8;
    if (remaining <= 30) return 9;
    return 10;
  }
  if (remaining <= 2) return 2;
  if (remaining <= 5) return 3;
  if (remaining <= 10) return 4;
  if (remaining <= 20) return 5.5;
  if (remaining <= 30) return 6.5;
  if (remaining <= 45) return 7.5;
  return 8.5;
}

function analyzeCorners(context: MatchAnalysisContext): AnalyzedMarket | null {
  const recentCorners = avg([...context.recentHome, ...context.recentAway].map((match) => sumStat(match.stats, "corners")));
  const liveCorners = sumStat(context.match.stats, "corners");
  const recentLiveCorners = context.liveMomentum?.recent.fifteen.corners ?? null;
  const line = context.match.status === "LIVE" ? bestAvailableCornerLine(context.match.odds, liveCorners) : null;
  const cornersNeeded = line !== null && liveCorners !== null ? Math.max(0, Math.floor(line + 1) - liveCorners) : null;
  const remaining = context.match.status === "LIVE" ? estimateLiveRemainingTime(context.match).estimatedMinutes : null;
  const evidence = compact([
    recentCorners !== null ? `Promedio reciente: ${recentCorners.toFixed(1)} corners totales.` : null,
    liveCorners !== null && context.match.status === "LIVE" ? `Corners actuales: ${liveCorners}.` : null,
    cornersNeeded !== null ? `Linea Over ${line}: faltan ${cornersNeeded} corners; restante ${remaining ?? "N/D"} min.` : null,
    recentLiveCorners !== null && context.match.status === "LIVE" ? `Corners ultimos 15': ${recentLiveCorners}. Tendencia ${context.liveMomentum?.matchTrendState ?? "N/D"}.` : null
  ]);
  const score = scoreFrom([recentCorners !== null && recentCorners >= 9, liveCorners !== null && liveCorners >= 6, recentLiveCorners !== null && recentLiveCorners >= 2]);
  return makeMarket("Corners", line !== null ? `Over ${line}` : NO_BET, score, evidence, ["Si baja la presion por bandas, la lectura pierde fuerza."], [], { line });
}

function bestAvailableCornerLine(odds: OddsQuote[], currentCorners: number | null) {
  const lines = odds
    .filter((quote) => /corner/i.test(`${quote.market} ${quote.selection}`) && /\bover\b/i.test(quote.selection) && Number.isFinite(quote.price) && quote.price > 1.01)
    .map((quote) => extractLine(`${quote.market} ${quote.selection}`))
    .filter((line): line is number => line !== null)
    .sort((a, b) => a - b);
  if (!lines.length) return null;
  if (currentCorners === null) return lines[0];
  return lines.find((line) => line >= currentCorners) ?? lines[lines.length - 1];
}

function analyzeCards(context: MatchAnalysisContext): AnalyzedMarket | null {
  const recentCards = avg([...context.recentHome, ...context.recentAway].map((match) => sumCards(match)));
  const liveCards = sumCards(context.match);
  const recentCardsLive = context.liveMomentum?.recent.fifteen.cards ?? null;
  const evidence = compact([
    recentCards !== null ? `Promedio reciente: ${recentCards.toFixed(1)} tarjetas.` : null,
    context.match.status === "LIVE" ? `Tarjetas actuales: ${liveCards}.` : null,
    recentCardsLive !== null && context.match.status === "LIVE" ? `Tarjetas ultimos 15': ${recentCardsLive}.` : null
  ]);
  const score = scoreFrom([recentCards !== null && recentCards >= 4.5, context.match.status === "LIVE" && liveCards >= 3, recentCardsLive !== null && recentCardsLive >= 1]);
  return makeMarket("Tarjetas", NO_BET, score, evidence, ["Arbitro permisivo o partido resuelto invalida el ritmo disciplinario."]);
}

function analyzeShots(context: MatchAnalysisContext): AnalyzedMarket | null {
  const liveShots = sumStat(context.match.stats, "shots");
  const onTarget = sumStat(context.match.stats, "shotsOnTarget");
  const recentShots = context.liveMomentum?.recent.fifteen.shots ?? null;
  const recentSot = context.liveMomentum?.recent.fifteen.shotsOnTarget ?? null;
  const evidence = compact([
    liveShots !== null ? `Remates actuales: ${liveShots}.` : null,
    onTarget !== null ? `Remates al arco actuales: ${onTarget}.` : null,
    recentShots !== null || recentSot !== null ? `Ultimos 15': ${recentShots ?? "N/D"} remates, ${recentSot ?? "N/D"} al arco.` : null
  ]);
  const score = scoreFrom([liveShots !== null && liveShots >= 18, onTarget !== null && onTarget >= 6, recentShots !== null && recentShots >= 5, recentSot !== null && recentSot >= 2]);
  return makeMarket("Remates", NO_BET, score, evidence, ["Cambios defensivos o ventaja comoda pueden frenar volumen."]);
}

function analyzeTeamGoals(context: MatchAnalysisContext): AnalyzedMarket | null {
  const homeAvg = avg(context.recentHome.map((match) => teamGoals(match, sideForTeam(match, context.match.homeTeam))));
  const evidence = compact([homeAvg !== null ? `${context.match.homeTeam} promedio reciente: ${homeAvg.toFixed(2)} goles.` : null]);
  const score = scoreFrom([homeAvg !== null && homeAvg >= 1.8]);
  return makeMarket("Goles por equipo", `${context.match.homeTeam} mas de 1.5`, score, evidence, ["No recomendar por favoritismo: requiere alineacion ofensiva y volumen real."], [], { line: 1.5 });
}

function analyzePlayerShots(context: MatchAnalysisContext): AnalyzedMarket | null {
  const top = context.match.playerStats
    .filter((player) => (player.shots ?? 0) >= 3 || (player.shotsOnTarget ?? 0) >= 2)
    .sort((a, b) => (b.shots ?? 0) - (a.shots ?? 0))[0];

  if (!top) {
    return null;
  }
  if (context.match.status === "LIVE" && isPlayerSubstitutedOut(context.match, top.player)) {
    return makeMarket(
      "Mercados de jugadores",
      `${top.player} remates`,
      1,
      [`${top.player}: ${top.shots ?? "N/D"} remates, ${top.shotsOnTarget ?? "N/D"} al arco.`],
      ["Jugador sustituido: no abrir nueva entrada para remates/SOT/tarjeta."],
      ["Solo reabrir analisis si el mercado corresponde a una apuesta ya registrada y debe evaluarse como HOLD/EXIT."],
      { dataQuality: 20 }
    );
  }

  return makeMarket(
    "Mercados de jugadores",
    `${top.player} remates`,
    7,
    [`${top.player}: ${top.shots ?? "N/D"} remates, ${top.shotsOnTarget ?? "N/D"} al arco.`],
    ["Solo usar si la casa ofrece linea razonable y el jugador sigue en cancha."]
  );
}

function isPlayerSubstitutedOut(match: MatchDetail, playerName: string) {
  const normalizedPlayer = normalizeLoose(playerName);
  return match.substitutions.some((event) => {
    const detail = normalizeLoose(event.detail);
    return detail.includes(normalizedPlayer) && /(sale|out|replaced|substituted off)/.test(detail);
  });
}

function analyzeOneXTwoMarkets(context: MatchAnalysisContext): AnalyzedMarket[] {
  const homeForm = pointsRate(context.recentHome, context.match.homeTeam);
  const awayForm = pointsRate(context.recentAway, context.match.awayTeam);
  const baseEvidence = compact([
    homeForm !== null ? `Forma reciente ${context.match.homeTeam}: ${homeForm.toFixed(2)} puntos/partido.` : null,
    awayForm !== null ? `Forma reciente ${context.match.awayTeam}: ${awayForm.toFixed(2)} puntos/partido.` : null
  ]);

  const edge = homeForm !== null && awayForm !== null ? homeForm - awayForm : 0;
  const drawRateValue = drawRate([...context.recentHome, ...context.recentAway]);
  const homeScore = Math.min(7, scoreFrom([edge >= 0.8, baseEvidence.length >= 2]));
  const drawScore = Math.min(6, scoreFrom([drawRateValue !== null && drawRateValue >= 0.32, Math.abs(edge) <= 0.35]));
  const awayScore = Math.min(7, scoreFrom([edge <= -0.8, baseEvidence.length >= 2]));

  return [
    makeMarket("1X2", "1", homeScore, [...baseEvidence, `${context.match.homeTeam} como seleccion 1.`], [
      "Nunca recomendar resultado directo solo por cuota alta; requiere edge estadistico real."
    ], [], { dataQuality: dataQualityForContext(context) }),
    makeMarket("1X2", "X", drawScore, compact([...baseEvidence, drawRateValue !== null ? `Empates recientes combinados: ${(drawRateValue * 100).toFixed(0)}%.` : null]), [
      "El empate es mercado de alta varianza y necesita precio con valor."
    ], [], { dataQuality: dataQualityForContext(context) }),
    makeMarket("1X2", "2", awayScore, [...baseEvidence, `${context.match.awayTeam} como seleccion 2.`], [
      "Nunca recomendar visitante solo porque la cuota sea alta; necesita ventaja estadistica."
    ], [], { dataQuality: dataQualityForContext(context) })
  ].filter((item): item is AnalyzedMarket => Boolean(item));
}

function analyzeDoubleChanceMarkets(context: MatchAnalysisContext): AnalyzedMarket[] {
  const homeLossRate = lossRate(context.recentHome, context.match.homeTeam);
  const awayLossRate = lossRate(context.recentAway, context.match.awayTeam);
  const combinedNoDraw = noDrawRate([...context.recentHome, ...context.recentAway]);
  const dataQuality = dataQualityForContext(context);
  return [
    makeMarket(
      "Doble oportunidad",
      "1X",
      Math.min(scoreFrom([homeLossRate !== null && homeLossRate <= 0.25, context.recentHome.length >= 5]), 7),
      compact([homeLossRate !== null ? `${context.match.homeTeam} perdio ${(homeLossRate * 100).toFixed(0)}% de recientes.` : null]),
      ["Precio bajo sin volumen estadistico no tiene respaldo suficiente."],
      [],
      { dataQuality }
    ),
    makeMarket(
      "Doble oportunidad",
      "X2",
      Math.min(scoreFrom([awayLossRate !== null && awayLossRate <= 0.25, context.recentAway.length >= 5]), 7),
      compact([awayLossRate !== null ? `${context.match.awayTeam} perdio ${(awayLossRate * 100).toFixed(0)}% de recientes.` : null]),
      ["Precio bajo sin volumen estadistico no tiene respaldo suficiente."],
      [],
      { dataQuality }
    ),
    makeMarket(
      "Doble oportunidad",
      "12",
      Math.min(scoreFrom([combinedNoDraw !== null && combinedNoDraw >= 0.7, context.recentHome.length + context.recentAway.length >= 10]), 7),
      compact([combinedNoDraw !== null ? `Partidos recientes sin empate: ${(combinedNoDraw * 100).toFixed(0)}%.` : null]),
      ["Si ambos aceptan empate, esta seleccion pierde valor."],
      [],
      { dataQuality }
    )
  ].filter((item): item is AnalyzedMarket => Boolean(item));
}

function makeMarket(
  market: string,
  selection: string,
  score: number,
  supportingData: string[],
  risks: string[],
  improvements: string[] = [],
  meta: { line?: number | null; dataQuality?: number; finalTimeDebug?: AnalyzedMarket["finalTimeDebug"]; marketPeriod?: AnalyzedMarket["marketPeriod"]; remainingMarketMinutes?: number | null } = {}
): AnalyzedMarket | null {
  if (!supportingData.length) {
    return null;
  }

  const confidence = Math.max(1, Math.min(10, score));
  return {
    market,
    selection,
    marketPeriod: meta.marketPeriod ?? "FULL_MATCH",
    remainingMarketMinutes: meta.remainingMarketMinutes ?? null,
    confidence,
    statisticalScore: confidence,
    betScore: null,
    probabilityNote: "ESTIMACIÓN NO CALIBRADA",
    classification: classify(confidence),
    decision: "ESPERAR",
    bookmaker: null,
    odd: null,
    line: meta.line ?? null,
    impliedProbability: null,
    estimatedProbability: null,
    edge: null,
    missingRequirements: [],
    dataQuality: meta.dataQuality,
    finalTimeDebug: meta.finalTimeDebug,
    risk: riskFromConfidence(confidence),
    supportingData,
    risks,
    improvements: improvements.length ? improvements : ["Más volumen ofensivo confirmado, mejor cuota o nuevas ocasiones claras."],
    invalidators: ["DESCARTAR si las alineaciones/bajas cambian el contexto, falta cuota real, la linea no existe o la cuota se mueve contra la lectura."]
  };
}

function rankMarkets(markets: AnalyzedMarket[]) {
  return [...markets].sort(compareMarkets);
}

function isPrimaryAnalysisMarket(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  return (
    text.includes("goles") ||
    text.includes("ambos") ||
    text.includes("corner") ||
    text.includes("tarjeta") ||
    text.includes("remate") ||
    text.includes("jugador")
  );
}

function compareMarkets(a: AnalyzedMarket | undefined, b: AnalyzedMarket | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const executableScore = executableMarketScore(b) - executableMarketScore(a);
  if (executableScore !== 0) return executableScore;
  const betScore = (b.betScore ?? b.confidence) - (a.betScore ?? a.confidence);
  if (betScore !== 0) return betScore;
  const qualityScore = (b.dataQuality ?? 0) - (a.dataQuality ?? 0);
  if (qualityScore !== 0) return qualityScore;
  const edgeScore = (b.uncertaintyAdjustedEdge ?? b.edge ?? -1) - (a.uncertaintyAdjustedEdge ?? a.edge ?? -1);
  if (edgeScore !== 0) return edgeScore;
  const confidenceScore = b.confidence - a.confidence;
  if (confidenceScore !== 0) return confidenceScore;
  return marketPriority(b) - marketPriority(a);
}

function executableMarketScore(market: AnalyzedMarket) {
  if (market.decision === "APUESTA RECOMENDADA" && market.odd !== null && market.odd !== undefined) return 4;
  if (market.decision === "INTERESANTE" && market.odd !== null && market.odd !== undefined) return 3;
  if (market.decision === "ESPERAR" && market.odd !== null && market.odd !== undefined) return 2;
  if (market.odd !== null && market.odd !== undefined) return 1;
  return 0;
}

function bestStrongMarket(result: MatchAnalysisResult) {
  return rankMarkets((result.allMarkets ?? result.markets).filter(isStrongBet))[0];
}

function isStrongBet(market: AnalyzedMarket) {
  const score = market.betScore ?? market.confidence;
  return (
    isOpenMarket(market) &&
    market.decision === "APUESTA RECOMENDADA" &&
    score >= 8 &&
    (market.dataQuality ?? 0) >= 70 &&
    market.odd !== null &&
    (market.edge ?? 0) >= 0.05
  );
}

function applyDataQualityCap(confidence: number, dataQuality: number) {
  if (dataQuality < 50) return Math.min(confidence, 6.5);
  if (dataQuality < 70) return Math.min(confidence, 7.9);
  if (dataQuality < 80) return Math.min(confidence, 8.5);
  return confidence;
}

function fallbackMarketsForDisplay(context: MatchAnalysisContext, markets: AnalyzedMarket[]) {
  if (context.match.status !== "UPCOMING") return rankMarkets(markets);
  return [...markets].sort((a, b) => {
    const groupScore = prematchMarketPriority(b) - prematchMarketPriority(a);
    if (groupScore !== 0) return groupScore;
    const qualityScore = (b.dataQuality ?? 0) - (a.dataQuality ?? 0);
    if (qualityScore !== 0) return qualityScore;
    return b.confidence - a.confidence;
  });
}

function prematchMarketPriority(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  if (text.includes("over 1.5")) return 90;
  if (text.includes("over 2.5")) return 89;
  if (text.includes("under 2.5")) return 88;
  if (text.includes("over 3.5")) return 87;
  if (text.includes("ambos")) return 86;
  if (text.includes("doble")) return 70;
  if (text.includes("1x2")) return 60;
  if (text.includes("corner")) return 50;
  if (text.includes("tarjeta")) return 49;
  return 40;
}

function marketPriority(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  if (text.includes("goles") || text.includes("ambos")) return 5;
  if (text.includes("remate")) return 4;
  if (text.includes("tarjeta")) return 3;
  if (text.includes("corner")) return 2;
  if (text.includes("1x2") || text.includes("doble")) return 1;
  return 0;
}

function decisionRank(market: AnalyzedMarket) {
  if (market.decision === "APUESTA RECOMENDADA") return 5;
  if (market.decision === "INTERESANTE") return 4;
  if (market.decision === "ESPERAR") return 3;
  if (market.decision === "DESCARTAR") return 2;
  return 1;
}

function dataQualityForContext(context: MatchAnalysisContext) {
  let score = 0;
  if (context.recentHome.length >= 5) score += 25;
  if (context.recentAway.length >= 5) score += 25;
  if (context.h2h.length >= 3) score += 15;
  if (context.match.odds.length > 0) score += 20;
  if (context.match.lineups.home.length || context.match.lineups.away.length) score += 10;
  if (context.match.playerStats.length) score += 5;
  return score;
}

function scoreFrom(flags: boolean[]) {
  if (!flags.length) return 1;
  const ratio = flags.filter(Boolean).length / flags.length;
  return roundHalf(3.5 + ratio * 3.5);
}

function classify(confidence: number): AnalyzedMarket["classification"] {
  if (confidence >= 9) return "RESPALDO MUY FUERTE";
  if (confidence >= 8) return "RESPALDO FUERTE";
  if (confidence >= 6) return "INTERESANTE";
  if (confidence >= 4) return "RIESGO ALTO";
  return "DESCARTAR";
}

function riskFromConfidence(confidence: number): NonNullable<AnalyzedMarket["risk"]> {
  if (confidence >= 7.5) return "bajo";
  if (confidence >= 5.5) return "medio";
  return "alto";
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function evaluateLiveState(match: MatchDetail): LiveTrendState {
  if (match.status !== "LIVE") return "N/D";
  const shots = sumStat(match.stats, "shots");
  const xg = sumStat(match.stats, "xg");
  const hasConfirmedRed = (["home", "away"] as TeamSide[]).some((side) => currentRedCardAssessment(match, side).status === "RED_CARD_CONFIRMED");
  if (hasConfirmedRed) return "CAMBIO FUERTE";
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

function drawRate(matches: MatchDetail[]) {
  if (!matches.length) return null;
  return matches.filter((match) => match.score.home === match.score.away).length / matches.length;
}

function noDrawRate(matches: MatchDetail[]) {
  const draws = drawRate(matches);
  return draws === null ? null : 1 - draws;
}

function opponentGoals(match: MatchDetail, teamName: string) {
  const side = sideForTeam(match, teamName);
  return side === "home" ? match.score.away : match.score.home;
}

function teamStat(match: MatchDetail, teamName: string, key: keyof TeamStats) {
  const side = sideForTeam(match, teamName);
  return match.stats[side][key] ?? null;
}

function opponentStat(match: MatchDetail, teamName: string, key: keyof TeamStats) {
  const side = sideForTeam(match, teamName);
  return match.stats[side === "home" ? "away" : "home"][key] ?? null;
}

function weightedComponent(score: number, weight: number, source: number | null | undefined) {
  if (source === null || source === undefined || !Number.isFinite(source)) return null;
  return { score, weight };
}

function componentScore(value: number | null | undefined, target: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(10, (value / target) * 8));
}

function ratioScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(10, value * 10));
}

function compact(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value));
}

function isBettable(match: MatchDetail) {
  return match.status === "LIVE" || match.status === "UPCOMING";
}

function statusIndicatorFor(status: MatchDetail["status"]): MatchAnalysisResult["statusIndicator"] {
  if (status === "LIVE") return "LIVE";
  if (status === "UPCOMING") return "UPCOMING";
  return "FINAL";
}

function buildAnalysisCacheKey(match: MatchDetail, version: string) {
  return `${match.id}:${match.status}:${match.score.home}-${match.score.away}:${match.minute ?? "na"}:${version}`;
}

function missingShotCore(match: MatchDetail) {
  return sumStat(match.stats, "shots") === null && sumStat(match.stats, "shotsOnTarget") === null && sumStat(match.stats, "xg") === null;
}

function hasLiveAttackingEvidence(match: MatchDetail) {
  return sumStat(match.stats, "shots") !== null || sumStat(match.stats, "shotsOnTarget") !== null || sumStat(match.stats, "xg") !== null;
}

function capMarketConfidence(market: AnalyzedMarket, maxConfidence: number): AnalyzedMarket {
  const confidence = Math.min(market.confidence, maxConfidence);
  return {
    ...market,
    confidence,
    classification: classify(confidence)
  };
}
