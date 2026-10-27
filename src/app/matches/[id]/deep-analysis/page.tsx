import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Database, ShieldAlert, TrendingUp } from "lucide-react";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LiveMomentumPanel } from "@/components/LiveMomentumPanel";
import { MainNav } from "@/components/MainNav";
import { StatusPill } from "@/components/StatusPill";
import { getDeepMatchAnalysis } from "@/services/analysis/deepMatchAnalysis";
import type { DeepMetricSummary, DeepSuggestion } from "@/types/domain";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function DeepAnalysisPage({ params }: PageProps) {
  const { id } = await params;
  const analysis = await getDeepMatchAnalysis(id);

  if (!analysis) {
    notFound();
  }

  const match = analysis.match;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/deep-analysis" className="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" />
          Buscar otro partido
        </Link>
        <Link href={`/matches/${match.id}`} className="rounded px-3 py-2 text-sm font-bold text-emerald-200 ring-1 ring-emerald-300/25 hover:bg-emerald-300/10">
          Ver partido en vivo
        </Link>
      </div>

      <header className="mb-5 rounded-lg border border-white/10 bg-black/25 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-zinc-400">{match.competition}</p>
            <h1 className="mt-1 text-2xl font-black text-white sm:text-4xl">{match.homeTeam} vs {match.awayTeam}</h1>
            <p className="mt-2 text-sm text-zinc-300">
              Marcador {match.score.home}-{match.score.away} · Minuto {value(match.minute)} · Generado {formatDateTime(analysis.generatedAt)}
            </p>
          </div>
          <StatusPill status={match.status} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <InfoTile title="Calidad de datos" value={`${analysis.dataQuality.score}%`} detail={analysis.dataQuality.missing.length ? `Falta: ${analysis.dataQuality.missing.join(", ")}` : "Cobertura suficiente"} />
          <InfoTile title="API requests used" value={String(analysis.apiRequestsUsed)} detail={`Cache hits ${analysis.cache.hits} · misses ${analysis.cache.misses}`} />
          <InfoTile title="Proveedor" value={analysis.provider} detail={analysis.cache.processes.join(", ") || "N/D"} />
        </div>
      </header>

      <section className="mb-5 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4">
        <SectionTitle icon={<ShieldAlert className="h-4 w-4" />} title="Recomendaciones actuales" />
        {analysis.noBetMessage ? (
          <p className="mt-4 rounded border border-white/10 bg-black/20 p-4 text-sm font-black uppercase text-zinc-200">{analysis.noBetMessage}</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {analysis.suggestions.map((suggestion, index) => <SuggestionCard key={`${suggestion.market}-${index}`} suggestion={suggestion} index={index + 1} />)}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <div className="space-y-5">
          <Panel title="Importancia del partido">
            <p className="text-sm leading-6 text-zinc-300">{analysis.importance.summary}</p>
            <TwoColumnList leftTitle={match.homeTeam} left={analysis.importance.homeIncentives} rightTitle={match.awayTeam} right={analysis.importance.awayIncentives} />
            <Unavailable items={analysis.importance.unavailable} />
          </Panel>

          <Panel title="Forma reciente">
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard title={`${match.homeTeam} ultimos 5`} summary={analysis.form.homeLast5} />
              <MetricCard title={`${match.awayTeam} ultimos 5`} summary={analysis.form.awayLast5} />
              <MetricCard title={`${match.homeTeam} ultimos 10`} summary={analysis.form.homeLast10} />
              <MetricCard title={`${match.awayTeam} ultimos 10`} summary={analysis.form.awayLast10} />
            </div>
          </Panel>

          <Panel title="H2H reciente ponderado">
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard title="H2H ultimos 5" summary={analysis.h2h.last5} />
              <MetricCard title="H2H ultimos 10" summary={analysis.h2h.last10} />
            </div>
            <List title="Notas" items={analysis.h2h.notes} />
          </Panel>

          <Panel title="Alineaciones, entrenadores y sustituciones">
            <InfoTile title="Alineacion" value={analysis.lineups.classification} detail={analysis.lineups.summary} />
            <p className="mt-3 text-sm text-zinc-300">{analysis.lineups.expectedVsConfirmed}</p>
            <TwoColumnList leftTitle="Entrenador local" left={analysis.coaches.home} rightTitle="Entrenador visitante" right={analysis.coaches.away} />
            <List title="Sustituciones" items={analysis.substitutions.map((item) => `${item.minute}' ${item.detail} · ${item.impact}`)} />
            <Unavailable items={[...analysis.lineups.unavailable, ...analysis.coaches.unavailable]} />
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Estado en vivo">
            <p className="text-sm leading-6 text-zinc-300">{analysis.live.summary}</p>
            <Unavailable items={analysis.live.unavailable} />
          </Panel>

          {match.status === "LIVE" ? (
            <Panel title="MOMENTUM LIVE">
              <LiveMomentumPanel momentum={analysis.liveMomentum} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
            </Panel>
          ) : null}

          <Panel title="Jugadores y mercados individuales">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-zinc-400">
                  <tr className="border-b border-white/10"><th className="py-2">Jugador</th><th>Pos</th><th>Rem</th><th>Al arco</th><th>xG</th><th>Faltas</th></tr>
                </thead>
                <tbody>
                  {analysis.players.items.length ? analysis.players.items.map((player) => (
                    <tr key={`${player.team}-${player.player}`} className="border-b border-white/5 text-zinc-300">
                      <td className="py-2 font-bold text-white">{player.player}</td><td>{player.position}</td><td>{value(player.shots)}</td><td>{value(player.shotsOnTarget)}</td><td>{value(player.xg)}</td><td>{value(player.foulsCommitted)}</td>
                    </tr>
                  )) : <tr><td colSpan={6} className="py-4 text-zinc-400">N/D</td></tr>}
                </tbody>
              </table>
            </div>
            <List title="Mercados de jugador" items={analysis.playerMarkets.map((item) => `${item.selection}: confianza ${item.confidence}/10 (${item.bookmaker}, cuota ${value(item.odd)})`)} />
            <Unavailable items={analysis.players.unavailable} />
          </Panel>

          <Panel title="Arbitro">
            <p className="text-sm text-zinc-300">{analysis.referee.summary}</p>
            <Unavailable items={analysis.referee.unavailable} />
          </Panel>

        </aside>
      </div>
    </main>
  );
}

function SuggestionCard({ suggestion, index }: { suggestion: DeepSuggestion; index: number }) {
  return (
    <article className="rounded-lg border border-white/10 bg-black/25 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase text-white">OPCION {index}</p>
        <ConfidenceBadge classification={suggestion.state} />
      </div>
      <p className="text-sm text-zinc-400">Mercado</p>
      <p className="font-black text-white">{suggestion.market}</p>
      <p className="mt-2 text-sm text-zinc-400">Seleccion</p>
      <p className="font-bold text-zinc-100">{suggestion.selection}</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <InfoLine label="Confianza de la seleccion" value={`${suggestion.confidence}/10`} />
        <InfoLine label="Calidad de datos" value={`${suggestion.dataQuality}%`} />
        <InfoLine label="Faltan" value={suggestion.goalsNeeded === undefined ? "N/D" : `${suggestion.goalsNeeded} gol(es)`} />
        {suggestion.timeRemaining ? <InfoLine label="Tiempo" value={suggestion.timeRemaining} /> : null}
        <InfoLine label="Casa" value={suggestion.bookmaker} />
        <InfoLine label="Cuota" value={value(suggestion.odd)} />
      </div>
      <List title="A favor" items={suggestion.supportingData.slice(0, 6)} />
      {suggestion.finalTimeDebug ? (
        <pre className="mt-3 overflow-x-auto rounded border border-yellow-300/20 bg-yellow-300/8 p-2 text-[11px] leading-4 text-yellow-50">
          {JSON.stringify(suggestion.finalTimeDebug, null, 2)}
        </pre>
      ) : null}
      <List title="Riesgos" items={suggestion.risks.slice(0, 3)} />
      <List title="Invalida si" items={suggestion.invalidators} />
    </article>
  );
}

function InfoLine({ label, value: lineValue }: { label: string; value: string }) {
  return (
    <p>
      <span className="block text-[11px] font-black uppercase text-zinc-500">{label}</span>
      <span className="font-bold text-white">{lineValue}</span>
    </p>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4"><h2 className="mb-4 text-sm font-extrabold uppercase text-zinc-200">{title}</h2>{children}</section>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase text-emerald-100"><span className="text-emerald-300">{icon}</span>{title}</h2>;
}

function InfoTile({ title, value: tileValue, detail }: { title: string; value: string; detail: string }) {
  return <div className="rounded border border-white/10 bg-white/[0.045] p-3"><p className="text-xs font-bold uppercase text-zinc-400">{title}</p><p className="mt-1 text-xl font-black text-white">{tileValue}</p><p className="mt-1 text-xs text-zinc-400">{detail}</p></div>;
}

function MetricCard({ title, summary }: { title: string; summary: DeepMetricSummary }) {
  const rows = [
    ["Partidos", summary.matches],
    ["G/E/P", summary.wins === null ? "N/D" : `${summary.wins}/${summary.draws}/${summary.losses}`],
    ["GF/GC prom.", `${value(summary.goalsForAvg)}/${value(summary.goalsAgainstAvg)}`],
    ["Remates / al arco", `${value(summary.shotsAvg)}/${value(summary.shotsOnTargetAvg)}`],
    ["xG", summary.xgAvg],
    ["Corners", summary.cornersAvg],
    ["Tarjetas", summary.cardsAvg],
    ["BTTS / Over 2.5", `${value(summary.bttsRate)}% / ${value(summary.over25Rate)}%`]
  ];
  return <div className="rounded border border-white/10 bg-black/20 p-3"><h3 className="mb-2 font-black text-white">{title}</h3>{rows.map(([label, rowValue]) => <div key={label} className="flex justify-between gap-3 border-t border-white/5 py-1.5 text-sm"><span className="text-zinc-400">{label}</span><span className="font-bold text-zinc-100">{value(rowValue)}</span></div>)}</div>;
}

function TwoColumnList({ leftTitle, left, rightTitle, right }: { leftTitle: string; left: string[]; rightTitle: string; right: string[] }) {
  return <div className="mt-4 grid gap-3 md:grid-cols-2"><List title={leftTitle} items={left} /><List title={rightTitle} items={right} /></div>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return <div className="mt-3"><p className="text-xs font-extrabold uppercase text-zinc-500">{title}</p><ul className="mt-1 space-y-1 text-sm text-zinc-300">{items.length ? items.map((item) => <li key={item}>- {item}</li>) : <li>N/D</li>}</ul></div>;
}

function Unavailable({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <div className="mt-4 rounded border border-yellow-300/15 bg-yellow-300/8 p-3"><p className="text-xs font-black uppercase text-yellow-100">No disponible</p><p className="mt-1 text-sm text-zinc-300">{items.join(", ")}</p></div>;
}

function value(input: unknown) {
  return input === null || input === undefined || input === "" ? "N/D" : String(input);
}

function formatDateTime(input: string) {
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "medium" }).format(new Date(input));
}
