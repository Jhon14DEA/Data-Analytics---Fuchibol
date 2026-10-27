import type { AnalysisClassification, BetDecisionState } from "@/types/domain";

type BadgeState = AnalysisClassification | BetDecisionState;

const styles: Record<BadgeState, string> = {
  "RESPALDO MUY FUERTE": "bg-emerald-300/20 text-emerald-100 ring-emerald-200/40",
  "RESPALDO FUERTE": "bg-signal-green/15 text-signal-green ring-signal-green/30",
  "APUESTA RECOMENDADA": "bg-signal-green/15 text-signal-green ring-signal-green/30",
  "VENTANA TEMPRANA DE VALOR": "bg-emerald-300/15 text-emerald-100 ring-emerald-200/30",
  INTERESANTE: "bg-signal-yellow/15 text-signal-yellow ring-signal-yellow/30",
  VIGILAR: "bg-signal-yellow/15 text-signal-yellow ring-signal-yellow/30",
  ESPERAR: "bg-signal-yellow/15 text-signal-yellow ring-signal-yellow/30",
  "RIESGO ALTO": "bg-signal-orange/15 text-signal-orange ring-signal-orange/30",
  DESCARTAR: "bg-signal-red/15 text-signal-red ring-signal-red/30",
  "SIN APUESTA": "bg-zinc-500/15 text-zinc-300 ring-zinc-400/30"
};

export function ConfidenceBadge({ classification }: { classification: BadgeState }) {
  return (
    <span className={`rounded px-2 py-1 text-[11px] font-extrabold uppercase ring-1 ${styles[classification]}`}>
      {classification}
    </span>
  );
}
