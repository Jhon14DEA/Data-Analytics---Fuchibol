import type { AnalyzedMarket, MarketDataQualityBreakdown, MatchAnalysisContext, MatchDetail, OddsQuote, PressureStrength, TeamSide, TeamStats } from "@/types/domain";

export type MarketProbabilityEstimate = {
  estimatedProbability: number;
  rawRate: number | null;
  adjustedRate: number | null;
  sampleSize: number;
  uncertainty: number;
  liveProbability: number | null;
  prematchWeight: number | null;
  liveWeight: number | null;
  concordanceScore: number | null;
  evidenceCoverage: number | null;
  liveAttackScore: number | null;
  cumulativeAttackScore: number | null;
  recentMomentumScore: number | null;
  matchTrendScore: number | null;
  matchTrendState: "SUBIENDO" | "ESTABLE" | "CAYENDO" | null;
  pressureStrength: PressureStrength | null;
  goalPressureSignal: "SIN SEÑAL" | "VIGILAR" | "FUERTE" | null;
  statisticalOutlook: "FUERTE" | "INTERESANTE" | "DÉBIL";
  lambdaRemaining: number | null;
  remainingGoalProbabilities: Record<string, number> | null;
  finalTimeConfidenceCap: number | null;
  remainingTimeLabel: string | null;
  finalTimeDebug: AnalyzedMarket["finalTimeDebug"] | null;
  model: string;
  note: string;
  evidence: string[];
};

export type MarketDataQualityResult = MarketDataQualityBreakdown;

const BASE_RATES: Record<string, number> = {
  "goals:over:0.5": 0.92,
  "goals:over:1.5": 0.72,
  "goals:over:2.5": 0.52,
  "goals:over:3.5": 0.31,
  "goals:under:2.5": 0.48,
  "goals1h:over:0.5": 0.62,
  "goals1h:over:1.5": 0.28,
  "goals1h:over:2.5": 0.1,
  "btts:si": 0.52,
  "btts:no": 0.48,
  "1x2:1": 0.43,
  "1x2:x": 0.28,
  "1x2:2": 0.29,
  "double:1x": 0.71,
  "double:x2": 0.57,
  "double:12": 0.72,
  corners: 0.5,
  cards: 0.5,
  shots: 0.5,
  teamGoals: 0.44,
  playerShots: 0.42
};

export function estimateMarketProbabilityFromEvidence(market: AnalyzedMarket, context: MatchAnalysisContext): MarketProbabilityEstimate {
  const kind = marketKind(market);
  const baseRate = BASE_RATES[kind] ?? 0.5;
  const historical = historicalEstimate(market, context, baseRate);
  const live = context.match.status === "LIVE" ? liveAdjustmentEstimate(market, context, historical.adjustedRate ?? baseRate) : null;
  const historyWeight = live?.prematchWeight ?? (context.match.status === "LIVE" ? liveHistoricalWeight(context.match.minute) : 1);
  const liveWeight = live ? 1 - historyWeight : 0;
  const fusedProbability = clampProbability(live ? historical.adjustedRate * historyWeight + live.probability * liveWeight : historical.adjustedRate);
  const finalTimeGuard = live ? finalLiveTimeGuard(market, context, fusedProbability) : null;
  const estimatedProbability = finalTimeGuard?.probability ?? fusedProbability;
  const coverageAdjustment = live ? (1 - live.evidenceCoverage) * 0.08 : 0;
  const uncertainty = clamp(0.04, 0.45, historical.uncertainty + (live?.uncertainty ?? 0) + coverageAdjustment + (context.match.status === "LIVE" ? 0.02 : 0));
  const outlook = statisticalOutlookFor(estimatedProbability, uncertainty);

  return {
    estimatedProbability: roundProbability(estimatedProbability),
    rawRate: historical.rawRate,
    adjustedRate: roundProbability(historical.adjustedRate),
    sampleSize: historical.sampleSize,
    uncertainty: roundProbability(uncertainty),
    liveProbability: live ? roundProbability(live.probability) : null,
    prematchWeight: live ? roundProbability(historyWeight) : null,
    liveWeight: live ? roundProbability(liveWeight) : null,
    concordanceScore: live ? Math.round(live.concordanceScore) : null,
    evidenceCoverage: live ? Math.round(live.evidenceCoverage * 100) : null,
    liveAttackScore: live ? Math.round(live.liveAttackScore) : null,
    cumulativeAttackScore: live ? Math.round(live.cumulativeAttackScore) : null,
    recentMomentumScore: live ? Math.round(live.recentMomentumScore) : null,
    matchTrendScore: live ? Math.round(live.matchTrendScore) : null,
    matchTrendState: live?.matchTrendState ?? null,
    pressureStrength: live?.pressureStrength ?? null,
    goalPressureSignal: live?.goalPressureSignal ?? null,
    statisticalOutlook: outlook,
    lambdaRemaining: live?.lambdaRemaining !== null && live?.lambdaRemaining !== undefined ? roundProbability(live.lambdaRemaining) : null,
    remainingGoalProbabilities: live?.remainingGoalProbabilities ?? null,
    finalTimeConfidenceCap: finalTimeGuard?.confidenceCap ?? null,
    remainingTimeLabel: finalTimeGuard?.remainingLabel ?? null,
    finalTimeDebug: finalTimeGuard?.debug ?? null,
    model: live ? `historical-shrinkage+live-${kind}` : `historical-shrinkage-${kind}`,
    note: "ESTIMACIÓN NO CALIBRADA",
    evidence: [
      `Sample ${historical.sampleSize} partidos; raw ${formatRate(historical.rawRate)}; prematch adjusted ${formatRate(historical.adjustedRate)}; incertidumbre ${(uncertainty * 100).toFixed(0)}%.`,
      ...historical.evidence,
      ...(live?.evidence ?? []),
      ...(finalTimeGuard?.evidence ?? [])
    ].slice(0, 4)
  };
}

export function marketDataQualityForMarket(market: AnalyzedMarket, context: MatchAnalysisContext, estimate?: MarketProbabilityEstimate): MarketDataQualityResult {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const match = context.match;
  const sampleSize = estimate?.sampleSize ?? totalHistoricalSample(context);
  const hasHistorical = context.recentHome.length >= 5 && context.recentAway.length >= 5;
  const hasVenue = venueSample(context, "home").length >= 3 && venueSample(context, "away").length >= 3;
  const hasH2h = context.h2h.length >= 3;
  const hasOdds = match.odds.length > 0;
  const hasLine = !requiresLineText(text) || market.line !== null && market.line !== undefined;
  const hasLineups = match.lineups.home.length > 0 || match.lineups.away.length > 0;
  const hasLiveCore = match.status !== "LIVE" || hasAny([sumStat(match.stats, "shots"), sumStat(match.stats, "shotsOnTarget"), sumStat(match.stats, "xg")]);
  const hasPartialGoalLive = match.status !== "LIVE" || hasAny([sumStat(match.stats, "shotsOffTarget"), sumStat(match.stats, "attacks"), sumStat(match.stats, "dangerousAttacks"), sumStat(match.stats, "corners")]);
  const hasXg = hasAnyHistoricalMetric(context, "xg") || sumStat(match.stats, "xg") !== null;
  const hasShots = hasAnyHistoricalMetric(context, "shots") || sumStat(match.stats, "shots") !== null;
  const hasSot = hasAnyHistoricalMetric(context, "shotsOnTarget") || sumStat(match.stats, "shotsOnTarget") !== null;
  const hasLiveShots = match.status !== "LIVE" || sumStat(match.stats, "shots") !== null;
  const hasLiveSot = match.status !== "LIVE" || sumStat(match.stats, "shotsOnTarget") !== null;
  const hasLiveXg = match.status !== "LIVE" || sumStat(match.stats, "xg") !== null;
  const hasLiveOffTarget = match.status !== "LIVE" || sumStat(match.stats, "shotsOffTarget") !== null;
  const hasLiveAttacks = match.status !== "LIVE" || sumStat(match.stats, "attacks") !== null;
  const hasLiveDangerous = match.status !== "LIVE" || sumStat(match.stats, "dangerousAttacks") !== null;
  const hasLiveCorners = match.status !== "LIVE" || sumStat(match.stats, "corners") !== null;
  const hasSnapshotCoverage = match.status !== "LIVE" || Boolean(context.liveMomentum?.recent.five.isComplete || context.liveMomentum?.recent.ten.isComplete || context.liveMomentum?.recent.fifteen.isComplete || context.liveSnapshotTrend?.available);
  const hasRecentDeltas = match.status !== "LIVE" || Boolean(context.liveMomentum && [context.liveMomentum.recent.five, context.liveMomentum.recent.ten, context.liveMomentum.recent.fifteen].some((window) => window.dataState === "VALID_DATA" || window.dataState === "OBSERVED_ZERO"));
  const hasPlayers = match.playerStats.length > 0;

  const isGoal = text.includes("over") || text.includes("under") || text.includes("goles");
  const isBtts = text.includes("ambos");
  const isCards = text.includes("tarjeta");
  const isCorners = text.includes("corner");
  const isPlayer = text.includes("jugador") || text.includes("remates") && !text.includes("total");

  const weights = isGoal || isBtts
    ? { historical: 22, venue: 18, h2h: 8, odds: 15, line: 10, lineups: 0, liveCore: match.status === "LIVE" ? 8 : 0, partialLive: match.status === "LIVE" ? 11 : 0, xg: 4, shots: 3, sot: 4 }
    : isCards
    ? { historical: 25, venue: 10, h2h: 5, odds: 20, line: 15, lineups: 0, liveCore: match.status === "LIVE" ? 10 : 0, cards: 15 }
    : isCorners
    ? { historical: 24, venue: 14, h2h: 4, odds: 18, line: 15, lineups: 0, liveCore: match.status === "LIVE" ? 10 : 0, corners: 15 }
    : isPlayer
    ? { historical: 10, venue: 5, odds: 20, line: 20, lineups: 15, players: 30 }
    : { historical: 25, venue: 15, h2h: 10, odds: 20, line: 10, lineups: 10, liveCore: match.status === "LIVE" ? 10 : 0 };

  const components: Record<string, boolean> = {
    historical: hasHistorical,
    venue: hasVenue,
    h2h: hasH2h,
    odds: hasOdds,
    line: hasLine,
    lineups: hasLineups,
    liveCore: hasLiveCore,
    partialLive: hasPartialGoalLive,
    xg: hasXg,
    shots: hasShots,
    sot: hasSot,
    cards: hasAnyHistoricalMetric(context, "yellowCards") || sumStat(match.stats, "yellowCards") !== null,
    corners: hasAnyHistoricalMetric(context, "corners") || sumStat(match.stats, "corners") !== null,
    players: hasPlayers
  };
  const historicalDataQuality = historicalQualityScore({
    historical: hasHistorical,
    venue: hasVenue,
    h2h: hasH2h,
    historicalGoals: sampleSize >= 10,
    historicalShots: hasAnyHistoricalMetric(context, "shots") || hasAnyHistoricalMetric(context, "shotsOnTarget")
  });
  const baseLiveExecutionQuality = match.status === "LIVE" ? liveExecutionQualityScore({
    minuteStatusScore: match.minute !== null,
    score: match.score.home !== null && match.score.away !== null,
    odds: hasOdds,
    snapshotCoverage: hasSnapshotCoverage,
    shotsOnTarget: hasLiveSot,
    shots: hasLiveShots,
    xg: hasLiveXg,
    shotsOffTarget: hasLiveOffTarget,
    attacks: hasLiveAttacks,
    dangerousAttacks: hasLiveDangerous,
    corners: hasLiveCorners,
    recentDeltas: hasRecentDeltas
  }) : null;
  const liveExecutionQuality = baseLiveExecutionQuality === null
    ? null
    : Math.max(0, baseLiveExecutionQuality - (context.dataFreshness?.liveDataStale ? 24 : 0));
  const dataWarningPenalty = context.liveMomentum?.notes.some((note) => note.includes("DATA_WARNING")) ? 8 : 0;
  const scoreBeforeWarnings = isGoal || isBtts
    ? match.status === "LIVE"
      ? Math.round(historicalDataQuality * 0.45 + (liveExecutionQuality ?? 0) * 0.55)
      : historicalDataQuality
    : Object.entries(weights).reduce((total, [key, weight]) => total + (components[key] ? weight : 0), 0);
  const score = Math.max(0, scoreBeforeWarnings - dataWarningPenalty);
  const missing = Object.entries(components)
    .filter(([key, available]) => !available && key in weights)
    .map(([key]) => key);

  return { score: Math.max(0, Math.min(100, score)), sampleSize, missing, components, historicalDataQuality, liveExecutionQuality, dataFreshness: context.dataFreshness ?? null };
}

export function oddsMovementForMarket(market: AnalyzedMarket, history: OddsQuote[]) {
  const compatible = history
    .filter((quote) => quote.bookmaker === market.bookmaker && quote.market === market.market && quote.selection === market.selection)
    .sort((a, b) => new Date(a.quotedAt).getTime() - new Date(b.quotedAt).getTime());
  const opening = compatible[0]?.price ?? null;
  const previous = compatible.length > 1 ? compatible[compatible.length - 2].price : null;
  const current = market.odd ?? compatible[compatible.length - 1]?.price ?? null;
  const movementPercent = opening && current ? roundProbability((current - opening) / opening) : null;
  const warning = movementPercent !== null && Math.abs(movementPercent) >= 0.12 ? "Movimiento fuerte de cuota: usar como señal secundaria, no como argumento principal." : undefined;
  return { openingOdds: opening, previousOdds: previous, currentOdds: current, movementPercent, warning };
}

export function liveHistoricalWeight(minute: number | null) {
  const value = minute ?? 0;
  if (value >= 90) return 0.01;
  if (value >= 85) return 0.02;
  if (value >= 75) return 0.06;
  if (value >= 60) return 0.12;
  return 0.25;
}

function historicalEstimate(market: AnalyzedMarket, context: MatchAnalysisContext, baseRate: number) {
  if (market.marketPeriod === "FIRST_HALF") {
    return {
      sampleSize: 0,
      rawRate: null,
      adjustedRate: baseRate,
      uncertainty: 0.34,
      evidence: ["Historico especifico 1T N/D; se usa prior generico 1T y evidencia live disponible."]
    };
  }

  const samples = weightedSamples(market, context);
  const sampleWeight = samples.reduce((total, sample) => total + sample.weight, 0);
  const successes = samples.reduce((total, sample) => total + (sample.hit ? sample.weight : 0), 0);
  const rawRate = sampleWeight > 0 ? successes / sampleWeight : null;
  const prior = priorStrength(samples.length);
  const adjustedRate = rawRate === null ? baseRate : (successes + baseRate * prior) / (sampleWeight + prior);
  const uncertainty = Math.max(0.06, Math.min(0.38, 1 / Math.sqrt(sampleWeight + prior) + Math.max(0, 8 - samples.length) * 0.015));
  return {
    sampleSize: samples.length,
    rawRate,
    adjustedRate,
    uncertainty,
    evidence: [`Base jerárquica ${formatRate(baseRate)}; shrinkage prior ${prior}.`]
  };
}

function historicalQualityScore(checks: {
  historical: boolean;
  venue: boolean;
  h2h: boolean;
  historicalGoals: boolean;
  historicalShots: boolean;
}) {
  const weights = { historical: 32, venue: 22, h2h: 16, historicalGoals: 20, historicalShots: 10 };
  return Object.entries(weights).reduce((total, [key, weight]) => total + (checks[key as keyof typeof checks] ? weight : 0), 0);
}

function liveExecutionQualityScore(checks: {
  minuteStatusScore: boolean;
  score: boolean;
  odds: boolean;
  snapshotCoverage: boolean;
  shotsOnTarget: boolean;
  shots: boolean;
  xg: boolean;
  shotsOffTarget: boolean;
  attacks: boolean;
  dangerousAttacks: boolean;
  corners: boolean;
  recentDeltas: boolean;
}) {
  const weights = {
    minuteStatusScore: 8,
    score: 8,
    odds: 10,
    snapshotCoverage: 10,
    shotsOnTarget: 14,
    shots: 10,
    xg: 10,
    shotsOffTarget: 8,
    attacks: 6,
    dangerousAttacks: 8,
    corners: 8,
    recentDeltas: 8
  };
  return Object.entries(weights).reduce((total, [key, weight]) => total + (checks[key as keyof typeof checks] ? weight : 0), 0);
}

function liveAdjustmentEstimate(market: AnalyzedMarket, context: MatchAnalysisContext, prematchProbability: number) {
  const match = context.match;
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  const goalDirection = goalDirectionForMarket(market, text);
  const total = match.score.home + match.score.away;
  const remaining = remainingMinutesForProbabilityMarket(match, market);
  const shots = sumStat(match.stats, "shots");
  const shotsOffTarget = sumStat(match.stats, "shotsOffTarget");
  const sot = sumStat(match.stats, "shotsOnTarget");
  const xg = sumStat(match.stats, "xg");
  const corners = sumStat(match.stats, "corners");
  const attacks = sumStat(match.stats, "attacks");
  const dangerous = sumStat(match.stats, "dangerousAttacks");
  const coverage = liveEvidenceCoverage(context);
  const liveAttack = liveAttackScore(context);
  const cumulativeAttack = context.liveMomentum?.cumulativeAttackScore ?? liveAttack;
  const hasRecentWindowData = context.liveMomentum ? hasUsableRecentWindow(context) : Boolean(context.liveSnapshotTrend?.available);
  const recentMomentum = hasRecentWindowData ? context.liveMomentum?.recentMomentumScore ?? liveAttack : 0;
  const matchTrend = context.liveMomentum?.matchTrendScore ?? 50;
  const matchTrendState = context.liveMomentum?.matchTrendState ?? "ESTABLE";
  const pressureStrength = context.liveMomentum?.pressureStrength ?? null;
  const concordance = liveConcordanceScore(market, context, prematchProbability, liveAttack);
  const prematchWeight = dynamicPrematchWeight(match.minute, concordance, coverage);
  let probability = prematchProbability;
  let lambdaRemaining: number | null = null;
  let remainingGoalProbabilities: Record<string, number> | null = null;

  if (text.includes("goles por equipo") && line !== null && goalDirection === "over") {
    const side = teamSideForTeamGoalMarket(market, match);
    const currentTeamGoals = side ? match.score[side] : 0;
    const goalsNeeded = Math.max(0, Math.floor(line + 0.5) - currentTeamGoals);
    if (goalsNeeded === 0) probability = 0.99;
    else {
      const remainingModel = remainingTeamGoalDistribution(context, side, prematchProbability, remaining, {
        shots,
        shotsOffTarget,
        sot,
        xg,
        corners,
        attacks,
        dangerous,
        liveAttack,
        cumulativeAttack,
        recentMomentum,
        matchTrendState
      });
      lambdaRemaining = remainingModel.lambdaRemaining;
      remainingGoalProbabilities = remainingModel.probabilities;
      probability = remainingGoalProbability(remainingModel.probabilities, lambdaRemaining, goalsNeeded);
    }
  } else if (text.includes("corner") && line !== null) {
    const currentCorners = corners ?? 0;
    const cornersNeeded = Math.max(0, Math.floor(line + 1) - currentCorners);
    if (cornersNeeded === 0) probability = 0.99;
    else {
      const lambdaCorners = remainingCornerLambda(context, remaining, currentCorners);
      probability = poissonTail(lambdaCorners, cornersNeeded);
    }
  } else if (line !== null && goalDirection === "over") {
    const goalsNeeded = Math.max(0, Math.floor(line + 0.5) - total);
    if (goalsNeeded === 0) probability = 0.99;
    else {
      const remainingModel = remainingGoalDistribution(context, prematchProbability, remaining, {
        shots,
        shotsOffTarget,
        sot,
        xg,
        corners,
        attacks,
        dangerous,
        liveAttack,
        cumulativeAttack,
        recentMomentum,
        matchTrendState
      });
      lambdaRemaining = remainingModel.lambdaRemaining;
      remainingGoalProbabilities = remainingModel.probabilities;
      probability = remainingGoalProbability(remainingModel.probabilities, lambdaRemaining, goalsNeeded);
    }
  } else if (line !== null && goalDirection === "under") {
    probability = clampProbability(0.35 + Math.min(0.42, (match.minute ?? 0) / 160) - metricBoost(xg, 2.2, 0.12) - metricBoost(sot, 8, 0.10));
  } else if (text.includes("ambos")) {
    const homeScored = match.score.home > 0;
    const awayScored = match.score.away > 0;
    probability = homeScored && awayScored ? 0.99 : bttsLiveProbability(context, prematchProbability, remaining);
    if (text.includes("no")) probability = 1 - probability;
  }

  return {
    probability,
    uncertainty: coverage >= 0.65 ? 0.03 : coverage >= 0.45 ? 0.06 : 0.12,
    prematchWeight,
    concordanceScore: concordance,
    evidenceCoverage: coverage,
    liveAttackScore: liveAttack,
    cumulativeAttackScore: cumulativeAttack,
    recentMomentumScore: recentMomentum,
    matchTrendScore: matchTrend,
    matchTrendState,
    pressureStrength,
    goalPressureSignal: context.liveMomentum?.goalPressureSignal ?? null,
    lambdaRemaining,
    remainingGoalProbabilities,
    evidence: [
      `Fusion dinamica: prematch ${(prematchWeight * 100).toFixed(0)}%, live ${((1 - prematchWeight) * 100).toFixed(0)}%, concordance ${Math.round(concordance)}/100, coverage ${Math.round(coverage * 100)}%.`,
      `Live attack score ${Math.round(liveAttack)}/100; SOT ${formatNullable(sot)}, off target ${formatNullable(shotsOffTarget)}, attacks ${formatNullable(attacks)}, dangerous ${formatNullable(dangerous)}, corners ${formatNullable(corners)}.`,
      lambdaRemaining !== null ? `Goles restantes Poisson-like: lambda ${lambdaRemaining.toFixed(2)}; P>=1 ${formatRate(remainingGoalProbabilities?.gte1 ?? null)}, P>=2 ${formatRate(remainingGoalProbabilities?.gte2 ?? null)}, P>=3 ${formatRate(remainingGoalProbabilities?.gte3 ?? null)}.` : null,
      `Momentum live: acumulado ${Math.round(cumulativeAttack)}/100, reciente ${hasRecentWindowData ? `${Math.round(recentMomentum)}/100` : "N/D"}, tendencia ${hasRecentWindowData ? matchTrendState : "N/D"} (${hasRecentWindowData ? Math.round(matchTrend) : "N/D"}/100), señal de gol ${hasRecentWindowData ? context.liveMomentum?.goalPressureSignal ?? "N/D" : "N/D"}.`
    ].filter((item): item is string => Boolean(item))
  };
}

function bttsLiveProbability(context: MatchAnalysisContext, prematchProbability: number, remaining: number) {
  const match = context.match;
  const needs: TeamSide[] = [];
  if (match.score.home === 0) needs.push("home");
  if (match.score.away === 0) needs.push("away");
  if (!needs.length) return 0.99;

  const sideScores = needs.map((side) => {
    const stats = match.stats[side];
    const recentSide = context.liveMomentum?.recent.ten[side] ?? context.liveMomentum?.recent.fifteen[side] ?? null;
    const pressure = recentSide ? teamPressureScore(recentSide.shots, recentSide.shotsOnTarget, recentSide.xgDelta, recentSide.corners, recentSide.dangerousAttacks) : null;
    const cumulative = teamPressureScore(stats.shots, stats.shotsOnTarget, stats.xg, stats.corners, stats.dangerousAttacks);
    const redPenalty = (stats.redCards ?? 0) > 0 ? ((match.minute ?? 0) >= 70 ? 0.22 : 0.12) : 0;
    const zeroSotPenalty = stats.shotsOnTarget === 0 && (match.minute ?? 0) >= 70 ? 0.18 : 0;
    const tactical = context.liveMomentum?.tacticalState[side] === "ATTACKING" ? 0.08 : context.liveMomentum?.tacticalState[side] === "NEEDS_GOAL" ? 0.03 : 0;
    return clampProbability(
      prematchProbability * 0.18 +
      Math.min(0.22, remaining / 220) +
      (pressure !== null ? pressure * 0.22 : 0) +
      (cumulative !== null ? cumulative * 0.14 : 0) +
      tactical -
      redPenalty -
      zeroSotPenalty
    );
  });

  return clampProbability(Math.min(...sideScores));
}

function remainingGoalDistribution(
  context: MatchAnalysisContext,
  prematchProbability: number,
  remaining: number,
  values: {
    shots: number | null;
    shotsOffTarget: number | null;
    sot: number | null;
    xg: number | null;
    corners: number | null;
    attacks: number | null;
    dangerous: number | null;
    liveAttack: number;
    cumulativeAttack: number;
    recentMomentum: number;
    matchTrendState: "SUBIENDO" | "ESTABLE" | "CAYENDO";
  }
) {
  const historicalGoals = historicalGoalsPer90(context);
  const baseLambda = Math.max(0.08, historicalGoals * Math.max(0, remaining) / 90);
  const knownAttemptEvidence = (values.sot ?? 0) + (values.shotsOffTarget ?? 0);
  const precisionPenalty = values.shotsOffTarget !== null && values.sot !== null && values.shotsOffTarget >= 7 && values.sot <= 1 ? -0.08 : 0;
  const trend = values.matchTrendState === "SUBIENDO" ? 0.08 : values.matchTrendState === "CAYENDO" ? -0.14 : 0;
  const coverageFactor = liveEvidenceCoverage(context);
  const liveFactor = clamp(
    0.55,
    1.65,
    0.72 +
      values.liveAttack / 100 * 0.28 +
      values.cumulativeAttack / 100 * 0.16 +
      values.recentMomentum / 100 * 0.24 +
      metricBoost(values.sot, 8, 0.22) +
      metricBoost(values.shots, 22, 0.08) +
      metricBoost(values.shotsOffTarget, 14, 0.1) +
      metricBoost(values.corners, 10, 0.11) +
      metricBoost(values.attacks, 100, 0.07) +
      metricBoost(values.dangerous, 70, 0.1) +
      metricBoost(values.xg, 2.2, 0.2) +
      (prematchProbability >= 0.72 ? 0.04 : 0) +
      tacticalGoalAdjustment(context) +
      trend +
      precisionPenalty
  );
  const uncertaintyDrag = coverageFactor < 0.45 ? 0.9 : coverageFactor < 0.65 ? 0.96 : 1;
  const lambdaRemaining = clamp(0.02, 4.6, baseLambda * liveFactor * uncertaintyDrag + Math.min(0.18, knownAttemptEvidence * 0.008));
  const probabilities = {
    gte1: roundProbability(poissonTail(lambdaRemaining, 1)),
    gte2: roundProbability(poissonTail(lambdaRemaining, 2)),
    gte3: roundProbability(poissonTail(lambdaRemaining, 3)),
    gte4: roundProbability(poissonTail(lambdaRemaining, 4))
  };
  return { lambdaRemaining, probabilities };
}

function remainingTeamGoalDistribution(
  context: MatchAnalysisContext,
  side: TeamSide | null,
  prematchProbability: number,
  remaining: number,
  values: {
    shots: number | null;
    shotsOffTarget: number | null;
    sot: number | null;
    xg: number | null;
    corners: number | null;
    attacks: number | null;
    dangerous: number | null;
    liveAttack: number;
    cumulativeAttack: number;
    recentMomentum: number;
    matchTrendState: "SUBIENDO" | "ESTABLE" | "CAYENDO";
  }
) {
  if (!side) {
    const total = remainingGoalDistribution(context, prematchProbability, remaining, values);
    const lambdaRemaining = total.lambdaRemaining * 0.5;
    return { lambdaRemaining, probabilities: remainingProbabilities(lambdaRemaining) };
  }

  const teamStats = context.match.stats[side];
  const recentTeam = context.liveMomentum?.recent.ten[side] ?? context.liveMomentum?.recent.fifteen[side] ?? null;
  const historicalGoals = historicalTeamGoalsPer90(context, side);
  const baseLambda = Math.max(0.03, historicalGoals * Math.max(0, remaining) / 90);
  const teamPressure = teamPressureScore(teamStats.shots, teamStats.shotsOnTarget, teamStats.xg, teamStats.corners, teamStats.dangerousAttacks);
  const recentPressure = recentTeam ? teamPressureScore(recentTeam.shots, recentTeam.shotsOnTarget, recentTeam.xgDelta, recentTeam.corners, recentTeam.dangerousAttacks) : null;
  const redPenalty = (teamStats.redCards ?? 0) > 0 ? ((context.match.minute ?? 0) >= 70 ? 0.72 : 0.84) : 1;
  const liveFactor = clamp(
    0.45,
    1.8,
    0.74 +
      (teamPressure ?? 0.45) * 0.36 +
      (recentPressure ?? 0.35) * 0.3 +
      metricBoost(teamStats.shotsOnTarget, 5, 0.22) +
      metricBoost(teamStats.shots, 12, 0.08) +
      metricBoost(teamStats.shotsOffTarget ?? null, 8, 0.08) +
      metricBoost(teamStats.corners, 6, 0.08) +
      metricBoost(teamStats.dangerousAttacks ?? null, 45, 0.1) +
      metricBoost(teamStats.xg, 1.4, 0.18) +
      (prematchProbability >= 0.62 ? 0.03 : 0) +
      trendProbabilityAdjustment(values.matchTrendState, context.match.minute)
  );
  const lambdaRemaining = clamp(0.01, 3.2, baseLambda * liveFactor * redPenalty);
  return { lambdaRemaining, probabilities: remainingProbabilities(lambdaRemaining) };
}

function remainingProbabilities(lambdaRemaining: number) {
  return {
    gte1: roundProbability(poissonTail(lambdaRemaining, 1)),
    gte2: roundProbability(poissonTail(lambdaRemaining, 2)),
    gte3: roundProbability(poissonTail(lambdaRemaining, 3)),
    gte4: roundProbability(poissonTail(lambdaRemaining, 4))
  };
}

function teamSideForTeamGoalMarket(market: AnalyzedMarket, match: MatchDetail): TeamSide | null {
  const selection = normalizeLoose(market.selection);
  if (selection.includes(normalizeLoose(match.homeTeam))) return "home";
  if (selection.includes(normalizeLoose(match.awayTeam))) return "away";
  return null;
}

function historicalTeamGoalsPer90(context: MatchAnalysisContext, side: TeamSide) {
  const teamName = side === "home" ? context.match.homeTeam : context.match.awayTeam;
  const samples = side === "home" ? context.recentHome : context.recentAway;
  return avg(samples.map((match) => {
    const sampleSide = sideForTeam(match, teamName);
    return sampleSide === "home" ? match.score.home : match.score.away;
  })) ?? historicalGoalsPer90(context) * 0.5;
}

function remainingCornerLambda(context: MatchAnalysisContext, remaining: number, currentCorners: number) {
  const historicalCorners = avg([...context.recentHome, ...context.recentAway].map((match) => sumStat(match.stats, "corners"))) ?? 8.5;
  const base = historicalCorners * Math.max(0, remaining) / 90;
  const recent = context.liveMomentum?.recent.ten.corners ?? context.liveMomentum?.recent.fifteen.corners ?? null;
  const recentRate = recent === null ? null : recent / (context.liveMomentum?.recent.ten.corners !== null ? 10 : 15);
  const recentProjected = recentRate === null ? null : recentRate * Math.max(0, remaining);
  const blend = recentProjected === null ? base : base * 0.45 + recentProjected * 0.55;
  const currentPace = currentCorners / Math.max(1, context.match.minute ?? 1) * Math.max(0, remaining);
  return clamp(0.02, 8, blend * 0.75 + currentPace * 0.25);
}

function historicalGoalsPer90(context: MatchAnalysisContext) {
  return avg([...context.recentHome, ...context.recentAway, ...context.h2h.slice(0, 5)].map(totalGoals)) ?? 2.6;
}

function poissonTail(lambda: number, needed: number) {
  if (needed <= 0) return 1;
  let cumulative = 0;
  for (let goals = 0; goals < needed; goals += 1) {
    cumulative += Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals);
  }
  return clamp(0, 1, 1 - cumulative);
}

function remainingGoalProbability(probabilities: Record<"gte1" | "gte2" | "gte3" | "gte4", number>, lambda: number, goalsNeeded: number) {
  if (goalsNeeded <= 0) return 1;
  if (goalsNeeded === 1) return probabilities.gte1;
  if (goalsNeeded === 2) return probabilities.gte2;
  if (goalsNeeded === 3) return probabilities.gte3;
  if (goalsNeeded === 4) return probabilities.gte4;
  return poissonTail(lambda, goalsNeeded);
}

function factorial(value: number) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function teamPressureScore(shots: number | null | undefined, sot: number | null | undefined, xg: number | null | undefined, corners: number | null | undefined, dangerous: number | null | undefined) {
  const values = [
    shots === null || shots === undefined ? null : Math.min(1, shots / 8),
    sot === null || sot === undefined ? null : Math.min(1, sot / 3),
    xg === null || xg === undefined ? null : Math.min(1, xg / 0.8),
    corners === null || corners === undefined ? null : Math.min(1, corners / 3),
    dangerous === null || dangerous === undefined ? null : Math.min(1, dangerous / 22)
  ].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function trendProbabilityAdjustment(state: "SUBIENDO" | "ESTABLE" | "CAYENDO", minute: number | null) {
  const lateMultiplier = (minute ?? 0) >= 76 ? 1.25 : 1;
  if (state === "SUBIENDO") return 0.045 * lateMultiplier;
  if (state === "CAYENDO") return -0.07 * lateMultiplier;
  return 0;
}

function dynamicPrematchWeight(minute: number | null, concordanceScore: number, evidenceCoverage: number) {
  const value = minute ?? 0;
  const range = value <= 30
    ? [0.5, 0.65]
    : value <= 45
    ? [0.4, 0.55]
    : value <= 60
    ? [0.3, 0.45]
    : value <= 75
    ? [0.2, 0.35]
    : [0.05, 0.2];
  const agreement = clamp(0, 1, concordanceScore / 100);
  const coverage = clamp(0, 1, evidenceCoverage);
  return clamp(range[0], range[1], range[0] + (range[1] - range[0]) * (agreement * 0.7 + coverage * 0.3));
}

function liveConcordanceScore(market: AnalyzedMarket, context: MatchAnalysisContext, prematchProbability: number, attackScore: number) {
  const match = context.match;
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  const goalDirection = goalDirectionForMarket(market, text);
  const total = match.score.home + match.score.away;
  const sot = sumStat(match.stats, "shotsOnTarget");
  const corners = sumStat(match.stats, "corners");
  const dangerous = sumStat(match.stats, "dangerousAttacks");
  const reds = sumStat(match.stats, "redCards") ?? 0;
  const trend = context.liveSnapshotTrend;
  let score = prematchProbability >= 0.7 ? 58 : prematchProbability >= 0.58 ? 50 : 42;

  if (line !== null && goalDirection === "over") {
    const goalsNeeded = Math.max(0, Math.floor(line + 0.5) - total);
    if (total > 0) score += 12;
    if (goalsNeeded <= 1) score += 8;
    if (sot !== null && sot >= 3) score += 8;
    if (corners !== null && corners >= 6) score += 6;
    if (dangerous !== null && dangerous >= 35) score += 6;
    if (attackScore >= 65) score += 8;
    if (trend?.ten.goals !== null && trend?.ten.goals !== undefined && trend.ten.goals > 0) score += 4;
    if (trend?.ten.shotsOnTarget !== null && trend?.ten.shotsOnTarget !== undefined && trend.ten.shotsOnTarget > 0) score += 4;
    if ((match.minute ?? 0) >= 65 && total === 0) score -= 18;
    if ((match.minute ?? 0) >= 65 && sot === 0) score -= 22;
    if (reds > 0) score -= 10;
  } else if (line !== null && goalDirection === "under") {
    score = 100 - score;
    if ((match.minute ?? 0) >= 60 && total <= line) score += 10;
  }

  return clamp(0, 100, score);
}

function liveEvidenceCoverage(context: MatchAnalysisContext) {
  const match = context.match;
  const momentumCoverage = context.liveMomentum
    ? [context.liveMomentum.recent.five, context.liveMomentum.recent.ten, context.liveMomentum.recent.fifteen].some((window) => window.isComplete)
    : Boolean(context.liveSnapshotTrend?.available);
  const checks = [
    { available: sumStat(match.stats, "shotsOnTarget") !== null, weight: 18 },
    { available: sumStat(match.stats, "corners") !== null, weight: 14 },
    { available: sumStat(match.stats, "dangerousAttacks") !== null, weight: 14 },
    { available: match.score.home !== null && match.score.away !== null, weight: 12 },
    { available: momentumCoverage, weight: 14 },
    { available: sumStat(match.stats, "shotsOffTarget") !== null, weight: 8 },
    { available: sumStat(match.stats, "attacks") !== null, weight: 6 },
    { available: sumStat(match.stats, "possession") !== null, weight: 6 },
    { available: sumStat(match.stats, "shots") !== null, weight: 8 },
    { available: sumStat(match.stats, "xg") !== null, weight: 8 }
  ];
  const total = checks.reduce((sum, item) => sum + item.weight, 0);
  const available = checks.reduce((sum, item) => sum + (item.available ? item.weight : 0), 0);
  return total ? available / total : 0;
}

function hasUsableRecentWindow(context: MatchAnalysisContext) {
  const recent = context.liveMomentum?.recent;
  if (!recent) return false;
  return [recent.five, recent.ten, recent.fifteen].some((window) => window.dataState === "VALID_DATA" || window.dataState === "OBSERVED_ZERO");
}

function tacticalGoalAdjustment(context: MatchAnalysisContext) {
  const momentum = context.liveMomentum;
  if (!momentum) return 0;
  const home = momentum.tacticalState.home;
  const away = momentum.tacticalState.away;
  const attacking = [home, away].filter((state) => state === "ATTACKING").length;
  const needsGoal = [home, away].filter((state) => state === "NEEDS_GOAL").length;
  const closing = [home, away].filter((state) => state === "CLOSING" || state === "PROTECTING").length;
  const pressure = momentum.pressureStrength;
  const pressureBoost = pressure === "MUY_ALTA" ? 0.04 : pressure === "ALTA" ? 0.025 : pressure === "MEDIA" ? 0.01 : -0.02;
  return clamp(-0.06, 0.07, attacking * 0.025 + needsGoal * 0.012 - closing * 0.012 + pressureBoost);
}

function liveAttackScore(context: MatchAnalysisContext) {
  if (context.liveMomentum) {
    const minute = context.match.minute ?? 0;
    const cumulative = context.liveMomentum.cumulativeAttackScore;
    const hasRecent = hasUsableRecentWindow(context);
    const recent = hasRecent ? context.liveMomentum.recentMomentumScore : 0;
    const trend = hasRecent ? context.liveMomentum.matchTrendState === "SUBIENDO" ? 8 : context.liveMomentum.matchTrendState === "CAYENDO" ? -10 : 0 : 0;
    if (!hasRecent && minute >= 76) return clamp(0, 100, cumulative * 0.18);
    if (!hasRecent) return clamp(0, 100, cumulative * 0.35);
    if (minute >= 85) return clamp(0, 100, recent * 0.78 + cumulative * 0.12 + context.liveMomentum.matchTrendScore * 0.1 + trend);
    if (minute >= 76) return clamp(0, 100, recent * 0.62 + cumulative * 0.25 + context.liveMomentum.matchTrendScore * 0.13 + trend);
    if (minute >= 61) return clamp(0, 100, recent * 0.5 + cumulative * 0.35 + context.liveMomentum.matchTrendScore * 0.15 + trend);
    if (minute >= 31) return clamp(0, 100, recent * 0.38 + cumulative * 0.42 + context.liveMomentum.matchTrendScore * 0.2 + trend);
    return clamp(0, 100, recent * 0.25 + cumulative * 0.55 + context.liveMomentum.matchTrendScore * 0.2 + trend);
  }
  const match = context.match;
  const totalSot = sumStat(match.stats, "shotsOnTarget");
  const totalOffTarget = sumStat(match.stats, "shotsOffTarget");
  const totalCorners = sumStat(match.stats, "corners");
  const totalAttacks = sumStat(match.stats, "attacks");
  const totalDangerous = sumStat(match.stats, "dangerousAttacks");
  const totalShots = sumStat(match.stats, "shots");
  const totalXg = sumStat(match.stats, "xg");
  const trend = context.liveSnapshotTrend;
  if ((match.minute ?? 0) >= 85) {
    const recentScores = trend?.available
      ? [
          scaled(trend.five.shotsOnTarget, 2, 32),
          scaled(trend.five.corners, 2, 18),
          scaled(trend.five.dangerousAttacks, 18, 22),
          scaled(trend.five.xg, 0.35, 18),
          (trend.five.goals ?? 0) > 0 ? 6 : 0,
          scaled(totalSot, 12, 4),
          scaled(totalOffTarget, 18, 4),
          scaled(totalCorners, 14, 3),
          scaled(totalAttacks, 130, 2),
          scaled(totalDangerous, 100, 3)
        ]
      : [scaled(totalSot, 12, 10), scaled(totalOffTarget, 18, 5), scaled(totalCorners, 14, 6), scaled(totalAttacks, 130, 3), scaled(totalDangerous, 100, 6), scaled(totalXg, 2.0, 8)];
    return clamp(0, 100, recentScores.filter((value): value is number => value !== null).reduce((total, value) => total + value, 0));
  }
  const scores = [
    scaled(totalSot, 7, 28),
    scaled(totalOffTarget, 14, 8),
    scaled(totalCorners, 9, 18),
    scaled(totalAttacks, 100, 6),
    scaled(totalDangerous, 70, 20),
    scaled(totalShots, 18, 12),
    scaled(totalXg, 2.0, 12),
    scaled(trend?.five.shotsOnTarget ?? null, 2, 5),
    scaled(trend?.ten.corners ?? null, 3, 3),
    (trend?.ten.goals ?? 0) > 0 ? 4 : 0,
    match.score.home + match.score.away > 0 ? 6 : 0
  ].filter((value): value is number => value !== null);
  return clamp(0, 100, scores.reduce((total, value) => total + value, 0));
}

function recentRhythmBoost(context: MatchAnalysisContext) {
  if (context.liveMomentum) {
    const base = context.liveMomentum.recentMomentumScore / 100 * 0.09;
    const trend = context.liveMomentum.matchTrendState === "SUBIENDO" ? 0.025 : context.liveMomentum.matchTrendState === "CAYENDO" ? -0.035 : 0;
    return Math.max(-0.05, Math.min(0.1, base + trend));
  }
  const trend = context.liveSnapshotTrend;
  if (!trend?.available) return 0;
  return Math.min(0.08, ((trend.five.shotsOnTarget ?? 0) * 0.025) + ((trend.ten.corners ?? 0) * 0.01) + ((trend.ten.dangerousAttacks ?? 0) * 0.002));
}

function statisticalOutlookFor(probability: number, uncertainty: number): MarketProbabilityEstimate["statisticalOutlook"] {
  if (probability >= 0.68 && uncertainty <= 0.28) return "FUERTE";
  if (probability >= 0.55 && uncertainty <= 0.34) return "INTERESANTE";
  return "DÉBIL";
}

function finalLiveTimeGuard(market: AnalyzedMarket, context: MatchAnalysisContext, fusedProbability: number) {
  const match = context.match;
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  if (match.status !== "LIVE") return null;
  const isGoalOver = line !== null && goalDirectionForMarket(market, text) === "over";
  const isBttsYes = text.includes("ambos") && !text.includes("no");
  const isLateNonGoal = isLateLineMarket(text);
  if (!isGoalOver && !isBttsYes && !isLateNonGoal) return null;

  const goals = match.score.home + match.score.away;
  const goalsNeeded = isBttsYes
    ? bttsGoalsNeeded(match)
    : isGoalOver && line !== null
    ? Math.max(0, Math.floor(line + 0.5) - goals)
    : lateLineNeedsEvent(market, text, match);
  if (goalsNeeded <= 0) return null;

  const remaining = estimateRemainingMinutes(match, market.marketPeriod);
  const exceptional = hasExtraordinaryGoalEvent(context, remaining.estimatedMinutes);
  const cap = isLateNonGoal && !isGoalOver && !isBttsYes
    ? finalLateActivityCap(remaining.estimatedMinutes, match.minute, exceptional)
    : finalGoalTimeCap(goalsNeeded, remaining.estimatedMinutes, match.minute, exceptional);
  if (!cap) return null;

  return {
    probability: Math.min(fusedProbability, cap.probabilityCap),
    confidenceCap: cap.confidenceCap,
    remainingLabel: remaining.label,
    debug: {
      minute: match.minute,
      stoppageTime: remaining.stoppageTime,
      remainingMinutes: remaining.estimatedMinutes,
      goalsNeeded,
      confidenceBase: null,
      confidenceBeforeCap: null,
      timeCap: cap.confidenceCap,
      confidenceAfterTimeCap: null,
      confidenceAfterCap: null,
      confidenceFinal: null,
      betScoreFinal: null,
      estimatedProbabilityBase: roundProbability(fusedProbability),
      estimatedProbabilityFinal: roundProbability(Math.min(fusedProbability, cap.probabilityCap)),
      estimatedProbabilityBeforeCap: roundProbability(fusedProbability),
      estimatedProbabilityAfterCap: roundProbability(Math.min(fusedProbability, cap.probabilityCap)),
      confidenceRendered: null
    },
    evidence: [
      `Final time guardrail: ${remaining.label}; faltan ${goalsNeeded} gol(es). Cap final ${cap.confidenceCap}/10 y probabilidad maxima ${(cap.probabilityCap * 100).toFixed(1)}%.`
    ]
  };
}

function bttsGoalsNeeded(match: MatchDetail) {
  return (match.score.home > 0 ? 0 : 1) + (match.score.away > 0 ? 0 : 1);
}

function isLateLineMarket(text: string) {
  return text.includes("corner") || text.includes("tarjeta") || text.includes("remate") || text.includes("1x2") || text.includes("doble");
}

function lateLineNeedsEvent(market: AnalyzedMarket, text: string, match: MatchDetail) {
  const line = market.line ?? extractLine(text);
  if (line === null) return (match.minute ?? 0) >= 90 ? 1 : 0;
  const current = text.includes("corner")
    ? sumStat(match.stats, "corners")
    : text.includes("tarjeta")
    ? sumStat(match.stats, "yellowCards")
    : text.includes("remate")
    ? sumStat(match.stats, "shotsOnTarget") ?? sumStat(match.stats, "shots")
    : null;
  if (current === null) return (match.minute ?? 0) >= 90 ? 1 : 0;
  return current > line ? 0 : 1;
}

function finalLateActivityCap(remaining: number | null, minute: number | null, exceptional: boolean) {
  if (exceptional) return null;
  if ((minute ?? 0) >= 90) {
    if (remaining === null || remaining <= 2) return { confidenceCap: 4.5, probabilityCap: 0.24 };
    return { confidenceCap: 6, probabilityCap: 0.42 };
  }
  if (remaining === null) return null;
  if (remaining <= 2) return { confidenceCap: 4.5, probabilityCap: 0.24 };
  if (remaining <= 5) return { confidenceCap: 6, probabilityCap: 0.4 };
  if (remaining <= 10) return { confidenceCap: 7, probabilityCap: 0.55 };
  return null;
}

function estimateRemainingMinutes(match: MatchDetail, marketPeriod: AnalyzedMarket["marketPeriod"] = "FULL_MATCH") {
  const minute = match.minute;
  if (minute === null) return { estimatedMinutes: null, stoppageTime: null, label: "restante N/D" };
  if (marketPeriod === "FIRST_HALF") {
    const remaining = Math.max(0, 45 - minute);
    return { estimatedMinutes: remaining, stoppageTime: null, label: `quedan aprox. ${remaining} min hasta HT` };
  }
  if (minute < 90) {
    const remaining = Math.max(0, 90 - minute);
    return { estimatedMinutes: remaining, stoppageTime: null, label: `quedan aprox. ${remaining} min + añadido` };
  }

  const addedMinute = Math.max(0, minute - 90);
  const extra = (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).stoppageTime
    ?? (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).addedTime
    ?? (match as { stoppageTime?: number | null; addedTime?: number | null; extraTime?: number | null }).extraTime
    ?? null;

  if (extra !== null && Number.isFinite(extra)) {
    const remaining = Math.max(0, extra - addedMinute);
    return { estimatedMinutes: remaining, stoppageTime: extra, label: `~${remaining} min restantes` };
  }

  return { estimatedMinutes: null, stoppageTime: null, label: "solo añadido · tiempo restante incierto" };
}

function remainingMinutesForProbabilityMarket(match: MatchDetail, market: AnalyzedMarket) {
  if (market.remainingMarketMinutes !== null && market.remainingMarketMinutes !== undefined) return Math.max(0, market.remainingMarketMinutes);
  if (market.marketPeriod === "FIRST_HALF" && match.minute !== null) return Math.max(0, 45 - match.minute);
  return match.minute === null ? 45 : Math.max(0, 90 - match.minute);
}

function finalGoalTimeCap(goalsNeeded: number, remaining: number | null, minute: number | null, exceptional: boolean) {
  if (exceptional) return null;

  if ((minute ?? 0) >= 90) {
    if (remaining === null) {
      return goalsNeeded <= 1 ? { confidenceCap: 4.5, probabilityCap: 0.22 } : { confidenceCap: 2.5, probabilityCap: 0.08 };
    }
    if (goalsNeeded <= 1 && remaining <= 2) return { confidenceCap: 4.5, probabilityCap: 0.22 };
  }

  if (remaining === null) return null;

  if (goalsNeeded <= 1) {
    if (remaining <= 2) return { confidenceCap: 4.5, probabilityCap: 0.22 };
    if (remaining <= 5) return { confidenceCap: 6, probabilityCap: 0.36 };
    if (remaining <= 10) return { confidenceCap: 7, probabilityCap: 0.48 };
    if (remaining <= 20) return { confidenceCap: 8, probabilityCap: 0.62 };
    if (remaining <= 30) return { confidenceCap: 9, probabilityCap: 0.78 };
    return null;
  }

  if (remaining <= 2) return { confidenceCap: 2, probabilityCap: 0.06 };
  if (remaining <= 5) return { confidenceCap: 3, probabilityCap: 0.1 };
  if (remaining <= 10) return { confidenceCap: 4, probabilityCap: 0.18 };
  if (remaining <= 20) return { confidenceCap: 5.5, probabilityCap: 0.28 };
  if (remaining <= 30) return { confidenceCap: 6.5, probabilityCap: 0.4 };
  return null;
}

function hasExtraordinaryGoalEvent(context: MatchAnalysisContext, remaining: number | null) {
  const match = context.match;
  const eventText = match.events
    .filter((event) => match.minute === null || event.minute >= match.minute - 2)
    .map((event) => `${event.type} ${event.title} ${event.detail}`.toLowerCase())
    .join(" ");
  const pendingPenaltyOrVar = /(penal|penalty|var.*gol|goal.*var|gol.*var|ocasión clara|ocasion clara|clear chance)/i.test(eventText);
  const extremePressureWithRed = (sumStat(match.stats, "redCards") ?? 0) > 0 && liveAttackScore(context) >= 88;
  const longKnownStoppage = (match.minute ?? 0) >= 90 && remaining !== null && remaining >= 8;
  return pendingPenaltyOrVar || extremePressureWithRed || longKnownStoppage;
}

function weightedSamples(market: AnalyzedMarket, context: MatchAnalysisContext) {
  const homeVenue = venueSample(context, "home").map((match) => ({ match, team: context.match.homeTeam, venue: 1.15 }));
  const awayVenue = venueSample(context, "away").map((match) => ({ match, team: context.match.awayTeam, venue: 1.15 }));
  const homeGeneral = context.recentHome.slice(0, 10).map((match) => ({ match, team: context.match.homeTeam, venue: 0.85 }));
  const awayGeneral = context.recentAway.slice(0, 10).map((match) => ({ match, team: context.match.awayTeam, venue: 0.85 }));
  const h2h = context.h2h.slice(0, 5).map((match, index) => ({ match, team: context.match.homeTeam, venue: 0.45 * recencyWeight(index) }));
  return [...homeVenue, ...awayVenue, ...homeGeneral, ...awayGeneral, ...h2h]
    .map((sample, index) => {
      const hit = marketOutcomeForHistoricalMatch(market, sample.match, sample.team);
      return hit === null ? null : { hit, weight: sample.venue * recencyWeight(index % 10) * opponentStrengthPlaceholder() };
    })
    .filter((sample): sample is { hit: boolean; weight: number } => Boolean(sample));
}

function marketOutcomeForHistoricalMatch(market: AnalyzedMarket, match: MatchDetail, teamName: string) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  const goalDirection = goalDirectionForMarket(market, text);
  const goals = match.score.home + match.score.away;
  if (line !== null && goalDirection === "over") return goals > line;
  if (line !== null && goalDirection === "under") return goals <= line;
  if (text.includes("ambos")) {
    const yes = match.score.home > 0 && match.score.away > 0;
    return text.includes("no") ? !yes : yes;
  }
  if (text.includes("1x2")) {
    const side = sideForTeam(match, teamName);
    const own = side === "home" ? match.score.home : match.score.away;
    const opp = side === "home" ? match.score.away : match.score.home;
    const pick = market.selection.toLowerCase();
    if (pick === "x") return own === opp;
    if (pick === "1") return side === "home" ? own > opp : own < opp;
    if (pick === "2") return side === "away" ? own > opp : own < opp;
  }
  return null;
}

function marketKind(market: AnalyzedMarket) {
  const text = `${market.market} ${market.selection}`.toLowerCase();
  const line = market.line ?? extractLine(text);
  const goalDirection = goalDirectionForMarket(market, text);
  if (text.includes("ambos")) return text.includes("no") ? "btts:no" : "btts:si";
  if (text.includes("corner")) return "corners";
  if (text.includes("tarjeta")) return "cards";
  if (text.includes("jugador")) return "playerShots";
  if (text.includes("remate")) return "shots";
  if (text.includes("goles por equipo")) return "teamGoals";
  if (market.marketPeriod === "FIRST_HALF" && line !== null && goalDirection === "over") return `goals1h:over:${line}`;
  if (line !== null && goalDirection === "over") return `goals:over:${line}`;
  if (line !== null && goalDirection === "under") return `goals:under:${line}`;
  if (text.includes("doble")) return `double:${market.selection.toLowerCase()}`;
  if (text.includes("1x2")) return `1x2:${market.selection.toLowerCase()}`;
  return "generic";
}

function goalDirectionForMarket(market: AnalyzedMarket, text: string) {
  const selection = market.selection.toLowerCase();
  if (/\b(under|menos)\b/.test(selection)) return "under";
  if (/\b(over|mas|más)\b/.test(selection)) return "over";
  if (/\b(under|menos)\b/.test(text)) return "under";
  if (/\b(over|mas|más)\b/.test(text)) return "over";
  return null;
}

function venueSample(context: MatchAnalysisContext, side: TeamSide) {
  return side === "home"
    ? context.recentHome.filter((match) => sideForTeam(match, context.match.homeTeam) === "home").slice(0, 10)
    : context.recentAway.filter((match) => sideForTeam(match, context.match.awayTeam) === "away").slice(0, 10);
}

function priorStrength(sampleSize: number) {
  if (sampleSize < 6) return 18;
  if (sampleSize < 12) return 12;
  return 8;
}

function recencyWeight(index: number) {
  return Math.max(0.55, 1 - index * 0.045);
}

function opponentStrengthPlaceholder() {
  return 1;
}

function hasAnyHistoricalMetric(context: MatchAnalysisContext, key: keyof TeamStats) {
  return [...context.recentHome, ...context.recentAway].some((match) => sumStat(match.stats, key) !== null);
}

function totalHistoricalSample(context: MatchAnalysisContext) {
  return context.recentHome.length + context.recentAway.length + Math.min(context.h2h.length, 5);
}

function avg(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function totalGoals(match: MatchDetail) {
  return match.score.home + match.score.away;
}

function sumStat(stats: MatchDetail["stats"], key: keyof TeamStats) {
  const home = stats.home[key];
  const away = stats.away[key];
  if (home === null || home === undefined) {
    if (away === null || away === undefined) return null;
    return away;
  }
  if (away === null || away === undefined) return home;
  return (home ?? 0) + (away ?? 0);
}

function hasAny(values: Array<number | null>) {
  return values.some((value) => value !== null);
}

function sideForTeam(match: MatchDetail, teamName: string): TeamSide {
  return match.homeTeam === teamName ? "home" : "away";
}

function requiresLineText(text: string) {
  return ["over", "under", "goles", "corner", "tarjeta", "remate"].some((term) => text.includes(term)) && !text.includes("ambos");
}

function metricBoost(value: number | null, target: number, max: number) {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(max, (value / target) * max);
}

function scaled(value: number | null, target: number, max: number) {
  if (value === null || !Number.isFinite(value) || target <= 0) return null;
  return Math.min(max, (value / target) * max);
}

function formatNullable(value: number | null) {
  return value === null || !Number.isFinite(value) ? "N/D" : String(value);
}

function normalizeLoose(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLine(text: string) {
  const match = text.replace(",", ".").match(/(?:\b|\+)(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function formatRate(value: number | null) {
  return value === null ? "N/D" : `${(value * 100).toFixed(1)}%`;
}

function roundProbability(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clampProbability(value: number) {
  return clamp(0.03, 0.97, value);
}

function clamp(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, value));
}
