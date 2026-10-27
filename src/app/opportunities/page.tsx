import Link from "next/link";
import { Target } from "lucide-react";
import { AnalysisMarketCard } from "@/components/AnalysisMarketCard";
import { MainNav } from "@/components/MainNav";
import { buildOpportunityRadarDebug } from "@/lib/opportunityRadar";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const radar = await buildOpportunityRadarDebug();
  const opportunities = radar.opportunities;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-5 border-b border-white/10 pb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/25">
          <Target className="h-3.5 w-3.5" />
          Radar de oportunidades
        </div>
        <h1 className="text-3xl font-black text-white">TOP 5 OPORTUNIDADES DEL DÍA</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
          Se analizan partidos importantes del dia y solo se muestran lecturas con respaldo estadistico real suficiente.
        </p>
        <p className="mt-2 text-xs font-bold uppercase text-zinc-500">DATA UPDATED: {formatDateTime(new Date().toISOString())}</p>
      </header>

      <div className="space-y-4">
        {process.env.NODE_ENV !== "production" ? <DebugTable radar={radar} /> : null}

        {opportunities.length ? (
          opportunities.map((opportunity) => (
            <section key={opportunity.match.id} className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-white">
                    🟢 {opportunity.match.homeTeam} vs {opportunity.match.awayTeam}
                  </h2>
                  <p className="text-sm text-zinc-400">{opportunity.match.competition}</p>
                  <p className="mt-1 text-xs font-bold uppercase text-zinc-500">
                    DATA UPDATED: {formatDateTime(opportunity.dataUpdatedAt)} · {opportunity.statusIndicator}
                  </p>
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
            Hoy no hay oportunidades &gt;= 8/10 con respaldo suficiente.
            <p className="mt-2 text-sm text-zinc-400">
              Se analizaron {radar.matchesAnalyzed} partidos y {radar.marketsEvaluated} mercados; ninguno superó el umbral.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function DebugTable({ radar }: { radar: Awaited<ReturnType<typeof buildOpportunityRadarDebug>> }) {
  return (
    <section className="rounded-lg border border-yellow-300/20 bg-yellow-300/[0.055] p-4">
      <div className="mb-3">
        <p className="text-xs font-black uppercase text-yellow-100">DEBUG RADAR</p>
        <p className="mt-1 text-xs text-zinc-400">
          Provider: {radar.provider} · Fixtures revisados: {radar.matchesFoundToday} · Candidatos baratos: {radar.cheapCandidates} · Shortlist deep: {radar.deepShortlist} · Analizados: {radar.matchesAnalyzed} · Descartados: {radar.matchesDiscarded} · Requests: {radar.requestsConsumed} · Mercados: {radar.marketsEvaluated} · Top ejecutables: {radar.opportunities.length}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="uppercase text-zinc-500">
            <tr className="border-b border-white/10">
              <th className="py-2">Partido</th>
              <th>Mercado</th>
              <th>Selección</th>
              <th>Statistical Score</th>
              <th>Cuota</th>
              <th>Prob. implícita</th>
              <th>Prob. estimada</th>
              <th>Edge</th>
              <th>BET SCORE</th>
              <th>Estado apuesta</th>
              <th>Estado partido</th>
              <th>Mercados encontrados</th>
              <th>Motivo descarte</th>
            </tr>
          </thead>
          <tbody>
            {radar.debugRows.map((row) => (
              <tr key={row.matchId} className="border-b border-white/5 text-zinc-300">
                <td className="py-2">
                  <span className="font-bold text-white">{row.match}</span>
                  <span className="block text-zinc-500">{row.competition}</span>
                </td>
                <td>{row.bestMarket?.market ?? "N/D"}</td>
                <td>{row.bestMarket?.selection ?? "N/D"}</td>
                <td>{row.bestMarket ? `${row.bestMarket.statisticalScore}/10` : "N/D"}</td>
                <td>{row.bestMarket?.odd ? `${row.bestMarket.odd.toFixed(2)}${row.bestMarket.bookmaker ? ` · ${row.bestMarket.bookmaker}` : ""}` : "N/D"}</td>
                <td>{formatPercent(row.bestMarket?.impliedProbability)}</td>
                <td>{formatPercent(row.bestMarket?.estimatedProbability)}</td>
                <td>{formatPercent(row.bestMarket?.edge)}</td>
                <td>{row.bestMarket?.betScore !== null && row.bestMarket?.betScore !== undefined ? `${row.bestMarket.betScore}/10` : "N/D"}</td>
                <td>{row.bestMarket?.state ?? "DESCARTAR"}</td>
                <td>{row.status}</td>
                <td>{row.marketsFound}</td>
                <td>{row.discardReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function formatPercent(value: number | null | undefined) {
  return value !== null && value !== undefined ? `${(value * 100).toFixed(1)}%` : "N/D";
}
