import { getPerformanceMetricRecords } from "@/lib/performance";
import { getMatchAnalysisContext } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";
import { allSportsApiCapabilities } from "@/providers/football/capabilities";
import type {
  AnalyzedMarket,
  DeepDataQuality,
  DeepMatchAnalysis,
  DeepMetricSummary,
  DeepSuggestion,
  MatchAnalysisContext,
  MatchDetail,
  OddsQuote,
  PlayerStat,
  TeamSide,
  TeamStats
} from "@/types/domain";

const NO_BET = "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE EN ESTE MOMENTO" as const;

export async function getDeepMatchAnalysis(fixtureId: string): Promise<DeepMatchAnalysis | null> {
  const before = getPerformanceMetricRecords().length;
  const context = await getMatchAnalysisContext(fixtureId);
  const metrics = getPerformanceMetricRecords().slice(before);

  if (!context) {
    return null;
  }

  const dataQuality = calculateDataQuality(context);
  const isFinal = context.match.status === "FINISHED";
  const suggestions = isFinal ? [] : buildSuggestions(context, dataQuality).slice(0, 8);
  const playerMarkets = isFinal ? [] : buildPlayerMarkets(context, dataQuality.score).slice(0, 5);
  const validSuggestions = suggestions.filter((item) => item.confidence >= 5 && item.state !== "DESCARTAR");

  return {
    fixtureId,
    provider: context.provider,
    capabilities: allSportsApiCapabilities.capabilities,
    generatedAt: new Date().toISOString(),
    apiRequestsUsed: metrics.filter((item) => item.provider && item.cache === "miss").length,
    cache: {
      hits: metrics.filter((item) => item.cache === "hit").length,
      misses: metrics.filter((item) => item.cache === "miss").length,
      processes: [...new Set(metrics.map((item) => item.process))]
    },
    match: context.match,
    dataQuality,
    importance: buildImportance(context),
    h2h: {
      last5: summarizeMatches(context.h2h.slice(0, 5), context.match.homeTeam),
      last10: summarizeMatches(context.h2h.slice(0, 10), context.match.homeTeam),
      notes: context.h2h.length
        ? [`H2H disponible: ${context.h2h.length} partidos recientes entregados por el proveedor.`]
        : ["N/D"]
    },
    form: {
      homeLast5: summarizeMatches(context.recentHome.slice(-5), context.match.homeTeam),
      homeLast10: summarizeMatches(context.recentHome.slice(-10), context.match.homeTeam),
      awayLast5: summarizeMatches(context.recentAway.slice(-5), context.match.awayTeam),
      awayLast10: summarizeMatches(context.recentAway.slice(-10), context.match.awayTeam)
    },
    coaches: {
      home: coachSignals(context.recentHome),
      away: coachSignals(context.recentAway),
      unavailable: ["Entrenador confirmado", "patron exacto de cambios ofensivos/defensivos"]
    },
    lineups: buildLineupAnalysis(context.match),
    players: {
      items: context.match.playerStats,
      unavailable: context.match.playerStats.length ? ["xA", "minutos temporada", "balon parado si el proveedor no lo entrega"] : ["estadisticas individuales"]
    },
    playerMarkets,
    referee: {
      summary: "N/D",
      unavailable: ["arbitro confirmado", "promedio tarjetas del arbitro", "penales por partido"]
    },
    live: buildLiveAnalysis(context.match),
    liveMomentum: context.liveMomentum ?? null,
    substitutions: context.match.substitutions.map((event) => ({
      minute: event.minute,
      team: event.team,
      detail: event.detail,
      impact: classifySubstitution(event.minute, context.match.minute)
    })),
    odds: buildOddsMovement(context.match.odds, context.match.oddsHistory),
    suggestions: validSuggestions,
    noBetMessage: validSuggestions.length ? undefined : NO_BET
  };
}

function calculateDataQuality(context: MatchAnalysisContext): DeepDataQuality {
  const match = context.match;
  const components = {
    historical: context.recentHome.length >= 5 && context.recentAway.length >= 5,
    liveStats: hasCoreStats(match.stats.home) || hasCoreStats(match.stats.away),
    lineups: match.lineups.home.length > 0 && match.lineups.away.length > 0,
    players: match.playerStats.length > 0,
    referee: false,
    odds: match.odds.length > 0
  };
  const weights = { historical: 25, liveStats: 25, lineups: 15, players: 15, referee: 5, odds: 15 };
  const score = Object.entries(components).reduce((sum, [key, available]) => sum + (available ? weights[key as keyof typeof weights] : 0), 0);
  const missing = Object.entries(components)
    .filter(([, available]) => !available)
    .map(([key]) => componentLabel(key));

  return { score, missing, components };
}

function buildImportance(context: MatchAnalysisContext) {
  const unavailable = ["tabla de posiciones", "brecha de puntos", "necesidad matematica", "global de ida/vuelta"];
  const isCup = /champions|europa|conference|libertadores|sudamericana|cup|copa/i.test(context.match.competition);
  return {
    summary: isCup
      ? "Contexto copero detectado por competicion; la importancia exacta depende de ronda/tabla no disponible."
      : "Importancia competitiva exacta N/D porque AllSportsApi no entrego standings en esta carga.",
    homeIncentives: isCup ? ["Evitar conceder y proteger gestion del partido si el marcador favorece."] : ["N/D"],
    awayIncentives: isCup ? ["Ajustar ritmo segun marcador y condicion visitante."] : ["N/D"],
    unavailable
  };
}

function buildLineupAnalysis(match: MatchDetail): DeepMatchAnalysis["lineups"] {
  const total = match.lineups.home.length + match.lineups.away.length;
  if (!total) {
    return {
      classification: "N/D",
      summary: "Alineaciones no disponibles.",
      expectedVsConfirmed: "N/D",
      unavailable: ["once probable", "once confirmado", "bajas", "rotaciones"]
    };
  }

  return {
    classification: total >= 22 ? "NORMAL" : total >= 16 ? "CAMBIO MENOR" : "IMPORTANTE",
    summary: `${total} jugadores de alineacion disponibles.`,
    expectedVsConfirmed: "Comparacion esperado vs confirmado N/D sin once probable historico.",
    unavailable: ["bajas confirmadas", "once probable previo"]
  };
}

function buildLiveAnalysis(match: MatchDetail) {
  if (match.status !== "LIVE") {
    return { summary: "Partido no esta en vivo.", unavailable: ["ritmo ultimos 5-15 minutos", "comparacion contra snapshot anterior"] };
  }

  const totalShots = sumStat(match.stats.home.shots, match.stats.away.shots);
  const totalSot = sumStat(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget);
  const totalCorners = sumStat(match.stats.home.corners, match.stats.away.corners);
  const totalXg = sumStat(match.stats.home.xg, match.stats.away.xg);
  return {
    summary: `Minuto ${match.minute ?? "N/D"}: remates ${formatNullable(totalShots)}, al arco ${formatNullable(totalSot)}, corners ${formatNullable(totalCorners)}, xG ${formatNullable(totalXg)}.`,
    unavailable: ["periodos exactos si no existen snapshots suficientes", "xG por periodo si el proveedor no lo entrega"]
  };
}

function buildSuggestions(context: MatchAnalysisContext, dataQuality: DeepDataQuality): DeepSuggestion[] {
  const match = context.match;
  const odds = match.odds;
  const candidates: DeepSuggestion[] = [];

  candidates.push(...goalSuggestionsFromFinalAnalyzer(context, dataQuality));

  candidates.push(buildBothTeamsScoreSuggestion(context, dataQuality));

  const corners = sumStat(match.stats.home.corners, match.stats.away.corners);
  const cornersOdd = findOdd(odds, ["corner"]);
  if (cornersOdd && corners !== null) {
    const confidence = capConfidence(5.2 + scoreValue(corners, 7), 10);
    candidates.push({
      market: cornersOdd.market,
      selection: cornersOdd.selection,
      bookmaker: cornersOdd.bookmaker,
      odd: cornersOdd.price,
      confidence,
      dataQuality: dataQuality.score,
      evidenceScore: Math.round(confidence * 10),
      state: stateFromConfidence(confidence),
      supportingData: [`Corners live combinados: ${corners}`, `Posesion local: ${formatNullable(match.stats.home.possession)}%`].filter(hasDataText),
      risks: ["Mercado sensible al marcador.", "Sin datos de corners historicos fiables del proveedor."],
      invalidators: ["equipo dominante deja de atacar por bandas", "ritmo de corners se corta"]
    });
  }

  const cards = sumStat(match.stats.home.yellowCards, match.stats.away.yellowCards);
  const cardsOdd = findOdd(odds, ["card", "tarjeta"]);
  if (cardsOdd && cards !== null) {
    const confidence = capConfidence(5 + scoreValue(cards, 4), 10);
    candidates.push({
      market: cardsOdd.market,
      selection: cardsOdd.selection,
      bookmaker: cardsOdd.bookmaker,
      odd: cardsOdd.price,
      confidence,
      dataQuality: dataQuality.score,
      evidenceScore: Math.round(confidence * 10),
      state: stateFromConfidence(confidence),
      supportingData: [`Tarjetas live combinadas: ${cards}`, `Faltas live: ${formatNullable(sumStat(match.stats.home.fouls, match.stats.away.fouls))}`].filter(hasDataText),
      risks: ["Arbitro no disponible.", "Faltas sin tarjetas pueden inflar lectura."],
      invalidators: ["partido se enfria", "arbitro mantiene criterio permisivo"]
    });
  }

  const resultOdd = findOdd(odds, ["resultado"]);
  if (resultOdd && context.h2h.length >= 3 && context.recentHome.length >= 5 && context.recentAway.length >= 5) {
    const confidence = capConfidence(5.8, 10);
    candidates.push({
      market: resultOdd.market,
      selection: resultOdd.selection,
      bookmaker: resultOdd.bookmaker,
      odd: resultOdd.price,
      confidence,
      dataQuality: dataQuality.score,
      evidenceScore: Math.round(confidence * 10),
      state: stateFromConfidence(confidence),
      supportingData: ["Hay H2H y forma reciente suficientes para comparar, pero no se recomienda solo por favoritismo."],
      risks: ["Mercado 1X2 tiene alta varianza.", "Faltan standings/bajas confirmadas."],
      invalidators: ["alineacion inesperada", "roja/gol temprano"]
    });
  }

  return candidates
    .filter((candidate) => candidate.supportingData.length >= 1)
    .sort((a, b) => b.confidence - a.confidence);
}

function goalSuggestionsFromFinalAnalyzer(context: MatchAnalysisContext, dataQuality: DeepDataQuality): DeepSuggestion[] {
  const analysis = analyzeMatchContext(context);
  return (analysis.allMarkets ?? analysis.markets)
    .filter((market) => market.market === "Over/Under goles" && market.selection.toLowerCase().includes("over"))
    .map((market) => mapAnalyzedMarketToDeepSuggestion(market, dataQuality));
}

function mapAnalyzedMarketToDeepSuggestion(market: AnalyzedMarket, dataQuality: DeepDataQuality): DeepSuggestion {
  return {
    market: market.market,
    selection: market.selection,
    bookmaker: market.bookmaker ?? "N/D",
    odd: market.odd ?? null,
    confidence: market.confidence,
    dataQuality: market.dataQuality ?? dataQuality.score,
    evidenceScore: Math.round(market.confidence * 10),
    goalsNeeded: market.finalTimeDebug?.goalsNeeded ?? undefined,
    timeRemaining: market.finalTimeDebug?.remainingMinutes === null || market.finalTimeDebug?.remainingMinutes === undefined
      ? "N/D"
      : `${market.finalTimeDebug.remainingMinutes} min`,
    finalTimeDebug: market.finalTimeDebug,
    state: market.decision ?? stateFromConfidence(market.confidence, Boolean(market.odd)),
    supportingData: market.supportingData,
    risks: market.risks,
    invalidators: market.invalidators
  };
}

function buildGoalLineSuggestion(context: MatchAnalysisContext, dataQuality: DeepDataQuality, line: number): DeepSuggestion {
  const match = context.match;
  const currentGoals = match.score.home + match.score.away;
  const goalsNeeded = Math.max(0, Math.floor(line + 0.5) - currentGoals);
  if (goalsNeeded === 0) {
    return {
      market: "Total goles",
      selection: `Mas de ${line} goles`,
      bookmaker: "N/D",
      odd: null,
      confidence: 0,
      dataQuality: dataQuality.score,
      evidenceScore: 0,
      goalsNeeded,
      timeRemaining: match.minute === null ? "N/D" : `${Math.max(0, 90 - match.minute)} min + añadido`,
      state: "DESCARTAR",
      supportingData: [`Linea ya cumplida con marcador ${match.score.home}-${match.score.away}; no es una entrada nueva.`],
      risks: ["No recomendar mercados ya resueltos."],
      invalidators: ["Linea ya cumplida"]
    };
  }
  const remaining = match.minute === null ? null : Math.max(0, 90 - match.minute);
  const homeForm = summarizeMatches(context.recentHome.slice(-10), match.homeTeam);
  const awayForm = summarizeMatches(context.recentAway.slice(-10), match.awayTeam);
  const h2h = summarizeMatches(context.h2h.slice(0, 10), match.homeTeam);
  const live = liveGoalEvidence(match, goalsNeeded, remaining);
  const form = goalFormEvidence(line, homeForm, awayForm);
  const h2hScore = goalH2hEvidence(line, h2h);
  const contextScore = goalContextEvidence(match, goalsNeeded, remaining);
  const lineupsScore = match.lineups.home.length + match.lineups.away.length >= 18 ? 7 : match.lineups.home.length + match.lineups.away.length > 0 ? 4 : 0;
  const odd = findGoalOdd(match.odds, line);
  const oddsScore = odd ? 4 : 0;
  const goalNeedPenalty = Math.max(0, goalsNeeded - 1) * 8;
  const evidenceScore = Math.min(100, Math.max(0, Math.round(live.points + form.points + h2hScore.points + contextScore + lineupsScore + oddsScore - goalNeedPenalty)));
  const confidence = capConfidence(evidenceScore / 10, 10);

  return {
    market: "Total goles",
    selection: `Mas de ${line} goles`,
    bookmaker: odd?.bookmaker ?? "N/D",
    odd: odd?.price ?? null,
    confidence,
    dataQuality: dataQuality.score,
    evidenceScore,
    goalsNeeded,
    timeRemaining: remaining === null ? "N/D" : `${remaining} min + añadido`,
    state: stateFromConfidence(confidence, Boolean(odd)),
    supportingData: [
      `Faltan ${goalsNeeded} gol(es) para superar la linea.`,
      remaining !== null ? `Tiempo restante estimado: ${remaining} min + añadido.` : null,
      `Marcador actual: ${match.score.home}-${match.score.away}.`,
      ...live.reasons,
      ...form.reasons,
      ...h2hScore.reasons,
      odd ? `Cuota disponible: ${odd.price.toFixed(2)} en ${odd.bookmaker}.` : null
    ].filter((item): item is string => Boolean(item)).slice(0, 6),
    risks: [
      match.stats.home.xg === null && match.stats.away.xg === null ? "xG live no disponible." : null,
      match.stats.home.shotsOnTarget === null && match.stats.away.shotsOnTarget === null ? "Tiros al arco live no disponibles." : null,
      goalsNeeded >= 2 ? "La linea exige dos o mas goles adicionales." : null
    ].filter((item): item is string => Boolean(item)).slice(0, 3),
    invalidators: ["Ritmo ofensivo bajo sostenido", "sustituciones defensivas", "cuota cae sin nueva evidencia", "tarjeta roja que cambie el plan de partido"]
  };
}

function buildBothTeamsScoreSuggestion(context: MatchAnalysisContext, dataQuality: DeepDataQuality): DeepSuggestion {
  const match = context.match;
  const critical = bttsCriticalPenalty(match);
  const homeScored = match.score.home > 0;
  const awayScored = match.score.away > 0;
  const goalsNeeded = homeScored && awayScored ? 0 : 1;
  const homeForm = summarizeMatches(context.recentHome.slice(-10), match.homeTeam);
  const awayForm = summarizeMatches(context.recentAway.slice(-10), match.awayTeam);
  const h2h = summarizeMatches(context.h2h.slice(0, 10), match.homeTeam);
  const live = goalsNeeded === 0 ? 35 : liveGoalEvidence(match, goalsNeeded, match.minute === null ? null : Math.max(0, 90 - match.minute)).points;
  const formPoints = ((homeForm.bttsRate ?? 0) + (awayForm.bttsRate ?? 0)) / 20;
  const h2hPoints = (h2h.bttsRate ?? 0) / 100 * 15;
  const rawEvidenceScore = Math.min(100, Math.round(live + Math.min(20, formPoints) + Math.min(15, h2hPoints)));
  const evidenceScore = critical ? Math.min(Math.round(critical.maxConfidence * 10), Math.max(0, rawEvidenceScore - critical.penalty * 10)) : rawEvidenceScore;
  const confidence = capConfidence(evidenceScore / 10, 10);
  const odd = findOdd(match.odds, ["bts", "ambos", "both"]);

  return {
    market: "Ambos marcan",
    selection: "Si",
    bookmaker: odd?.bookmaker ?? "N/D",
    odd: odd?.price ?? null,
    confidence,
    dataQuality: dataQuality.score,
    evidenceScore,
    goalsNeeded,
    timeRemaining: match.minute === null ? "N/D" : `${Math.max(0, 90 - match.minute)} min + añadido`,
    state: stateFromConfidence(confidence, Boolean(odd)),
    supportingData: [
      goalsNeeded === 0 ? "Ambos equipos ya marcaron." : "Falta que marque un equipo.",
      `BTTS forma local: ${formatNullable(homeForm.bttsRate)}%.`,
      `BTTS forma visitante: ${formatNullable(awayForm.bttsRate)}%.`,
      `BTTS H2H: ${formatNullable(h2h.bttsRate)}%.`,
      match.status === "LIVE" ? redCardAnalysisSummary(match) : null,
      critical?.supportingData ?? null
    ].filter((item): item is string => typeof item === "string" && hasDataText(item)),
    risks: ["Si el equipo que falta marcar no genera remates, se descarta.", "Sin xG live, lectura ofensiva parcial.", ...(critical?.risks ?? [])],
    invalidators: ["Baja actividad ofensiva", "cambios defensivos", "expulsion que reduzca proyeccion del equipo que necesita marcar"]
  };
}

function buildPlayerMarkets(context: MatchAnalysisContext, maxConfidence: number): DeepSuggestion[] {
  return context.match.playerStats
    .filter((player) => player.shots !== null || player.shotsOnTarget !== null || player.foulsCommitted !== null)
    .slice(0, 8)
    .map((player) => {
      const confidence = capConfidence(5 + scoreValue(player.shots, 3) + scoreValue(player.shotsOnTarget, 1), maxConfidence);
      return {
        market: "Jugador",
        selection: `${player.player} remates / al arco`,
        bookmaker: "N/D",
        odd: null,
        confidence,
        dataQuality: maxConfidence,
        evidenceScore: Math.round(confidence * 10),
        state: "SIN APUESTA",
        supportingData: [
          `Remates actuales: ${formatNullable(player.shots)}`,
          `Remates al arco actuales: ${formatNullable(player.shotsOnTarget)}`,
          `xG jugador: ${formatNullable(player.xg)}`
        ].filter(hasDataText),
        risks: ["Sin cuota exacta no se recomienda ejecutar.", "Faltan ultimos 5 partidos individuales."],
        invalidators: ["jugador sustituido", "cambio de posicion/rol"]
      };
    });
}

function liveGoalEvidence(match: MatchDetail, goalsNeeded: number, remaining: number | null) {
  if (goalsNeeded === 0) return { points: 40, reasons: ["La linea ya esta cumplida; no se recomienda entrada nueva sobre esa linea."] };
  const reasons: string[] = [];
  let points = 0;
  if (match.status === "LIVE") {
    points += 8;
    reasons.push(`Partido en vivo al ${match.minute ?? "N/D"}'.`);
  }
  if (remaining !== null) {
    const timeFactor = goalsNeeded === 1 ? remaining / 45 : remaining / 90;
    points += Math.max(0, Math.min(10, timeFactor * 10));
  }
  const shots = sumStat(match.stats.home.shots, match.stats.away.shots);
  if (shots !== null) {
    points += Math.min(8, shots / 2);
    reasons.push(`Remates live combinados: ${shots}.`);
  }
  const sot = sumStat(match.stats.home.shotsOnTarget, match.stats.away.shotsOnTarget);
  if (sot !== null) {
    points += Math.min(10, sot * 1.6);
    reasons.push(`Tiros al arco live combinados: ${sot}.`);
  }
  const xg = sumStat(match.stats.home.xg, match.stats.away.xg);
  if (xg !== null) {
    points += Math.min(7, xg * 4);
    reasons.push(`xG live combinado: ${xg}.`);
  }
  const dangerous = sumStat(match.stats.home.dangerousAttacks, match.stats.away.dangerousAttacks);
  if (dangerous !== null) {
    points += Math.min(5, dangerous / 10);
    reasons.push(`Ataques peligrosos: ${dangerous}.`);
  }
  const corners = sumStat(match.stats.home.corners, match.stats.away.corners);
  if (corners !== null) {
    points += Math.min(5, corners * 1.25);
    reasons.push(`Corners live: ${corners}.`);
  }
  if (goalsNeeded === 1 && (sot ?? 0) >= 6 && ((corners ?? 0) >= 4 || (dangerous ?? 0) >= 35)) {
    points += 8;
    reasons.push("Solo falta un gol y hay actividad ofensiva live suficiente.");
  }
  return { points: Math.min(40, points), reasons };
}

function goalFormEvidence(line: number, home: DeepMetricSummary, away: DeepMetricSummary) {
  const reasons: string[] = [];
  let points = 0;
  const rateKey = line <= 1.5 ? "over15Rate" : "over25Rate";
  const rate = avg([home[rateKey], away[rateKey]]);
  if (rate !== null) {
    points += Math.min(14, (rate / 100) * 20);
    reasons.push(`Forma reciente over ${line}: ${round(rate)}%.`);
  }
  const goalsAvg = avg([home.goalsForAvg, away.goalsForAvg, home.goalsAgainstAvg, away.goalsAgainstAvg]);
  if (goalsAvg !== null) {
    points += Math.min(6, goalsAvg * 2);
    reasons.push(`Promedio de goles forma reciente: ${round(goalsAvg)}.`);
  }
  return { points: Math.min(20, points), reasons };
}

function goalH2hEvidence(line: number, h2h: DeepMetricSummary) {
  const reasons: string[] = [];
  if (!h2h.matches) return { points: 0, reasons };
  const rate = line <= 1.5 ? h2h.over15Rate : h2h.over25Rate;
  const points = rate === null ? 0 : Math.min(15, (rate / 100) * 18);
  if (rate !== null) reasons.push(`H2H over ${line}: ${rate}% en ${h2h.matches} partidos.`);
  return { points, reasons };
}

function goalContextEvidence(match: MatchDetail, goalsNeeded: number, remaining: number | null) {
  let points = 0;
  if (match.status === "LIVE") points += 3;
  if (goalsNeeded === 1) points += 4;
  if (remaining !== null && remaining >= 30) points += 3;
  if (match.score.home !== match.score.away) points += 2;
  return Math.min(10, points);
}

function findGoalOdd(odds: OddsQuote[], line: number) {
  const lineText = String(line);
  return odds.find((quote) => {
    const value = `${quote.market} ${quote.selection}`.toLowerCase();
    return (value.includes("over") || value.includes("mas") || value.includes("o+") || value.includes("total")) && value.includes(lineText);
  }) ?? findOdd(odds, ["over", "mas", "o+", "total"]);
}

function bttsCriticalPenalty(match: MatchDetail) {
  if (match.status !== "LIVE") return null;
  const sidesNeedingGoal: TeamSide[] = [];
  if (match.score.home === 0) sidesNeedingGoal.push("home");
  if (match.score.away === 0) sidesNeedingGoal.push("away");
  if (!sidesNeedingGoal.length) return null;
  const issues = sidesNeedingGoal.flatMap((side) => offensiveCriticalIssues(match, side));
  if (!issues.length) return null;
  const scoringIssues = issues.filter((issue) => issue.penalty > 0);
  if (!scoringIssues.length) return null;
  const hardStop = scoringIssues.some((issue) => issue.code === "RED_ZERO_SOT_LATE");
  return {
    penalty: scoringIssues.reduce((sum, issue) => sum + issue.penalty, 0),
    maxConfidence: hardStop ? 2 : 4,
    supportingData: `Evento critico detectado: ${scoringIssues.map((issue) => issue.label).join("; ")}.`,
    risks: scoringIssues.map((issue) => issue.risk)
  };
}

function offensiveCriticalIssues(match: MatchDetail, side: TeamSide) {
  const stats = match.stats[side];
  const opponent = match.stats[side === "home" ? "away" : "home"];
  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  const ownScore = side === "home" ? match.score.home : match.score.away;
  const oppScore = side === "home" ? match.score.away : match.score.home;
  const minute = match.minute ?? 0;
  const redCard = currentRedCardAssessment(match, side);
  const hasRed = redCard.status === "RED_CARD_CONFIRMED";
  const zeroSot = stats.shotsOnTarget === 0;
  const ownDangerous = stats.dangerousAttacks;
  const opponentDangerous = opponent.dangerousAttacks;
  const issues: { code: string; label: string; risk: string; penalty: number }[] = [];
  if (hasRed && minute > 70 && zeroSot) {
    issues.push({
      code: "RED_ZERO_SOT_LATE",
      label: `${teamName} necesita marcar, tiene roja y 0 tiros al arco despues del 70'`,
      risk: "Impacto de la roja: reduce fuertemente la probabilidad de gol del equipo que necesita anotar.",
      penalty: 6
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
      risk: "0 tiros al arco en minuto avanzado penaliza severamente BTTS.",
      penalty: 3
    });
  }
  if (stats.possession !== null && stats.possession < 35) {
    issues.push({ code: "LOW_POSSESSION", label: `${teamName} tiene posesion inferior al 35%`, risk: "Dominio bajo reduce confianza ofensiva.", penalty: 1.5 });
  }
  if (ownDangerous !== null && ownDangerous !== undefined && opponentDangerous !== null && opponentDangerous !== undefined && ownDangerous <= opponentDangerous * 0.45) {
    issues.push({ code: "LOW_DANGER", label: `${teamName} tiene ataques peligrosos muy inferiores`, risk: "Ataques peligrosos muy inferiores reducen probabilidad de gol.", penalty: 1.5 });
  }
  if (stats.shots !== null && opponent.shots !== null && stats.shots <= opponent.shots * 0.4) {
    issues.push({ code: "LOW_SHOTS", label: `${teamName} tiene remates muy inferiores`, risk: "Volumen de remates muy inferior limita respaldo ofensivo.", penalty: 1.5 });
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

function buildOddsMovement(current: OddsQuote[], history: OddsQuote[]) {
  return current.slice(0, 20).map((quote) => {
    const previous = history.find((item) => item.market === quote.market && item.selection === quote.selection && item.bookmaker === quote.bookmaker && item.price !== quote.price);
    const variation = previous ? quote.price - previous.price : null;
    return {
      bookmaker: quote.bookmaker,
      market: quote.market,
      selection: quote.selection,
      currentOdd: quote.price,
      previousOdd: previous?.price ?? null,
      variation,
      explanation: variation === null ? "Sin movimiento historico disponible." : variation < 0 ? "La cuota bajo frente al dato previo." : "La cuota subio frente al dato previo."
    };
  });
}

function summarizeMatches(matches: MatchDetail[], teamName: string): DeepMetricSummary {
  if (!matches.length) {
    return emptySummary();
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  const goalsFor: number[] = [];
  const goalsAgainst: number[] = [];
  const shots: number[] = [];
  const sot: number[] = [];
  const xg: number[] = [];
  const corners: number[] = [];
  const cards: number[] = [];
  let btts = 0;
  let over15 = 0;
  let over25 = 0;
  let clean = 0;

  matches.forEach((match) => {
    const side: TeamSide = normalizeTeam(match.homeTeam) === normalizeTeam(teamName) ? "home" : "away";
    const teamScore = side === "home" ? match.score.home : match.score.away;
    const rivalScore = side === "home" ? match.score.away : match.score.home;
    if (teamScore > rivalScore) wins += 1;
    else if (teamScore === rivalScore) draws += 1;
    else losses += 1;
    goalsFor.push(teamScore);
    goalsAgainst.push(rivalScore);
    if (teamScore > 0 && rivalScore > 0) btts += 1;
    if (teamScore + rivalScore > 1.5) over15 += 1;
    if (teamScore + rivalScore > 2.5) over25 += 1;
    if (rivalScore === 0) clean += 1;
    pushStat(shots, match.stats[side].shots);
    pushStat(sot, match.stats[side].shotsOnTarget);
    pushStat(xg, match.stats[side].xg);
    pushStat(corners, match.stats[side].corners);
    pushStat(cards, sumStat(match.stats[side].yellowCards, match.stats[side].redCards));
  });

  return {
    matches: matches.length,
    wins,
    draws,
    losses,
    goalsForAvg: round(avg(goalsFor)),
    goalsAgainstAvg: round(avg(goalsAgainst)),
    shotsAvg: round(avg(shots)),
    shotsOnTargetAvg: round(avg(sot)),
    xgAvg: round(avg(xg)),
    cornersAvg: round(avg(corners)),
    cardsAvg: round(avg(cards)),
    bttsRate: round((btts / matches.length) * 100),
    over15Rate: round((over15 / matches.length) * 100),
    over25Rate: round((over25 / matches.length) * 100),
    cleanSheetRate: round((clean / matches.length) * 100)
  };
}

function coachSignals(matches: MatchDetail[]) {
  const substitutions = matches.flatMap((match) => match.substitutions);
  if (!substitutions.length) {
    return ["N/D"];
  }
  const avgMinute = round(avg(substitutions.map((item) => item.minute)));
  return [`Primeras sustituciones observadas alrededor del ${formatNullable(avgMinute)}'.`, `Promedio de sustituciones por muestra: ${round(substitutions.length / matches.length) ?? "N/D"}.`];
}

function classifySubstitution(minute: number, currentMinute: number | null) {
  if (currentMinute !== null && minute >= currentMinute - 10) {
    return "Cambio reciente: recalcular ritmo y rol del jugador entrante.";
  }
  if (minute <= 45) {
    return "Cambio temprano: posible lesion o ajuste tactico importante.";
  }
  return "Cambio normal de gestion.";
}

function emptySummary(): DeepMetricSummary {
  return {
    matches: 0,
    wins: null,
    draws: null,
    losses: null,
    goalsForAvg: null,
    goalsAgainstAvg: null,
    shotsAvg: null,
    shotsOnTargetAvg: null,
    xgAvg: null,
    cornersAvg: null,
    cardsAvg: null,
    bttsRate: null,
    over15Rate: null,
    over25Rate: null,
    cleanSheetRate: null
  };
}

function hasCoreStats(stats: TeamStats) {
  return stats.shots !== null || stats.shotsOnTarget !== null || stats.xg !== null || stats.corners !== null;
}

function findOdd(odds: OddsQuote[], terms: string[]) {
  return odds.find((quote) => {
    if (!Number.isFinite(quote.price) || quote.price <= 1.05 || ["type", "id"].includes(quote.selection.toLowerCase())) return false;
    const value = `${quote.market} ${quote.selection}`.toLowerCase();
    return terms.some((term) => value.includes(term));
  });
}

function scoreValue(value: number | null, threshold: number) {
  if (value === null) return 0;
  return Math.min(2, Math.max(0, value / threshold));
}

function capConfidence(value: number, max: number) {
  return Math.min(max, Math.round(value * 2) / 2);
}

function stateFromConfidence(confidence: number, hasValidOdd = true) {
  if (!hasValidOdd) return "SIN APUESTA";
  if (confidence >= 8) return "APUESTA RECOMENDADA";
  if (confidence >= 7) return "INTERESANTE";
  if (confidence >= 5) return "ESPERAR";
  return "DESCARTAR";
}

function sumStat(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a + b;
}

function pushStat(values: number[], value: number | null | undefined) {
  if (value !== null && value !== undefined) values.push(value);
}

function avg(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function normalizeTeam(value: string | number | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function formatNullable(value: number | null | undefined) {
  return value === null || value === undefined ? "N/D" : String(value);
}

function hasDataText(value: string) {
  return !value.includes("N/D");
}

function componentLabel(key: string) {
  const labels: Record<string, string> = {
    historical: "historico 5-10 partidos",
    liveStats: "estadisticas live",
    lineups: "alineaciones",
    players: "jugadores",
    referee: "arbitro",
    odds: "cuotas"
  };
  return labels[key] ?? key;
}
