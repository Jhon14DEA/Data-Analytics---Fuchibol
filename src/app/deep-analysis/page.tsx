import { MainNav } from "@/components/MainNav";
import { MatchSearch } from "@/components/MatchSearch";

export const dynamic = "force-dynamic";

export default function DeepAnalysisSearchPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-5 border-b border-white/10 pb-5">
        <h1 className="text-3xl font-black text-white">Analisis especifico</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
          Busca por equipo, cruce, competicion o fecha. El sistema solo muestra datos reales disponibles; lo faltante queda como N/D.
        </p>
      </header>
      <MatchSearch label="Analizar partido especifico" target="deep-analysis" showDate />
    </main>
  );
}
