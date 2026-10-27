import type { MatchAlert, MatchDetail, TeamStats } from "@/types/domain";

function diff(current: number | null | undefined, previous: number | null | undefined) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  return current - previous;
}

export const LIVE_ACTIVITY_THRESHOLD = 7;

export function detectAlerts(
  match: MatchDetail,
  previous: { home: TeamStats; away: TeamStats } | null
): MatchAlert[] {
  const alerts = [...match.alerts];

  if (!previous || match.status !== "LIVE") {
    return alerts;
  }

  const activityScore = calculateLiveActivityScore(match);
  if (activityScore < LIVE_ACTIVITY_THRESHOLD) {
    return alerts;
  }

  const homeShotsSpike = diff(match.stats.home.shots, previous.home.shots);
  const awayShotsSpike = diff(match.stats.away.shots, previous.away.shots);
  const homeSotSpike = diff(match.stats.home.shotsOnTarget, previous.home.shotsOnTarget);
  const awaySotSpike = diff(match.stats.away.shotsOnTarget, previous.away.shotsOnTarget);
  const homeXgSpike = diff(match.stats.home.xg, previous.home.xg);
  const awayXgSpike = diff(match.stats.away.xg, previous.away.xg);
  const homeCornersSpike = diff(match.stats.home.corners, previous.home.corners);
  const awayCornersSpike = diff(match.stats.away.corners, previous.away.corners);
  const homeCardsSpike = sumNullableDiffs(diff(match.stats.home.yellowCards, previous.home.yellowCards), diff(match.stats.home.redCards, previous.home.redCards));
  const awayCardsSpike = sumNullableDiffs(diff(match.stats.away.yellowCards, previous.away.yellowCards), diff(match.stats.away.redCards, previous.away.redCards));
  const redSpike = sumNullableDiffs(diff(match.stats.home.redCards, previous.home.redCards), diff(match.stats.away.redCards, previous.away.redCards));
  const dangerousSwing = nullableSubtract(diff(match.stats.home.dangerousAttacks, previous.home.dangerousAttacks), diff(match.stats.away.dangerousAttacks, previous.away.dangerousAttacks));

  if ((homeShotsSpike ?? 0) >= 4 || (awayShotsSpike ?? 0) >= 4) {
    alerts.push(withFingerprint(match.id, {
      type: "SHOTS_SPIKE",
      severity: 7,
      activityScore,
      title: "Incremento fuerte de remates",
      message: `Cambio detectado: ${match.homeTeam} +${formatDelta(homeShotsSpike)}, ${match.awayTeam} +${formatDelta(awayShotsSpike)} remates desde la medicion anterior.`,
      minute: match.minute
    }));
  }

  if ((homeSotSpike ?? 0) >= 2 || (awaySotSpike ?? 0) >= 2) {
    alerts.push(withFingerprint(match.id, {
      type: "SHOTS_ON_TARGET",
      severity: 8,
      activityScore,
      title: "Incremento de remates al arco",
      message: `Cambio detectado: ${match.homeTeam} +${formatDelta(homeSotSpike)}, ${match.awayTeam} +${formatDelta(awaySotSpike)} al arco desde la medicion anterior.`,
      minute: match.minute
    }));
  }

  if ((homeXgSpike ?? 0) >= 0.35 || (awayXgSpike ?? 0) >= 0.35) {
    alerts.push(withFingerprint(match.id, {
      type: "XG_SPIKE",
      severity: 8,
      activityScore,
      title: "Incremento fuerte de xG",
      message: `xG reciente: ${match.homeTeam} +${formatDecimalDelta(homeXgSpike)}, ${match.awayTeam} +${formatDecimalDelta(awayXgSpike)}.`,
      minute: match.minute
    }));
  }

  if ((homeCornersSpike ?? 0) >= 2 || (awayCornersSpike ?? 0) >= 2) {
    alerts.push(withFingerprint(match.id, {
      type: "CORNERS",
      severity: 7,
      activityScore,
      title: "Incremento de corners",
      message: `Corners recientes: ${match.homeTeam} +${formatDelta(homeCornersSpike)}, ${match.awayTeam} +${formatDelta(awayCornersSpike)}.`,
      minute: match.minute
    }));
  }

  if ((homeCardsSpike ?? 0) >= 1 || (awayCardsSpike ?? 0) >= 1) {
    alerts.push(withFingerprint(match.id, {
      type: (redSpike ?? 0) >= 1 ? "RED_CARD" : "CARDS",
      severity: (redSpike ?? 0) >= 1 ? 10 : 7,
      activityScore,
      title: (redSpike ?? 0) >= 1 ? "Tarjeta roja" : "Nueva tarjeta",
      message: `Tarjetas recientes: ${match.homeTeam} +${formatDelta(homeCardsSpike)}, ${match.awayTeam} +${formatDelta(awayCardsSpike)}.`,
      minute: match.minute
    }));
  }

  if ((dangerousSwing ?? 0) >= 10) {
    alerts.push(withFingerprint(match.id, {
      type: "DOMINANCE",
      severity: 7,
      activityScore,
      title: "Dominio repentino",
      message: `${match.homeTeam} aumento claramente sus ataques peligrosos frente al tramo anterior.`,
      minute: match.minute
    }));
  }

  if (((homeSotSpike ?? 0) >= 2 || (awaySotSpike ?? 0) >= 2) && match.minute !== null && match.minute >= 70) {
    alerts.push(withFingerprint(match.id, {
      type: "LATE_GOAL_NEED_PRESSURE",
      severity: 8,
      activityScore,
      title: "75'+ con necesidad y SOT recientes",
      message: "El tramo final trae remates al arco recientes. Revisar mercado de gol con cuota fresca, sin asumir entrada automatica.",
      minute: match.minute
    }));
  }

  return alerts;
}

function withFingerprint(matchId: string, alert: MatchAlert): MatchAlert {
  return {
    ...alert,
    fingerprint: `${matchId}:${alert.type}:${alert.minute ?? "na"}:${alert.message}`
  };
}

function formatDelta(value: number | null) {
  return value === null ? "N/D" : String(value);
}

function formatDecimalDelta(value: number | null) {
  return value === null ? "N/D" : value.toFixed(2);
}

function sumNullableDiffs(...values: Array<number | null>) {
  const clean = values.filter((value): value is number => value !== null);
  return clean.length ? clean.reduce((total, value) => total + value, 0) : null;
}

function nullableSubtract(a: number | null, b: number | null) {
  if (a === null || b === null) return null;
  return a - b;
}

export function calculateLiveActivityScore(match: MatchDetail) {
  if (match.status !== "LIVE") {
    return 0;
  }

  const stats = match.stats;
  const totals = {
    shots: sumStat(stats.home.shots, stats.away.shots),
    shotsOnTarget: sumStat(stats.home.shotsOnTarget, stats.away.shotsOnTarget),
    xg: sumStat(stats.home.xg, stats.away.xg),
    corners: sumStat(stats.home.corners, stats.away.corners)
  };
  const available = [
    stats.home.possession,
    stats.away.possession,
    totals.shots,
    totals.shotsOnTarget,
    totals.xg,
    totals.corners,
    stats.home.yellowCards,
    stats.away.yellowCards,
    stats.home.dangerousAttacks,
    stats.away.dangerousAttacks
  ].filter((value) => value !== null && value !== undefined).length;

  const dataCoverage = Math.min(4, (available / 10) * 4);
  const liveIntensity = [
    totals.shots !== null && totals.shots >= 12,
    totals.shotsOnTarget !== null && totals.shotsOnTarget >= 4,
    totals.xg !== null && totals.xg >= 1.2,
    totals.corners !== null && totals.corners >= 5
  ].filter(Boolean).length * 1.5;

  return Number(Math.min(10, dataCoverage + liveIntensity).toFixed(1));
}

function sumStat(home: number | null | undefined, away: number | null | undefined) {
  if (home === null || home === undefined || away === null || away === undefined) {
    return null;
  }
  return home + away;
}
