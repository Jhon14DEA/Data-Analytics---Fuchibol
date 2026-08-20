import type { AnalysisPick, MatchDetail } from "@/types/domain";

export function analyzeMatch(match: MatchDetail): AnalysisPick[] {
  if (match.status === "FINISHED") {
    return [
      {
        market: "Cualquier mercado",
        selection: "Sin oportunidad",
        availableOdd: null,
        confidence: 1,
        classification: "DESCARTAR",
        reasons: ["NO HAY UNA OPORTUNIDAD CON RESPALDO SUFICIENTE."],
        risks: ["Partido finalizado o mercado sin liquidez accionable."],
        invalidators: ["No aplica."]
      }
    ];
  }

  const liveEdges = match.analysis.filter((pick) => pick.confidence >= 6);

  if (liveEdges.length === 0) {
    return [
      {
        market: "General",
        selection: "Esperar",
        availableOdd: null,
        confidence: 3,
        classification: "DESCARTAR",
        reasons: ["NO HAY UNA OPORTUNIDAD CON RESPALDO SUFICIENTE."],
        risks: ["La muestra actual no supera el umbral estadistico definido."],
        invalidators: ["Cambio de ritmo, alineaciones confirmadas o movimiento de cuota relevante."]
      }
    ];
  }

  return liveEdges;
}
