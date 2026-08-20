import Link from "next/link";
import { Target } from "lucide-react";
import { AnalysisMarketCard } from "@/components/AnalysisMarketCard";
import { MainNav } from "@/components/MainNav";
import { footballProvider, getMatchAnalysisContext } from "@/providers";
import { buildOpportunityRadar } from "@/services/analysis/matchAnalyzer";
import type { MatchAnalysisContext } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const matches = await footballProvider.listMatches();
  const contexts = (
    await Promise.all(
      matches
        .filter((match) => match.status !== "FINISHED")
        .slice(0, 12)
        .map((match) => getMatchAnalysisContext(match.id).catch(() => null))
    )
  ).filter((context): context is MatchAnalysisContext => context !== null);
  const opportunities = buildOpportunityRadar(contexts);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-5 border-b border-white/10 pb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/25">
          <Target className="h-3.5 w-3.5" />
          Radar de oportunidades
        </div>
        <h1 className="text-3xl font-black text-white">Oportunidades</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
          Se analizan partidos importantes del dia y solo se muestran lecturas con respaldo estadistico real suficiente.
        </p>
      </header>

      <div className="space-y-4">
        {opportunities.length ? (
          opportunities.map((opportunity) => (
            <section key={opportunity.match.id} className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-white">
                    🟢 {opportunity.match.homeTeam} vs {opportunity.match.awayTeam}
                  </h2>
                  <p className="text-sm text-zinc-400">{opportunity.match.competition}</p>
                </div>
                <Link href={`/analyze/${opportunity.match.id}`} className="rounded bg-emerald-400 px-3 py-2 text-sm font-black uppercase text-black hover:bg-emerald-300">
                  Ver análisis
                </Link>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {opportunity.markets.slice(0, 2).map((market) => (
                  <AnalysisMarketCard key={`${opportunity.match.id}-${market.market}-${market.selection}`} market={market} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-6 text-zinc-300">
            NO HAY OPORTUNIDAD CON RESPALDO SUFICIENTE
          </section>
        )}
      </div>
    </main>
  );
}
