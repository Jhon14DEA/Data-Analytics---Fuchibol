import { Bell } from "lucide-react";
import { MainNav } from "@/components/MainNav";
import { calculateLiveActivityScore, LIVE_ACTIVITY_THRESHOLD } from "@/lib/alertEngine";
import { footballProvider, getMatchAnalysisContext } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";
import type { MatchAnalysisResult } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const matches = await footballProvider.listMatches();
  const live = matches.filter((match) => match.status === "LIVE").slice(0, 10);
  const analyses = (
    await Promise.all(live.map((match) => getMatchAnalysisContext(match.id).then((context) => (context ? analyzeMatchContext(context) : null)).catch(() => null)))
  ).filter((analysis): analysis is MatchAnalysisResult => analysis !== null);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-5 border-b border-white/10 pb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded bg-yellow-400/10 px-2.5 py-1 text-xs font-bold uppercase text-yellow-100 ring-1 ring-yellow-300/25">
          <Bell className="h-3.5 w-3.5" />
          Alertas
        </div>
        <h1 className="text-3xl font-black text-white">Alertas en vivo</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
          Lectura conservadora de cambios disponibles en partidos en vivo. El historial fino de 5-15 minutos se mostrará cuando el proveedor lo entregue.
        </p>
      </header>
      <div className="space-y-3">
        {analyses.length ? (
          analyses.map((analysis) => (
            <article key={analysis.match.id} className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-white">
                    {analysis.match.homeTeam} vs {analysis.match.awayTeam}
                  </h2>
                  <p className="text-sm text-zinc-400">{analysis.match.competition}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-white">{liveLabel(analysis.liveState)}</p>
                  <p className="text-xs font-bold uppercase text-zinc-400">
                    Actividad estadistica {calculateLiveActivityScore(analysis.match).toFixed(1)}/10
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                Solo se generan alertas predictivas con actividad igual o superior a {LIVE_ACTIVITY_THRESHOLD}/10.
              </p>
            </article>
          ))
        ) : (
          <p className="rounded-lg border border-white/10 bg-white/[0.045] p-6 text-zinc-300">Sin partidos en vivo o sin datos suficientes.</p>
        )}
      </div>
    </main>
  );
}

function liveLabel(state: string) {
  const labels: Record<string, string> = {
    MEJORO: "🟢 MEJORÓ",
    IGUAL: "🟡 IGUAL",
    EMPEORO: "🟠 EMPEORÓ",
    "CAMBIO FUERTE": "🔴 CAMBIO FUERTE",
    "N/D": "N/D"
  };
  return labels[state] ?? "N/D";
}
