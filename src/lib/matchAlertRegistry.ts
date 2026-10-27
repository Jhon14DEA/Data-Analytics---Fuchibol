import type { CurrentRecommendation, MatchAlert, MatchAlertConfiguration, MatchAlertRuleType, MatchDetail, TeamStats } from "@/types/domain";

const DEFAULT_RULES: Record<MatchAlertRuleType, boolean> = {
  GOAL: true,
  SHOTS_ON_TARGET: true,
  XG: true,
  CORNERS: true,
  CARDS: true,
  SUBSTITUTIONS: true,
  ODDS: true,
  RECOMMENDATION_CHANGE: true
};

type AlertSnapshot = {
  scoreHome: number;
  scoreAway: number;
  minute: number | null;
  stats: { home: TeamStats; away: TeamStats };
  eventsCount: number;
  substitutionsCount: number;
  oddsKey: string;
  recommendationKey: string;
};

type RegistryState = {
  configs: Map<string, MatchAlertConfiguration>;
  snapshots: Map<string, AlertSnapshot>;
  fingerprints: Map<string, Set<string>>;
};

const globalRegistry = globalThis as typeof globalThis & { __futAlertRegistry?: RegistryState };
const registry =
  globalRegistry.__futAlertRegistry ??
  (globalRegistry.__futAlertRegistry = {
    configs: new Map<string, MatchAlertConfiguration>(),
    snapshots: new Map<string, AlertSnapshot>(),
    fingerprints: new Map<string, Set<string>>()
  });

export function getAlertConfiguration(matchId: string): MatchAlertConfiguration {
  return (
    registry.configs.get(matchId) ?? {
      matchId,
      enabled: false,
      rules: { ...DEFAULT_RULES },
      updatedAt: new Date().toISOString()
    }
  );
}

export function saveAlertConfiguration(matchId: string, rules: Partial<Record<MatchAlertRuleType, boolean>>, enabled = true) {
  const current = getAlertConfiguration(matchId);
  const config = {
    matchId,
    enabled,
    rules: { ...current.rules, ...rules },
    updatedAt: new Date().toISOString()
  };
  registry.configs.set(matchId, config);
  return config;
}

export function evaluateConfiguredAlerts(match: MatchDetail, recommendation: CurrentRecommendation): MatchAlert[] {
  const config = getAlertConfiguration(match.id);
  if (!config.enabled) return [];

  const current = toSnapshot(match, recommendation);
  const previous = registry.snapshots.get(match.id);
  registry.snapshots.set(match.id, current);
  if (!previous) return [];

  const generated = buildAlerts(match, previous, current, config.rules);
  const seen = registry.fingerprints.get(match.id) ?? new Set<string>();
  const fresh = generated.filter((alert) => {
    const fingerprint = alert.fingerprint ?? fingerprintFor(match.id, alert);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    alert.fingerprint = fingerprint;
    return true;
  });
  registry.fingerprints.set(match.id, seen);
  return fresh;
}

export function getRegisteredAlertCount(matchId: string) {
  return registry.fingerprints.get(matchId)?.size ?? 0;
}

function buildAlerts(
  match: MatchDetail,
  previous: AlertSnapshot,
  current: AlertSnapshot,
  rules: Record<MatchAlertRuleType, boolean>
): MatchAlert[] {
  const alerts: MatchAlert[] = [];
  const minute = match.minute;

  if (rules.GOAL && (current.scoreHome !== previous.scoreHome || current.scoreAway !== previous.scoreAway)) {
    alerts.push(makeAlert(match.id, "GOAL", 10, "Gol detectado", `Marcador cambio de ${previous.scoreHome}-${previous.scoreAway} a ${current.scoreHome}-${current.scoreAway}.`, minute));
  }

  const sotDiff = diffTotal(current.stats, previous.stats, "shotsOnTarget");
  if (rules.SHOTS_ON_TARGET && sotDiff >= 2) {
    alerts.push(makeAlert(match.id, "SHOTS_ON_TARGET", 8, "Incremento de remates al arco", `+${sotDiff} remates al arco desde la ultima evaluacion.`, minute));
  }

  const xgDiff = diffTotal(current.stats, previous.stats, "xg");
  if (rules.XG && xgDiff >= 0.35) {
    alerts.push(makeAlert(match.id, "XG_SPIKE", 8, "Incremento de xG", `xG subio +${xgDiff.toFixed(2)} desde la ultima evaluacion.`, minute));
  }

  const cornerDiff = diffTotal(current.stats, previous.stats, "corners");
  if (rules.CORNERS && cornerDiff >= 2) {
    alerts.push(makeAlert(match.id, "CORNERS", 7, "Ritmo de corners", `+${cornerDiff} corners desde la ultima evaluacion.`, minute));
  }

  const cardDiff = diffTotal(current.stats, previous.stats, "yellowCards") + diffTotal(current.stats, previous.stats, "redCards");
  if (rules.CARDS && cardDiff >= 1) {
    alerts.push(makeAlert(match.id, "CARDS", 7, "Nueva tarjeta", `+${cardDiff} tarjetas desde la ultima evaluacion.`, minute));
  }

  const redDiff = diffTotal(current.stats, previous.stats, "redCards");
  if (rules.CARDS && redDiff >= 1) {
    alerts.push(makeAlert(match.id, "RED_CARD", 10, "Tarjeta roja", "Cambio fuerte de condiciones por roja.", minute));
  }

  if (rules.SUBSTITUTIONS && current.substitutionsCount > previous.substitutionsCount) {
    alerts.push(makeAlert(match.id, "SUBSTITUTION", 6, "Cambio detectado", `Hay ${current.substitutionsCount - previous.substitutionsCount} sustitucion(es) nuevas.`, minute));
  }

  if (rules.ODDS && current.oddsKey !== previous.oddsKey) {
    alerts.push(makeAlert(match.id, "ODDS_MOVEMENT", 7, "Movimiento de cuota", "Las cuotas disponibles cambiaron frente a la evaluacion anterior.", minute));
  }

  if (rules.RECOMMENDATION_CHANGE && current.recommendationKey !== previous.recommendationKey) {
    const title = current.recommendationKey.includes("WATCH_ENTRY")
      ? "Ventana temprana de valor"
      : current.recommendationKey.includes("NO_BET")
      ? "Cambio de condiciones"
      : "Nueva oportunidad";
    const message = current.recommendationKey.includes("NO_BET")
      ? "No entrar actualmente: el motor no encuentra respaldo suficiente tras recalcular."
      : current.recommendationKey.includes("WATCH_ENTRY")
      ? `WATCH_ENTRY detectado: ${current.recommendationKey}. Revisar en 2 minutos o stake reducido si se confirma.`
      : `Recomendacion recalculada: ${current.recommendationKey}.`;
    alerts.push(makeAlert(match.id, current.recommendationKey.includes("WATCH_ENTRY") ? "EARLY_VALUE_WINDOW" : "RECOMMENDATION_CHANGE", 9, title, message, minute));
  }

  return alerts;
}

function toSnapshot(match: MatchDetail, recommendation: CurrentRecommendation): AlertSnapshot {
  const top = recommendation.options[0];
  return {
    scoreHome: match.score.home,
    scoreAway: match.score.away,
    minute: match.minute,
    stats: match.stats,
    eventsCount: match.events.length,
    substitutionsCount: match.substitutions.length,
    oddsKey: match.odds.map((quote) => `${quote.bookmaker}:${quote.market}:${quote.selection}:${quote.price}`).join("|"),
    recommendationKey: top ? `${top.market} ${top.selection} ${top.entryState ?? top.state} ${top.confidence}/10` : "NO_BET"
  };
}

function makeAlert(matchId: string, type: string, severity: number, title: string, message: string, minute: number | null): MatchAlert {
  const alert = { type, severity, title, message, minute, activityScore: severity };
  return { ...alert, fingerprint: fingerprintFor(matchId, alert) };
}

function fingerprintFor(matchId: string, alert: Omit<MatchAlert, "fingerprint">) {
  return `${matchId}:${alert.type}:${alert.minute ?? "na"}:${alert.title}:${alert.message}`;
}

function diffTotal(current: AlertSnapshot["stats"], previous: AlertSnapshot["stats"], key: keyof TeamStats) {
  const currentTotal = sumKnown(current.home[key], current.away[key]);
  const previousTotal = sumKnown(previous.home[key], previous.away[key]);
  if (currentTotal === null || previousTotal === null) return 0;
  return Math.max(0, currentTotal - previousTotal);
}

function sumKnown(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a + b;
}
