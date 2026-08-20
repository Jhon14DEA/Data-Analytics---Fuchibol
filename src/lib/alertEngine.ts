import type { MatchAlert, MatchDetail, TeamStats } from "@/types/domain";

function diff(current: number | undefined, previous: number | undefined) {
  return (current ?? 0) - (previous ?? 0);
}

export function detectAlerts(
  match: MatchDetail,
  previous: { home: TeamStats; away: TeamStats } | null
): MatchAlert[] {
  const alerts = [...match.alerts];

  if (!previous || match.status !== "LIVE") {
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
      title: "Incremento fuerte de remates",
      message: `Cambio detectado: ${match.homeTeam} +${homeShotsSpike}, ${match.awayTeam} +${awayShotsSpike} remates desde la medicion anterior.`,
      minute: match.minute
    });
  }

  if (homeXgSpike >= 0.35 || awayXgSpike >= 0.35) {
    alerts.push({
      type: "XG_SPIKE",
      severity: 8,
      title: "Incremento fuerte de xG",
      message: `xG reciente: ${match.homeTeam} +${homeXgSpike.toFixed(2)}, ${match.awayTeam} +${awayXgSpike.toFixed(2)}.`,
      minute: match.minute
    });
  }

  if (dangerousSwing >= 10) {
    alerts.push({
      type: "DOMINANCE",
      severity: 7,
      title: "Dominio repentino",
      message: `${match.homeTeam} aumento claramente sus ataques peligrosos frente al tramo anterior.`,
      minute: match.minute
    });
  }

  return alerts;
}
