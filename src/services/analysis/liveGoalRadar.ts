import type {
  LiveMomentumAnalysis,
  MatchAnalysisContext,
  MatchDetail,
  TeamLiveSnapshotDelta,
  TeamSide
} from "@/types/domain";

export type LiveGoalRadarMarket = "OVER05_1H" | "OVER05_FT";
export type LiveGoalRadarDecision = "NO_ALERT" | "WATCH" | "STRONG_ALERT" | "PRIORITY_ALERT";
export type LiveGoalRadarRecentDataStatus = "VALID_RECENT_DATA" | "INSUFFICIENT_RECENT_DATA" | "RECENT_DEAD";

export type LiveGoalRadarWindowDebug = {
  shotsNew: number | null;
  shotsOnTargetNew: number | null;
  xgDelta: number | null;
  bigChancesNew: number | null;
  shotsInsideBoxNew: number | null;
  cornersNew: number | null;
  dangerousAttacksNew: number | null;
  attacksNew: number | null;
  dataState: string | null;
  coveragePercentage: number;
};

export type LiveGoalRadarCandidate = {
  fixtureId: string;
  match: string;
  competition: string;
  minute: number | null;
  score: { home: number; away: number };
  market: LiveGoalRadarMarket;
  totalScore: number;
  components: {
    recentLiveScore: number;
    accumulatedLiveScore: number;
    historicalScore: number;
    contextPlayersScore: number;
    h2hScore: number;
  };
  windows: {
    five: LiveGoalRadarWindowDebug;
    ten: LiveGoalRadarWindowDebug;
    fifteen: LiveGoalRadarWindowDebug;
  };
  accumulated: {
    shots: number | null;
    shotsOnTarget: number | null;
    xg: number | null;
    bigChances: number | null;
    shotsInsideBox: number | null;
    woodwork: number | null;
    corners: number | null;
    dangerousAttacks: number | null;
  };
  historical: {
    currentPeriod: string;
    periodGoalFrequency: number | null;
    homeAwayFrequency: number | null;
    scoringConcedingBlend: number | null;
    h2hFrequency: number | null;
    samples: {
      period: number;
      homeAway: number;
      scoringConceding: number;
      h2h: number;
    };
    summary: string[];
  };
  dataQuality: number;
  dataWarnings: string[];
  ndFields: string[];
  recentDataStatus: LiveGoalRadarRecentDataStatus;
  decision: LiveGoalRadarDecision;
  decisionReason: string;
  reasons: string[];
  blockers: string[];
};

const COMPONENT_WEIGHTS = {
  recentLiveScore: 0.45,
  accumulatedLiveScore: 0.20,
  historicalScore: 0.20,
  contextPlayersScore: 0.10,
  h2hScore: 0.05
};

export function evaluateLiveGoalRadar(context: MatchAnalysisContext): LiveGoalRadarCandidate[] {
  const { match } = context;
  if (match.status !== "LIVE") return [];
  if (match.score.home + match.score.away !== 0) return [];

  const markets: LiveGoalRadarMarket[] = [];
  if ((match.minute ?? 130) <= 45) markets.push("OVER05_1H");
  markets.push("OVER05_FT");

  return markets.map((market) => buildCandidate(context, market));
}

function buildCandidate(context: MatchAnalysisContext, market: LiveGoalRadarMarket): LiveGoalRadarCandidate {
  const match = context.match;
  const windows = buildWindows(context.liveMomentum);
  const ndFields = collectMissingFields(context);
  const dataWarnings = collectDataWarnings(context);
  const recentLiveScore = scoreRecentLive(windows, context.liveMomentum);
  const accumulatedLiveScore = scoreAccumulated(match);
  const historical = historicalDebug(context, market);
  const historicalScore = historical.scoringConcedingBlend ?? historical.periodGoalFrequency ?? historical.homeAwayFrequency ?? 0;
  const contextPlayersScore = scoreContextPlayers(context);
  const h2hScore = historical.h2hFrequency ?? 0;
  const dataQuality = scoreDataQuality(context, ndFields, dataWarnings);
  const rawScore =
    recentLiveScore * COMPONENT_WEIGHTS.recentLiveScore +
    accumulatedLiveScore * COMPONENT_WEIGHTS.accumulatedLiveScore +
    historicalScore * COMPONENT_WEIGHTS.historicalScore +
    contextPlayersScore * COMPONENT_WEIGHTS.contextPlayersScore +
    h2hScore * COMPONENT_WEIGHTS.h2hScore;
  const recentGate = recentProductionGate(windows, context.liveMomentum);
  const dataCap = dataQuality < 45 ? 6.9 : dataQuality < 60 ? 7.9 : 10;
  const deadRecentCap = recentGate.allowedForStrong ? 10 : 7.9;
  const totalScore = round1(Math.min(rawScore, dataCap, deadRecentCap));
  const { decision, reason, blockers } = decide(totalScore, recentGate, dataQuality, dataWarnings);
  const candidate: LiveGoalRadarCandidate = {
    fixtureId: match.id,
    match: `${match.homeTeam} vs ${match.awayTeam}`,
    competition: match.competition,
    minute: match.minute,
    score: match.score,
    market,
    totalScore,
    components: {
      recentLiveScore: round1(recentLiveScore),
      accumulatedLiveScore: round1(accumulatedLiveScore),
      historicalScore: round1(historicalScore),
      contextPlayersScore: round1(contextPlayersScore),
      h2hScore: round1(h2hScore)
    },
    windows,
    accumulated: {
      shots: sum(match.stats.home.shots, match.stats.away.shots),
      shotsOnTarget: sum(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget),
      xg: sum(match.stats.home.xg, match.stats.away.xg),
      bigChances: sum(match.stats.home.bigChances, match.stats.away.bigChances),
      shotsInsideBox: sum(match.stats.home.shotsInsideBox, match.stats.away.shotsInsideBox),
      woodwork: null,
      corners: sum(match.stats.home.corners, match.stats.away.corners),
      dangerousAttacks: sum(match.stats.home.dangerousAttacks, match.stats.away.dangerousAttacks)
    },
    historical,
    dataQuality,
    dataWarnings,
    // Display coverage only; decision quality above retains legacy inputs.
    ndFields: ndFields.filter(field => field === "bigChances" ? sum(match.stats.home.bigChances, match.stats.away.bigChances) === null : field === "shotsInsideBox" ? sum(match.stats.home.shotsInsideBox, match.stats.away.shotsInsideBox) === null : true),
    recentDataStatus: recentGate.recentDataStatus,
    decision,
    decisionReason: reason,
    reasons: buildReasons(context, windows, historical, recentGate),
    blockers
  };

  console.info("[LIVE_GOAL_RADAR_DEBUG]", {
    fixtureId: candidate.fixtureId,
    minute: candidate.minute,
    score: `${candidate.score.home}-${candidate.score.away}`,
    market: candidate.market,
    totalScore: candidate.totalScore,
    decision: candidate.decision,
    outcome: "PENDING_MANUAL_REVIEW"
  });

  return candidate;
}

function buildWindows(momentum: LiveMomentumAnalysis | null | undefined) {
  return {
    five: windowDebug(momentum?.recent.five ?? null),
    ten: windowDebug(momentum?.recent.ten ?? null),
    fifteen: windowDebug(momentum?.recent.fifteen ?? null)
  };
}

function windowDebug(window: TeamLiveSnapshotDelta | null): LiveGoalRadarWindowDebug {
  return {
    shotsNew: window?.shots ?? null,
    shotsOnTargetNew: window?.shotsOnTarget ?? null,
    xgDelta: window?.xg ?? null,
    bigChancesNew: null,
    shotsInsideBoxNew: null,
    cornersNew: window?.corners ?? null,
    dangerousAttacksNew: window?.dangerousAttacks ?? null,
    attacksNew: window?.attacks ?? null,
    dataState: window?.dataState ?? null,
    coveragePercentage: window?.coveragePercentage ?? 0
  };
}

function scoreRecentLive(windows: LiveGoalRadarCandidate["windows"], momentum: LiveMomentumAnalysis | null | undefined) {
  const five = windowScore(windows.five, 5);
  const ten = windowScore(windows.ten, 10);
  const fifteen = windowScore(windows.fifteen, 15);
  const momentumScore = momentum?.recentMomentumScore !== undefined ? momentum.recentMomentumScore / 10 : null;
  const base = five * 0.25 + ten * 0.40 + fifteen * 0.35;
  return clamp10(momentumScore === null ? base : base * 0.75 + momentumScore * 0.25);
}

function windowScore(window: LiveGoalRadarWindowDebug, minutes: 5 | 10 | 15) {
  if (window.dataState === "INSUFFICIENT_DATA" || window.dataState === "INVALID_DATA") return 0;
  const scale = minutes === 5 ? 1.15 : minutes === 10 ? 1 : 0.85;
  return clamp10(
    scoreMetric(window.xgDelta, 0.65, 2.2) * 2.2 * scale +
      scoreMetric(window.shotsOnTargetNew, 3, 2.0) * scale +
      scoreMetric(window.bigChancesNew, 1, 2.0) * scale +
      scoreMetric(window.shotsInsideBoxNew, 4, 1.5) * scale +
      scoreMetric(window.cornersNew, 3, 1.0) * scale +
      scoreMetric(window.dangerousAttacksNew, 24, 1.0) * scale +
      scoreMetric(window.attacksNew, 35, 0.5) * scale +
      scoreMetric(window.shotsNew, 8, 0.8) * scale
  );
}

function scoreAccumulated(match: MatchDetail) {
  const minute = Math.max(1, match.minute ?? 90);
  const pace = Math.min(1.45, 90 / minute);
  return clamp10(
    scoreMetric(scale(sum(match.stats.home.xg, match.stats.away.xg), pace), 1.4, 2.4) +
      scoreMetric(scale(sum(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget), pace), 5, 2.2) +
      scoreMetric(scale(sum(match.stats.home.shots, match.stats.away.shots), pace), 15, 1.5) +
      scoreMetric(scale(sum(match.stats.home.corners, match.stats.away.corners), pace), 6, 1.1) +
      scoreMetric(scale(sum(match.stats.home.dangerousAttacks, match.stats.away.dangerousAttacks), pace), 45, 1.3)
  );
}

function historicalDebug(context: MatchAnalysisContext, market: LiveGoalRadarMarket): LiveGoalRadarCandidate["historical"] {
  const minute = context.match.minute ?? 0;
  const period = market === "OVER05_1H" ? periodForMinute(Math.min(minute, 45)) : periodForMinute(minute);
  const recentHome = context.recentHome.slice(0, 10);
  const recentAway = context.recentAway.slice(0, 10);
  const h2h = context.h2h.slice(0, 5);
  const periodSamples = [...recentHome, ...recentAway].filter((match) => match.status === "FINISHED");
  const periodFrequency = rate(periodSamples, (match) => hasGoalInPeriod(match, period.start, period.end));
  const homeAwayMatches = [
    ...recentHome.filter((match) => match.homeTeam === context.match.homeTeam || match.awayTeam === context.match.homeTeam),
    ...recentAway.filter((match) => match.homeTeam === context.match.awayTeam || match.awayTeam === context.match.awayTeam)
  ];
  const homeAwayFrequency = rate(homeAwayMatches, (match) => match.score.home + match.score.away > 0);
  const scoringConcedingBlend = blendScoringConceding(context);
  const h2hFrequency = rate(h2h, (match) => match.score.home + match.score.away > 0);
  return {
    currentPeriod: period.label,
    periodGoalFrequency: periodFrequency,
    homeAwayFrequency,
    scoringConcedingBlend,
    h2hFrequency,
    samples: {
      period: periodSamples.length,
      homeAway: homeAwayMatches.length,
      scoringConceding: Math.min(recentHome.length, recentAway.length),
      h2h: h2h.length
    },
    summary: [
      periodFrequency === null ? `Sin muestra suficiente de goles en ${period.label}.` : `Gol en ${period.label}: ${(periodFrequency * 10).toFixed(1)}/10.`,
      scoringConcedingBlend === null ? "Marca/concede: N/D." : `Marca/concede combinado: ${(scoringConcedingBlend * 10).toFixed(1)}/10.`,
      h2hFrequency === null ? "H2H: N/D." : `H2H con gol: ${(h2hFrequency * 10).toFixed(1)}/10.`
    ]
  };
}

function scoreContextPlayers(context: MatchAnalysisContext) {
  const match = context.match;
  let score = 4.5;
  const forwardStarters = match.lineups.home.concat(match.lineups.away).filter((player) => /f|fw|st|del|att|wing|extremo/i.test(player.position)).length;
  if (forwardStarters >= 4) score += 1.5;
  if (match.playerStats.some((player) => (player.shotsOnTarget ?? 0) >= 1 || (player.xg ?? 0) >= 0.2)) score += 1;
  const reds = (match.stats.home.redCards ?? 0) + (match.stats.away.redCards ?? 0);
  if (reds > 0) score -= 1.5;
  if (context.liveMomentum?.substitutions.some((substitution) => substitution.observedImpact === "POSITIVO")) score += 1;
  return clamp10(score);
}

function recentProductionGate(windows: LiveGoalRadarCandidate["windows"], momentum: LiveMomentumAnalysis | null | undefined) {
  const ten = windows.ten;
  const fifteen = windows.fifteen;
  const tenUsable = isUsableRecentWindow(ten);
  const fifteenUsable = isUsableRecentWindow(fifteen);
  const insufficient = !tenUsable || !fifteenUsable;
  const recentEvidence = [
    (ten.shotsOnTargetNew ?? 0) >= 1 || (fifteen.shotsOnTargetNew ?? 0) >= 1,
    (ten.xgDelta ?? 0) >= 0.18 || (fifteen.xgDelta ?? 0) >= 0.28,
    (ten.bigChancesNew ?? 0) >= 1 || (fifteen.bigChancesNew ?? 0) >= 1,
    (ten.shotsInsideBoxNew ?? 0) >= 2 || (fifteen.shotsInsideBoxNew ?? 0) >= 3,
    (ten.cornersNew ?? 0) >= 2 && ((ten.dangerousAttacksNew ?? 0) >= 12 || (ten.attacksNew ?? 0) >= 20),
    momentum?.goalPressureSignal === "FUERTE" || momentum?.pressureStrength === "ALTA" || momentum?.pressureStrength === "MUY_ALTA"
  ];
  const dead = !insufficient && [ten, fifteen].every((window) => {
    const available = [window.shotsNew, window.shotsOnTargetNew, window.xgDelta, window.cornersNew, window.dangerousAttacksNew, window.attacksNew].some((value) => value !== null);
    if (!available) return false;
    return (window.shotsNew ?? 0) <= 1 &&
      (window.shotsOnTargetNew ?? 0) <= 0 &&
      (window.xgDelta ?? 0) <= 0.05 &&
      (window.cornersNew ?? 0) <= 0 &&
      (window.dangerousAttacksNew ?? 0) <= 5;
  });
  const recentDataStatus: LiveGoalRadarRecentDataStatus = insufficient ? "INSUFFICIENT_RECENT_DATA" : dead ? "RECENT_DEAD" : "VALID_RECENT_DATA";
  return {
    allowedForStrong: !dead && recentEvidence.some(Boolean),
    dead,
    insufficient,
    recentDataStatus,
    evidenceCount: recentEvidence.filter(Boolean).length
  };
}

function decide(totalScore: number, recentGate: ReturnType<typeof recentProductionGate>, dataQuality: number, dataWarnings: string[]) {
  const blockers: string[] = [];
  if (recentGate.insufficient) blockers.push("INSUFFICIENT_RECENT_DATA: cobertura 10-15 min insuficiente; se limita alerta fuerte sin asumir ritmo muerto.");
  if (recentGate.dead) blockers.push("Ãšltimos 10-15 min muertos: no se permite score 8+.");
  if (!recentGate.allowedForStrong) blockers.push("Sin SOT/xG/gran ocasiÃ³n/presiÃ³n equivalente reciente.");
  if (dataQuality < 45) blockers.push("Datos crÃ­ticos N/D: solo debug, sin alerta fuerte.");
  if (dataWarnings.length) blockers.push("DATA_WARNING reduce confianza.");

  if (totalScore >= 9) return { decision: "PRIORITY_ALERT" as const, reason: "Score >=9 con producciÃ³n reciente vÃ¡lida.", blockers };
  if (totalScore >= 8) return { decision: "STRONG_ALERT" as const, reason: "Score >=8 con evidencia reciente suficiente.", blockers };
  if (totalScore >= 7) return { decision: "WATCH" as const, reason: "Score 7.0-7.9: vigilar sin emitir alerta fuerte.", blockers };
  return {
    decision: "NO_ALERT" as const,
    reason: blockers[0] ?? `Score ${totalScore}/10 por debajo del umbral WATCH.`,
    blockers
  };
}

function isUsableRecentWindow(window: LiveGoalRadarWindowDebug) {
  return window.coveragePercentage >= 75 &&
    (window.dataState === "VALID_DATA" || window.dataState === "OBSERVED_ZERO") &&
    [window.shotsNew, window.shotsOnTargetNew, window.xgDelta, window.cornersNew, window.dangerousAttacksNew, window.attacksNew].some((value) => value !== null);
}

function scoreDataQuality(context: MatchAnalysisContext, ndFields: string[], warnings: string[]) {
  const momentum = context.liveMomentum;
  let score = 100;
  score -= ndFields.length * 5;
  score -= warnings.length * 10;
  if (!momentum?.recent.ten.isComplete) score -= 12;
  if (!momentum?.recent.fifteen.isComplete) score -= 12;
  if (context.dataFreshness?.liveDataStale) score -= 14;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function collectMissingFields(context: MatchAnalysisContext) {
  const match = context.match;
  const missing: string[] = [];
  const checks: Array<[string, unknown]> = [
    ["home.shots", match.stats.home.shots],
    ["away.shots", match.stats.away.shots],
    ["home.SOT", match.stats.home.shotsOnTarget],
    ["away.SOT", match.stats.away.shotsOnTarget],
    ["home.xG", match.stats.home.xg],
    ["away.xG", match.stats.away.xg],
    ["bigChances", null],
    ["shotsInsideBox", null],
    ["woodwork", null],
    ["liveMomentum.10", context.liveMomentum?.recent.ten.isComplete ? true : null],
    ["liveMomentum.15", context.liveMomentum?.recent.fifteen.isComplete ? true : null]
  ];
  checks.forEach(([name, value]) => {
    if (value === null || value === undefined) missing.push(name);
  });
  return missing;
}

function collectDataWarnings(context: MatchAnalysisContext) {
  const warnings = [...(context.liveMomentum?.notes.filter((note) => note.includes("DATA_WARNING")) ?? [])];
  if (context.dataFreshness?.liveDataStale) warnings.push(...context.dataFreshness.staleReasons);
  return warnings;
}

function buildReasons(
  context: MatchAnalysisContext,
  windows: LiveGoalRadarCandidate["windows"],
  historical: LiveGoalRadarCandidate["historical"],
  recentGate: ReturnType<typeof recentProductionGate>
) {
  const reasons = [
    `Recent live: 10' SOT ${format(windows.ten.shotsOnTargetNew)}, xG ${format(windows.ten.xgDelta)}, corners ${format(windows.ten.cornersNew)}, DA ${format(windows.ten.dangerousAttacksNew)}.`,
    `Recent gate: ${recentGate.recentDataStatus}; ${recentGate.allowedForStrong ? "evidencia reciente suficiente" : "sin evidencia reciente suficiente"} (${recentGate.evidenceCount} seÃ±ales).`,
    historical.summary[0],
    context.liveMomentum ? `Momentum: reciente ${context.liveMomentum.recentMomentumScore}/100, seÃ±al ${context.liveMomentum.goalPressureSignal}, presiÃ³n ${context.liveMomentum.pressureStrength}.` : "Momentum: N/D."
  ];
  return reasons.filter((item): item is string => Boolean(item));
}

function blendScoringConceding(context: MatchAnalysisContext) {
  const home = context.recentHome.slice(0, 10);
  const away = context.recentAway.slice(0, 10);
  if (!home.length || !away.length) return null;
  const homeScored = rate(home, (match) => goalsFor(match, context.match.homeTeam) > 0);
  const awayConceded = rate(away, (match) => goalsAgainst(match, context.match.awayTeam) > 0);
  const awayScored = rate(away, (match) => goalsFor(match, context.match.awayTeam) > 0);
  const homeConceded = rate(home, (match) => goalsAgainst(match, context.match.homeTeam) > 0);
  return average([blendRate(homeScored, awayConceded), blendRate(awayScored, homeConceded)]);
}

function hasGoalInPeriod(match: MatchDetail, start: number, end: number) {
  if (match.events.length) {
    return match.events.some((event) => event.type === "goal" && event.minute >= start && event.minute <= end);
  }
  return null;
}

function periodForMinute(minute: number) {
  if (minute <= 15) return { label: "0-15", start: 0, end: 15 };
  if (minute <= 30) return { label: "16-30", start: 16, end: 30 };
  if (minute <= 45) return { label: "31-45+", start: 31, end: 45 };
  if (minute <= 60) return { label: "46-60", start: 46, end: 60 };
  if (minute <= 75) return { label: "61-75", start: 61, end: 75 };
  return { label: "76-90+", start: 76, end: 130 };
}

function rate(matches: MatchDetail[], predicate: (match: MatchDetail) => boolean | null) {
  const values = matches.map(predicate).filter((value): value is boolean => value !== null);
  if (!values.length) return null;
  return round1((values.filter(Boolean).length / values.length) * 10);
}

function goalsFor(match: MatchDetail, team: string) {
  if (match.homeTeam === team) return match.score.home;
  if (match.awayTeam === team) return match.score.away;
  return Math.max(match.score.home, match.score.away);
}

function goalsAgainst(match: MatchDetail, team: string) {
  if (match.homeTeam === team) return match.score.away;
  if (match.awayTeam === team) return match.score.home;
  return Math.min(match.score.home, match.score.away);
}

function blendRate(a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  return (a + b) / 2;
}

function average(values: Array<number | null>) {
  const clean = values.filter((value): value is number => value !== null);
  if (!clean.length) return null;
  return clean.reduce((total, value) => total + value, 0) / clean.length;
}

function scoreMetric(value: number | null | undefined, target: number, weight: number) {
  if (value === null || value === undefined) return 0;
  return Math.min(weight, (Math.max(0, value) / target) * weight);
}

function sum(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a + b;
}

function scale(value: number | null, factor: number) {
  return value === null ? null : value * factor;
}

function clamp10(value: number) {
  return Math.max(0, Math.min(10, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function format(value: number | null | undefined) {
  return value === null || value === undefined ? "N/D" : String(value);
}
