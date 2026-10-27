import type {
  CriticalEventMomentumSplit,
  GoalPressureSignal,
  LiveAccumulatedStats,
  LiveMomentumAnalysis,
  LiveMomentumTrendState,
  LivePeriodLabel,
  LivePeriodStats,
  LiveWindowTeamStats,
  MatchDetail,
  PressureStrength,
  SubstitutionIntent,
  TacticalState,
  TeamLiveSnapshotDelta,
  TeamSide
} from "@/types/domain";

export type StoredLiveSnapshot = {
  timestamp: Date;
  minute: number | null;
  homeScore: number;
  awayScore: number;
  homeShots: number | null;
  awayShots: number | null;
  homeShotsOffTarget?: number | null;
  awayShotsOffTarget?: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homeXg: number | null;
  awayXg: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  homePossession: number | null;
  awayPossession: number | null;
  homeAttacks?: number | null;
  awayAttacks?: number | null;
  homeDangerousAttacks: number | null;
  awayDangerousAttacks: number | null;
};

const PERIODS: Array<{ period: LivePeriodLabel; start: number; end: number }> = [
  { period: "0-15", start: 0, end: 15 },
  { period: "16-30", start: 16, end: 30 },
  { period: "31-45+", start: 31, end: 45 },
  { period: "46-60", start: 46, end: 60 },
  { period: "61-75", start: 61, end: 75 },
  { period: "76-90+", start: 76, end: 130 }
];

export function buildLiveMomentumAnalysis(match: MatchDetail, snapshots: StoredLiveSnapshot[]): LiveMomentumAnalysis | null {
  if (match.status !== "LIVE") return null;

  const ordered = normalizeSnapshots(match, snapshots);
  const latest = ordered[ordered.length - 1] ?? snapshotFromMatch(match);
  const periods = PERIODS.map((period) => periodStats(period.period, period.start, period.end, ordered, match));
  const recent = {
    five: teamWindowDelta(latest, ordered, 5, match),
    ten: teamWindowDelta(latest, ordered, 10, match),
    fifteen: teamWindowDelta(latest, ordered, 15, match)
  };
  const accumulated = accumulatedStats(match);
  const cumulativeAttackScore = scoreCumulativeAttack(match);
  const recentMomentumScore = scoreRecentMomentum(recent, match);
  const { score: matchTrendScore, state: matchTrendState } = scoreMatchTrend(recent, match);
  const hasRecentData = [recent.five, recent.ten, recent.fifteen].some((window) => window.dataState === "VALID_DATA" || window.dataState === "OBSERVED_ZERO");
  const pressureStrength = hasRecentData ? pressureStrengthFor(recentMomentumScore) : "N/D";
  const strongerPressure = strongerPressureSide(match, recent);
  const goalPressureSignal = goalPressure(recentMomentumScore, matchTrendScore, matchTrendState, match, recent);
  const favoriteReactionSignal = favoriteReaction(match, recent, matchTrendState);
  const warnings = dataIntegrityWarnings(match);
  const tacticalState = {
    home: tacticalStateFor(match, "home", recent),
    away: tacticalStateFor(match, "away", recent)
  };

  return {
    available: ordered.length >= 2,
    periods,
    accumulated,
    recent,
    cumulativeAttackScore,
    recentMomentumScore,
    matchTrendScore,
    matchTrendState,
    trendDirection: matchTrendState,
    pressureStrength,
    strongerPressure,
    goalPressureSignal,
    favoriteReactionSignal,
    tacticalState,
    substitutions: substitutionImpacts(match, ordered),
    criticalSplits: criticalEventSplits(match, ordered),
    notes: [
      ordered.length >= 2
        ? `Momentum calculado con ${ordered.length} snapshots persistidos.`
        : "Momentum parcial: falta historial de snapshots; se usa acumulado actual cuando existe.",
      "Los periodos sin dos puntos de medicion suficientes quedan como N/D.",
      ...warnings
    ]
  };
}

export function scoreCumulativeAttack(match: MatchDetail) {
  const minute = Math.max(1, match.minute ?? 90);
  const pace = Math.min(1.35, 90 / minute);
  const shots = sum(match.stats.home.shots, match.stats.away.shots);
  const shotsOffTarget = sum(match.stats.home.shotsOffTarget, match.stats.away.shotsOffTarget);
  const sot = sum(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget);
  const xg = sum(match.stats.home.xg, match.stats.away.xg);
  const corners = sum(match.stats.home.corners, match.stats.away.corners);
  const attacks = sum(match.stats.home.attacks, match.stats.away.attacks);
  const dangerous = sum(match.stats.home.dangerousAttacks, match.stats.away.dangerousAttacks);
  const goals = match.score.home + match.score.away;
  return clampScore(
    scaled(shots === null ? null : shots * pace, 24, 20) +
      scaled(shotsOffTarget === null ? null : shotsOffTarget * pace, 18, 8) +
      scaled(sot === null ? null : sot * pace, 8, 28) +
      scaled(xg === null ? null : xg * pace, 2.4, 20) +
      scaled(corners === null ? null : corners * pace, 10, 12) +
      scaled(attacks === null ? null : attacks * pace, 120, 6) +
      scaled(dangerous === null ? null : dangerous * pace, 75, 14) +
      Math.min(6, goals * 3)
  );
}

export function scoreRecentMomentum(recent: LiveMomentumAnalysis["recent"], match: MatchDetail) {
  const late = (match.minute ?? 0) >= 85;
  const five = windowScore(recent.five, 5);
  const ten = windowScore(recent.ten, 10);
  const fifteen = windowScore(recent.fifteen, 15);
  const fallback = scoreCumulativeAttack(match) * 0.35;
  const hasRecent = recent.fifteen.isComplete && (
    recent.fifteen.shots !== null ||
    recent.fifteen.shotsOffTarget !== null ||
    recent.fifteen.shotsOnTarget !== null ||
    recent.fifteen.corners !== null ||
    recent.fifteen.attacks !== null ||
    recent.fifteen.dangerousAttacks !== null
  );
  const value = hasRecent
    ? late
      ? five * 0.5 + ten * 0.35 + fifteen * 0.15
      : five * 0.25 + ten * 0.35 + fifteen * 0.4
    : fallback;
  return clampScore(value);
}

export function scoreMatchTrend(recent: LiveMomentumAnalysis["recent"], match: MatchDetail): { score: number; state: LiveMomentumTrendState } {
  const tenRate = perMinutePressure(recent.ten, 10);
  const fifteenRate = perMinutePressure(recent.fifteen, 15);
  const fiveRate = perMinutePressure(recent.five, 5);
  const cumulativeScore = scoreCumulativeAttack(match);
  const cumulativeRate = cumulativeScore / Math.max(1, match.minute ?? 90);
  const recentRate = average([fiveRate, tenRate, fifteenRate]);
  const recentScore = scoreRecentMomentum(recent, match);
  const capByRecent = (score: number) => {
    if (recentScore < 20) return Math.min(score, 45);
    if (recentScore < 30) return Math.min(score, 60);
    return score;
  };
  if (recentRate !== null && recentScore <= cumulativeScore * 0.35) {
    return { score: clampScore(capByRecent(32 + recentScore * 0.15)), state: "CAYENDO" };
  }
  if (recentRate !== null && recentScore >= Math.max(48, cumulativeScore * 0.72)) {
    return { score: clampScore(capByRecent(68 + recentScore * 0.25)), state: "SUBIENDO" };
  }
  const baseline = cumulativeRate;
  const ratio = recentRate === null || baseline <= 0 ? 1 : recentRate / baseline;
  const state: LiveMomentumTrendState = ratio >= 1.25 ? "SUBIENDO" : ratio <= 0.72 ? "CAYENDO" : "ESTABLE";
  const trendBias = state === "SUBIENDO" ? 14 : state === "CAYENDO" ? -18 : 0;
  return { score: clampScore(capByRecent(50 + trendBias + (recentRate ?? 0) * 12)), state };
}

function periodStats(period: LivePeriodLabel, start: number, end: number, snapshots: StoredLiveSnapshot[], match: MatchDetail): LivePeriodStats {
  const inPeriod = snapshots.filter((item) => item.minute !== null && item.minute >= start && item.minute <= end);
  const endSnapshot = [...snapshots].reverse().find((item) => item.minute !== null && item.minute <= Math.min(end, match.minute ?? end));
  const startSnapshot = [...snapshots].reverse().find((item) => item.minute !== null && item.minute < start);
  const eventHome = eventCounts(match, "home", start, end);
  const eventAway = eventCounts(match, "away", start, end);
  const available = Boolean(endSnapshot && startSnapshot && endSnapshot !== startSnapshot);

  return {
    period,
    available,
    home: available && endSnapshot && startSnapshot
      ? withEventCounts(deltaTeam(endSnapshot, startSnapshot, "home", average(inPeriod.map((item) => item.homePossession))), eventHome)
      : withEventCounts(emptyTeamStats(), eventHome),
    away: available && endSnapshot && startSnapshot
      ? withEventCounts(deltaTeam(endSnapshot, startSnapshot, "away", average(inPeriod.map((item) => item.awayPossession))), eventAway)
      : withEventCounts(emptyTeamStats(), eventAway)
  };
}

function teamWindowDelta(latest: StoredLiveSnapshot, snapshots: StoredLiveSnapshot[], minutes: 5 | 10 | 15, match: MatchDetail): TeamLiveSnapshotDelta {
  const previous = snapshotAtOrBeforeWindowStart(latest, snapshots, minutes);
  const hasWindow = Boolean(previous && previous !== latest);
  const observedMinutes = previous ? observedSnapshotMinutes(latest, snapshots, minutes) : null;
  const coveragePercentage = observedMinutes === null ? 0 : Math.min(100, Math.round((observedMinutes / minutes) * 100));
  const isComplete = hasWindow && coveragePercentage >= 75;
  const start = latest.minute === null ? 0 : Math.max(0, latest.minute - minutes + 1);
  const end = latest.minute ?? 130;
  const homeEvents = eventCounts(match, "home", start, end);
  const awayEvents = eventCounts(match, "away", start, end);
  const rawHome = isComplete && previous ? deltaTeam(latest, previous, "home") : emptyTeamStats();
  const rawAway = isComplete && previous ? deltaTeam(latest, previous, "away") : emptyTeamStats();
  const invalid = isComplete && previous ? hasImpossibleWindowDelta(rawHome, rawAway, latest) : false;
  const home = isComplete && !invalid && previous ? withEventCounts(rawHome, homeEvents) : emptyTeamStats();
  const away = isComplete && !invalid && previous ? withEventCounts(rawAway, awayEvents) : emptyTeamStats();
  const dataState = windowDataState(isComplete, invalid, home, away);

  return {
    minutes,
    requestedMinutes: minutes,
    observedMinutes,
    coveragePercentage,
    isComplete: isComplete && !invalid,
    dataState,
    startSnapshotMinute: previous?.minute ?? null,
    endSnapshotMinute: latest.minute,
    shots: sum(home.shots, away.shots),
    shotsOffTarget: sum(home.shotsOffTarget, away.shotsOffTarget),
    shotsOnTarget: sum(home.shotsOnTarget, away.shotsOnTarget),
    xg: sum(home.xgDelta, away.xgDelta),
    corners: sum(home.corners, away.corners),
    attacks: sum(home.attacks, away.attacks),
    dangerousAttacks: sum(home.dangerousAttacks, away.dangerousAttacks),
    goals: sum(home.goals, away.goals),
    cards: sum(sum(home.yellowCards, away.yellowCards), sum(home.redCards, away.redCards)),
    substitutions: sum(home.substitutions, away.substitutions),
    home,
    away
  };
}

function substitutionImpacts(match: MatchDetail, snapshots: StoredLiveSnapshot[]) {
  return match.substitutions.map((event) => {
    const before = event.team ? windowAroundEvent(snapshots, event.minute, event.team, -10) : emptyTeamStats();
    const after5 = event.team ? windowAroundEvent(snapshots, event.minute, event.team, 5) : emptyTeamStats();
    const after = event.team ? windowAroundEvent(snapshots, event.minute, event.team, 10) : emptyTeamStats();
    const beforePressure = teamPressure(before);
    const afterPressure = teamPressure(after);
    const diff = afterPressure === null || beforePressure === null ? null : afterPressure - beforePressure;
    const afterCoverageOk = hasTeamWindowData(after5) || hasTeamWindowData(after);
    const impact: "POSITIVO" | "NEUTRO" | "NEGATIVO" | "INSUFFICIENT_DATA" | "N/D" =
      diff === null ? afterCoverageOk ? "N/D" : "INSUFFICIENT_DATA" : diff >= 12 ? "POSITIVO" : diff <= -12 ? "NEGATIVO" : "NEUTRO";
    const substitutionIntent = classifySubstitutionIntent(match, event.detail);
    return {
      minute: event.minute,
      team: event.team,
      detail: event.detail,
      substitutionIntent,
      before10: before,
      after5,
      after10: after,
      observedImpact: impact,
      impact,
      note: impact === "INSUFFICIENT_DATA"
        ? `Intencion ${substitutionIntent}; snapshots posteriores insuficientes para medir impacto.`
        : diff === null
        ? `Intencion ${substitutionIntent}; no hay snapshots suficientes antes/despues del cambio.`
        : `Intencion ${substitutionIntent}; impacto observado ${impact}: presión ${beforePressure?.toFixed(1)} -> ${afterPressure?.toFixed(1)}.`
    };
  });
}

function criticalEventSplits(match: MatchDetail, snapshots: StoredLiveSnapshot[]): CriticalEventMomentumSplit[] {
  return match.events
    .filter((event) => ["goal", "card", "var", "penalty", "injury"].includes(event.type))
    .map((event) => {
      const side = event.team ?? "home";
      const before = windowAroundEvent(snapshots, event.minute, side, -10);
      const after = windowAroundEvent(snapshots, event.minute, side, 10);
      const beforePressure = teamPressure(before);
      const afterPressure = teamPressure(after);
      const trend = beforePressure === null || afterPressure === null ? "N/D" : afterPressure > beforePressure * 1.25 ? "SUBIENDO" : afterPressure < beforePressure * 0.72 ? "CAYENDO" : "ESTABLE";
      return { minute: event.minute, type: event.type, team: event.team, title: event.title, before, after, trend };
    });
}

function windowAroundEvent(snapshots: StoredLiveSnapshot[], minute: number, side: TeamSide, offset: -10 | 5 | 10) {
  const from = offset < 0 ? minute - Math.abs(offset) : minute;
  const to = offset < 0 ? minute : minute + offset;
  const start = [...snapshots].reverse().find((item) => item.minute !== null && item.minute <= from);
  const end = [...snapshots].reverse().find((item) => item.minute !== null && item.minute <= to);
  if (!start || !end || start === end) return emptyTeamStats();
  return deltaTeam(end, start, side);
}

function goalPressure(recentMomentumScore: number, matchTrendScore: number, trend: LiveMomentumTrendState, match: MatchDetail, recent: LiveMomentumAnalysis["recent"]): GoalPressureSignal {
  const remaining = match.minute === null ? null : Math.max(0, 90 - match.minute);
  if (remaining !== null && remaining <= 3) return "SIN SEÑAL";
  const recentSot = recent.ten.shotsOnTarget ?? recent.fifteen.shotsOnTarget ?? 0;
  const base = recentMomentumScore * 0.65 + matchTrendScore * 0.35 + (recentSot >= 2 ? 8 : 0);
  if (base >= 74 && trend !== "CAYENDO") return "FUERTE";
  if (base >= 55) return "VIGILAR";
  return "SIN SEÑAL";
}

function strongerPressureSide(match: MatchDetail, recent: LiveMomentumAnalysis["recent"]): TeamSide | "balanced" | "N/D" {
  const home = teamPressure(recent.fifteen.home) ?? teamPressureFromMatch(match, "home");
  const away = teamPressure(recent.fifteen.away) ?? teamPressureFromMatch(match, "away");
  if (home === null || away === null) return "N/D";
  if (Math.abs(home - away) < 8) return "balanced";
  return home > away ? "home" : "away";
}

function favoriteReaction(match: MatchDetail, recent: LiveMomentumAnalysis["recent"], trend: LiveMomentumTrendState): LiveMomentumAnalysis["favoriteReactionSignal"] {
  const favorite = favoriteSideFromOdds(match);
  if (!favorite) return null;
  const favoriteGoals = favorite === "home" ? match.score.home : match.score.away;
  const opponentGoals = favorite === "home" ? match.score.away : match.score.home;
  if (favoriteGoals >= opponentGoals) return null;
  const window = recent.ten.isComplete ? recent.ten[favorite] : recent.fifteen.isComplete ? recent.fifteen[favorite] : null;
  if (!window) return null;
  const pressure = teamPressure(window);
  const reasons = [
    trend === "SUBIENDO" ? "tendencia reciente subiendo" : null,
    pressure !== null && pressure >= 35 ? `presión reciente ${pressure.toFixed(1)}/100` : null,
    (window.shotsOnTarget ?? 0) >= 1 ? `${window.shotsOnTarget} SOT recientes` : null,
    (window.corners ?? 0) >= 2 ? `${window.corners} corners recientes` : null,
    (window.dangerousAttacks ?? 0) >= 12 ? `${window.dangerousAttacks} ataques peligrosos recientes` : null
  ].filter((item): item is string => Boolean(item));
  if (reasons.length < 2) return null;
  return { team: favorite, label: "FAVORITO EN REACCIÓN", reasons };
}

function favoriteSideFromOdds(match: MatchDetail): TeamSide | null {
  const resultOdds = match.odds.filter((quote) => /resultado|1x2/i.test(quote.market));
  const home = resultOdds.find((quote) => quote.selection.toLowerCase() === "1");
  const away = resultOdds.find((quote) => quote.selection.toLowerCase() === "2");
  if (!home || !away) return null;
  if (Math.abs(home.price - away.price) < 0.15) return null;
  return home.price < away.price ? "home" : "away";
}

function dataIntegrityWarnings(match: MatchDetail) {
  const warnings: string[] = [];
  (["home", "away"] as TeamSide[]).forEach((side) => {
    const stats = match.stats[side];
    const knownAttempts = sum(stats.shotsOnTarget, stats.shotsOffTarget);
    if (stats.shots !== null && knownAttempts !== null && stats.shots < knownAttempts) {
      warnings.push(`DATA_WARNING: ${side} remates totales (${stats.shots}) < SOT+fuera (${knownAttempts}).`);
    }
  });
  const eventKeys = new Set<string>();
  for (const event of [...match.events, ...match.substitutions]) {
    const key = `${event.minute}:${event.type}:${event.team ?? "na"}:${event.title}:${event.detail}`;
    if (eventKeys.has(key)) warnings.push(`DATA_WARNING: evento duplicado detectado ${key}.`);
    eventKeys.add(key);
  }
  return warnings;
}

function pressureStrengthFor(score: number): PressureStrength {
  if (score >= 78) return "MUY_ALTA";
  if (score >= 58) return "ALTA";
  if (score >= 35) return "MEDIA";
  if (score < 15) return "MUY_BAJA";
  return "BAJA";
}

function hasImpossibleWindowDelta(home: LiveWindowTeamStats, away: LiveWindowTeamStats, latest: StoredLiveSnapshot) {
  const checks: Array<[number | null, number | null | undefined]> = [
    [home.shots, latest.homeShots],
    [away.shots, latest.awayShots],
    [home.shotsOnTarget, latest.homeShotsOnTarget],
    [away.shotsOnTarget, latest.awayShotsOnTarget],
    [home.corners, latest.homeCorners],
    [away.corners, latest.awayCorners],
    [home.dangerousAttacks, latest.homeDangerousAttacks],
    [away.dangerousAttacks, latest.awayDangerousAttacks],
    [home.xgDelta, latest.homeXg],
    [away.xgDelta, latest.awayXg]
  ];
  return checks.some(([delta, cumulative]) => delta !== null && cumulative !== null && cumulative !== undefined && delta > cumulative);
}

function windowDataState(isComplete: boolean, invalid: boolean, home: LiveWindowTeamStats, away: LiveWindowTeamStats): TeamLiveSnapshotDelta["dataState"] {
  if (!isComplete) return "INSUFFICIENT_DATA";
  if (invalid) return "INVALID_DATA";
  const values = [home.shots, away.shots, home.shotsOnTarget, away.shotsOnTarget, home.xgDelta, away.xgDelta, home.corners, away.corners, home.dangerousAttacks, away.dangerousAttacks];
  const available = values.filter((value) => value !== null);
  if (!available.length) return "INSUFFICIENT_DATA";
  return available.every((value) => value === 0) ? "OBSERVED_ZERO" : "VALID_DATA";
}

function hasTeamWindowData(stats: LiveWindowTeamStats) {
  return [stats.shots, stats.shotsOnTarget, stats.xgDelta, stats.corners, stats.dangerousAttacks, stats.goals, stats.yellowCards, stats.redCards].some((value) => value !== null);
}

function tacticalStateFor(match: MatchDetail, side: TeamSide, recent: LiveMomentumAnalysis["recent"]): TacticalState {
  const minute = match.minute ?? 0;
  const teamGoals = side === "home" ? match.score.home : match.score.away;
  const opponentGoals = side === "home" ? match.score.away : match.score.home;
  const goalDiff = teamGoals - opponentGoals;
  const pressure = teamPressure(recent.ten[side]) ?? teamPressure(recent.fifteen[side]) ?? teamPressureFromMatch(match, side);
  const redCards = match.stats[side].redCards ?? 0;

  if (goalDiff < 0 && minute >= 55) return pressure !== null && pressure >= 45 ? "ATTACKING" : "NEEDS_GOAL";
  if (goalDiff < 0) return "NEEDS_GOAL";
  if (goalDiff > 0 && minute >= 82) return redCards > 0 ? "PROTECTING" : "CLOSING";
  if (goalDiff > 0 && minute >= 70) return "PROTECTING";
  if (pressure !== null && pressure >= 58) return "ATTACKING";
  return "BALANCED";
}

function accumulatedStats(match: MatchDetail): LiveAccumulatedStats {
  return {
    totalShots: sum(match.stats.home.shots, match.stats.away.shots),
    totalShotsOffTarget: sum(match.stats.home.shotsOffTarget, match.stats.away.shotsOffTarget),
    totalShotsOnTarget: sum(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget),
    totalXg: sum(match.stats.home.xg, match.stats.away.xg),
    totalCorners: sum(match.stats.home.corners, match.stats.away.corners),
    totalAttacks: sum(match.stats.home.attacks, match.stats.away.attacks),
    totalDangerousAttacks: sum(match.stats.home.dangerousAttacks, match.stats.away.dangerousAttacks),
    totalCards: sum(sum(match.stats.home.yellowCards, match.stats.away.yellowCards), sum(match.stats.home.redCards, match.stats.away.redCards)),
    totalGoals: match.score.home + match.score.away
  };
}

function normalizeSnapshots(match: MatchDetail, snapshots: StoredLiveSnapshot[]) {
  const current = snapshotFromMatch(match);
  const byKey = new Map<string, StoredLiveSnapshot>();
  [...snapshots, current].forEach((item) => {
    byKey.set(`${item.minute ?? "N"}:${item.homeScore}-${item.awayScore}:${item.timestamp.getTime()}`, item);
  });
  return [...byKey.values()].sort((a, b) => {
    const minuteDiff = (a.minute ?? -1) - (b.minute ?? -1);
    return minuteDiff || a.timestamp.getTime() - b.timestamp.getTime();
  });
}

function observedWindowMinutes(latest: StoredLiveSnapshot, previous: StoredLiveSnapshot) {
  if (latest.minute !== null && previous.minute !== null) {
    return Math.max(0, latest.minute - previous.minute);
  }
  const elapsed = (latest.timestamp.getTime() - previous.timestamp.getTime()) / 60_000;
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed * 10) / 10) : null;
}

function snapshotAtOrBeforeWindowStart(latest: StoredLiveSnapshot, snapshots: StoredLiveSnapshot[], minutes: 5 | 10 | 15) {
  const targetMinute = latest.minute === null ? null : latest.minute - minutes;
  return snapshots.findLast((item) => {
    if (targetMinute !== null && item.minute !== null) return item.minute <= targetMinute;
    return latest.timestamp.getTime() - item.timestamp.getTime() >= minutes * 60_000;
  }) ?? null;
}

function observedSnapshotMinutes(latest: StoredLiveSnapshot, snapshots: StoredLiveSnapshot[], minutes: 5 | 10 | 15) {
  const windowStartMinute = latest.minute === null ? null : latest.minute - minutes;
  const maxGap = 6;
  const ordered = [...snapshots]
    .filter((item) => item !== latest)
    .concat(latest)
    .sort((a, b) => {
      const minuteDiff = (a.minute ?? -1) - (b.minute ?? -1);
      return minuteDiff || a.timestamp.getTime() - b.timestamp.getTime();
    });
  let observed = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1];
    const end = ordered[index];
    const gap = end.minute !== null && start.minute !== null
      ? Math.max(0, end.minute - start.minute)
      : Math.max(0, (end.timestamp.getTime() - start.timestamp.getTime()) / 60_000);
    if (!Number.isFinite(gap) || gap <= 0 || gap > maxGap) continue;
    if (latest.minute !== null && windowStartMinute !== null && start.minute !== null && end.minute !== null) {
      observed += Math.max(0, Math.min(end.minute, latest.minute) - Math.max(start.minute, windowStartMinute));
    } else {
      const windowStartTime = latest.timestamp.getTime() - minutes * 60_000;
      observed += Math.max(0, (Math.min(end.timestamp.getTime(), latest.timestamp.getTime()) - Math.max(start.timestamp.getTime(), windowStartTime)) / 60_000);
    }
  }
  return Math.max(0, Math.round(Math.min(minutes, observed) * 10) / 10);
}

function snapshotFromMatch(match: MatchDetail): StoredLiveSnapshot {
  return {
    timestamp: new Date(),
    minute: match.minute,
    homeScore: match.score.home,
    awayScore: match.score.away,
    homeShots: match.stats.home.shots,
    awayShots: match.stats.away.shots,
    homeShotsOffTarget: match.stats.home.shotsOffTarget ?? null,
    awayShotsOffTarget: match.stats.away.shotsOffTarget ?? null,
    homeShotsOnTarget: match.stats.home.shotsOnTarget,
    awayShotsOnTarget: match.stats.away.shotsOnTarget,
    homeXg: match.stats.home.xg,
    awayXg: match.stats.away.xg,
    homeCorners: match.stats.home.corners,
    awayCorners: match.stats.away.corners,
    homeYellowCards: match.stats.home.yellowCards,
    awayYellowCards: match.stats.away.yellowCards,
    homeRedCards: match.stats.home.redCards,
    awayRedCards: match.stats.away.redCards,
    homePossession: match.stats.home.possession,
    awayPossession: match.stats.away.possession,
    homeAttacks: match.stats.home.attacks ?? null,
    awayAttacks: match.stats.away.attacks ?? null,
    homeDangerousAttacks: match.stats.home.dangerousAttacks ?? null,
    awayDangerousAttacks: match.stats.away.dangerousAttacks ?? null
  };
}

function deltaTeam(end: StoredLiveSnapshot, start: StoredLiveSnapshot, side: TeamSide, possessionAvg: number | null = null): LiveWindowTeamStats {
  const p = side === "home" ? "home" : "away";
  return {
    shots: diff(end[`${p}Shots`], start[`${p}Shots`]),
    shotsOffTarget: diff(end[`${p}ShotsOffTarget`] ?? null, start[`${p}ShotsOffTarget`] ?? null),
    shotsOnTarget: diff(end[`${p}ShotsOnTarget`], start[`${p}ShotsOnTarget`]),
    xgDelta: diff(end[`${p}Xg`], start[`${p}Xg`]),
    corners: diff(end[`${p}Corners`], start[`${p}Corners`]),
    attacks: diff(end[`${p}Attacks`] ?? null, start[`${p}Attacks`] ?? null),
    dangerousAttacks: diff(end[`${p}DangerousAttacks`], start[`${p}DangerousAttacks`]),
    yellowCards: diff(end[`${p}YellowCards`], start[`${p}YellowCards`]),
    redCards: diff(end[`${p}RedCards`], start[`${p}RedCards`]),
    goals: side === "home" ? Math.max(0, end.homeScore - start.homeScore) : Math.max(0, end.awayScore - start.awayScore),
    substitutions: null,
    possessionAvg
  };
}

function eventCounts(match: MatchDetail, side: TeamSide, start: number, end: number) {
  const events = match.events.filter((event) => event.team === side && event.minute >= start && event.minute <= end);
  return {
    goals: events.filter((event) => event.type === "goal").length,
    yellowCards: events.filter((event) => event.type === "card" && !/red|roja/i.test(`${event.title} ${event.detail}`)).length,
    redCards: events.filter((event) => event.type === "card" && /red|roja/i.test(`${event.title} ${event.detail}`)).length,
    substitutions: match.substitutions.filter((event) => event.team === side && event.minute >= start && event.minute <= end).length
  };
}

function withEventCounts(stats: LiveWindowTeamStats, events: Pick<LiveWindowTeamStats, "goals" | "yellowCards" | "redCards" | "substitutions">) {
  return {
    ...stats,
    goals: stats.goals ?? events.goals,
    yellowCards: stats.yellowCards ?? events.yellowCards,
    redCards: stats.redCards ?? events.redCards,
    substitutions: events.substitutions
  };
}

function windowScore(window: TeamLiveSnapshotDelta, minutes: 5 | 10 | 15) {
  const scale = minutes === 5 ? 1 : minutes === 10 ? 0.75 : 0.55;
  return clampScore(
    scaled(window.shots, minutes === 5 ? 4 : minutes === 10 ? 7 : 10, 18 * scale) +
      scaled(window.shotsOffTarget, minutes === 5 ? 3 : minutes === 10 ? 5 : 8, 8 * scale) +
      scaled(window.shotsOnTarget, minutes === 5 ? 2 : minutes === 10 ? 3 : 4, 28 * scale) +
      scaled(window.xg, minutes === 5 ? 0.35 : minutes === 10 ? 0.65 : 0.9, 20 * scale) +
      scaled(window.corners, minutes === 5 ? 2 : minutes === 10 ? 3 : 4, 14 * scale) +
      scaled(window.attacks, minutes === 5 ? 18 : minutes === 10 ? 32 : 46, 7 * scale) +
      scaled(window.dangerousAttacks, minutes === 5 ? 15 : minutes === 10 ? 25 : 35, 16 * scale) +
      Math.min(8, (window.goals ?? 0) * 4)
  );
}

function perMinutePressure(window: TeamLiveSnapshotDelta, minutes: 5 | 10 | 15) {
  const score = windowScore(window, minutes);
  if (window.shots === null && window.shotsOffTarget === null && window.shotsOnTarget === null && window.corners === null && window.attacks === null && window.dangerousAttacks === null && window.xg === null) return null;
  return score / minutes;
}

function teamPressure(stats: LiveWindowTeamStats) {
  const hasInput = [
    stats.shots,
    stats.shotsOffTarget,
    stats.shotsOnTarget,
    stats.xgDelta,
    stats.corners,
    stats.attacks,
    stats.dangerousAttacks
  ].some((value) => value !== null && value !== undefined);
  if (!hasInput) return null;

  const values = [
    scaled(stats.shots, 5, 18),
    scaled(stats.shotsOffTarget, 4, 8),
    scaled(stats.shotsOnTarget, 2, 32),
    scaled(stats.xgDelta, 0.45, 20),
    scaled(stats.corners, 2, 14),
    scaled(stats.attacks, 20, 6),
    scaled(stats.dangerousAttacks, 16, 16)
  ];
  const available = values.filter((value) => value !== null);
  return available.length ? available.reduce((total, value) => total + (value ?? 0), 0) : null;
}

function teamPressureFromMatch(match: MatchDetail, side: TeamSide) {
  const stats = match.stats[side];
  return teamPressure({
    shots: stats.shots,
    shotsOffTarget: stats.shotsOffTarget ?? null,
    shotsOnTarget: stats.shotsOnTarget,
    xgDelta: stats.xg,
    corners: stats.corners,
    attacks: stats.attacks ?? null,
    dangerousAttacks: stats.dangerousAttacks ?? null,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    goals: side === "home" ? match.score.home : match.score.away,
    substitutions: null
  });
}

function classifySubstitutionIntent(match: MatchDetail, detail: string): SubstitutionIntent {
  const parts = detail.split(/\s+for\s+|\s+por\s+|->|-/i).map((item) => item.trim()).filter(Boolean);
  const inName = parts[0] ?? "";
  const outName = parts[1] ?? "";
  const inLine = playerLine(findPlayerPosition(match, inName));
  const outLine = playerLine(findPlayerPosition(match, outName));
  if (!inLine || !outLine) return "UNKNOWN";
  if (inLine === "ATTACK" && outLine === "DEFENSE") return "OFFENSIVE";
  if (inLine === "DEFENSE" && outLine === "ATTACK") return "DEFENSIVE";
  return "LIKE_FOR_LIKE";
}

function findPlayerPosition(match: MatchDetail, playerName: string) {
  const normalized = normalizeName(playerName);
  if (!normalized) return null;
  const lineupPlayer = [...match.lineups.home, ...match.lineups.away].find((player) => normalizeName(player.name).includes(normalized) || normalized.includes(normalizeName(player.name)));
  if (lineupPlayer?.position) return lineupPlayer.position;
  const statPlayer = match.playerStats.find((player) => normalizeName(player.player).includes(normalized) || normalized.includes(normalizeName(player.player)));
  return statPlayer?.position ?? null;
}

function playerLine(position: string | null | undefined) {
  const value = normalizeName(position ?? "");
  if (!value) return null;
  if (/(fw|st|cf|lw|rw|wing|delanter|forward|striker|attack)/.test(value)) return "ATTACK";
  if (/(am|cam|enganche|mediapunta)/.test(value)) return "ATTACK";
  if (/(df|cb|rb|lb|def|back|goalkeeper|gk|portero|arquero)/.test(value)) return "DEFENSE";
  if (/(mid|mf|cm|dm|volante|mediocamp)/.test(value)) return "MIDFIELD";
  return null;
}

function normalizeName(value: string | number | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function emptyTeamStats(): LiveWindowTeamStats {
  return {
    shots: null,
    shotsOffTarget: null,
    shotsOnTarget: null,
    xgDelta: null,
    corners: null,
    attacks: null,
    dangerousAttacks: null,
    yellowCards: null,
    redCards: null,
    goals: null,
    substitutions: null,
    possessionAvg: null
  };
}

function sum(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return a + b;
}

function diff(a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  return Math.max(0, Math.round((a - b) * 100) / 100);
}

function scaled(value: number | null | undefined, target: number, points: number) {
  if (value === null || value === undefined) return 0;
  return Math.min(points, Math.max(0, value / target) * points);
}

function average(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return clean.length ? clean.reduce((total, value) => total + value, 0) / clean.length : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
