import type { MatchAlert, MatchDetail, TeamStats } from "@/types/domain";

function diff(current: number | undefined, previous: number | undefined) {
  return (current ?? 0) - (previous ?? 0);
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

  const homeShotsSpike = diff(match.stats.home.shots ?? undefined, previous.home.shots ?? undefined);
  const awayShotsSpike = diff(match.stats.away.shots ?? undefined, previous.away.shots ?? undefined);
  const homeXgSpike = diff(match.stats.home.xg ?? undefined, previous.home.xg ?? undefined);
  const awayXgSpike = diff(match.stats.away.xg ?? undefined, previous.away.xg ?? undefined);
  const dangerousSwing =
    diff(match.stats.home.dangerousAttacks ?? undefined, previous.home.dangerousAttacks ?? undefined) -
    diff(match.stats.away.dangerousAttacks ?? undefined, previous.away.dangerousAttacks ?? undefined);

  if (homeShotsSpike >= 4 || awayShotsSpike >= 4) {
    alerts.push({
      type: "SHOTS_SPIKE",
      severity: 7,
      activityScore,
      title: "Incremento fuerte de remates",
      message: `Cambio detectado: ${match.homeTeam} +${homeShotsSpike}, ${match.awayTeam} +${awayShotsSpike} remates desde la medicion anterior.`,
      minute: match.minute
    });
  }

  if (homeXgSpike >= 0.35 || awayXgSpike >= 0.35) {
    alerts.push({
      type: "XG_SPIKE",
      severity: 8,
      activityScore,
      title: "Incremento fuerte de xG",
      message: `xG reciente: ${match.homeTeam} +${homeXgSpike.toFixed(2)}, ${match.awayTeam} +${awayXgSpike.toFixed(2)}.`,
      minute: match.minute
    });
  }

  if (dangerousSwing >= 10) {
    alerts.push({
      type: "DOMINANCE",
      severity: 7,
      activityScore,
      title: "Dominio repentino",
      message: `${match.homeTeam} aumento claramente sus ataques peligrosos frente al tramo anterior.`,
      minute: match.minute
    });
  }

  return alerts;
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
