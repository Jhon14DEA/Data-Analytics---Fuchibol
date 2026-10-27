import { ShieldAlert } from "lucide-react";
import { LiveGoalRadarMonitor } from "@/components/LiveGoalRadarMonitor";
import { MainNav } from "@/components/MainNav";

export const dynamic = "force-dynamic";

export default function LiveGoalRadarPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-5 border-b border-white/10 pb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/25">
          <ShieldAlert className="h-3.5 w-3.5" />
          Radar live
        </div>
        <h1 className="text-3xl font-black text-white">Radar automático Over 0.5</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
          Consulta automática del debug live cada 120 segundos. Esta pantalla solo monitorea señales, no genera apuestas ni modifica recomendaciones.
        </p>
      </header>
      <LiveGoalRadarMonitor />
    </main>
  );
}
