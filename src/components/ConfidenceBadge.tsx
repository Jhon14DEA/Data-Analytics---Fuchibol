import type { AnalysisClassification } from "@/types/domain";

const styles: Record<AnalysisClassification, string> = {
  "RESPALDO FUERTE": "bg-signal-green/15 text-signal-green ring-signal-green/30",
  INTERESANTE: "bg-signal-yellow/15 text-signal-yellow ring-signal-yellow/30",
  VIGILAR: "bg-signal-yellow/15 text-signal-yellow ring-signal-yellow/30",
  "RIESGO ALTO": "bg-signal-orange/15 text-signal-orange ring-signal-orange/30",
  DESCARTAR: "bg-signal-red/15 text-signal-red ring-signal-red/30"
};

export function ConfidenceBadge({ classification }: { classification: AnalysisClassification }) {
  return (
    <span className={`rounded px-2 py-1 text-[11px] font-extrabold uppercase ring-1 ${styles[classification]}`}>
      {classification}
    </span>
  );
}
