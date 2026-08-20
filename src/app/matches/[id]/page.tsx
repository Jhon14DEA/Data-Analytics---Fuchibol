import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, CalendarClock, TrendingUp, Users } from "lucide-react";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { CurrentRecommendationPanel } from "@/components/CurrentRecommendationPanel";
import { StatRow } from "@/components/StatRow";
import { StatusPill } from "@/components/StatusPill";
import { analyzeMatch } from "@/lib/analysisEngine";
import { detectAlerts } from "@/lib/alertEngine";
import { footballProvider, getMatchAnalysisContext, oddsProvider } from "@/providers";
import { analyzeMatchContext } from "@/services/analysis/matchAnalyzer";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MatchPage({ params }: PageProps) {
  const { id } = await params;
  const match = await footballProvider.getMatch(id);

  if (!match) {
    notFound();
  }

  const previous = await footballProvider.getPreviousSnapshot(id);
  const odds = await oddsProvider.getCurrentOdds(id);
  const oddsHistory = await oddsProvider.getOddsHistory(id);
  const analysis = analyzeMatch(match);
  const alerts = detectAlerts(match, previous);
  const currentRecommendation =
    match.status === "LIVE"
      ? await getMatchAnalysisContext(id)
          .then((context) => (context ? analyzeMatchContext(context).currentRecommendation : null))
          .catch(() => null)
      : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-bold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
          <span className="rounded bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/25">
          {match.demo ? "Datos simulados DEMO" : `Datos reales ${match.source === "allsports" ? "AllSportsApi" : "API-Football"}`}
        </span>
      </div>

      <header className="mb-6 rounded-lg border border-white/10 bg-black/20 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-normal text-zinc-400">{match.competition}</p>
            <h1 className="mt-1 text-2xl font-black text-white sm:text-4xl">
              {match.homeTeam} vs {match.awayTeam}
            </h1>
          </div>
          <StatusPill status={match.status} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <TeamName name={match.homeTeam} align="left" />
          <div className="rounded bg-white/[0.06] px-5 py-3 text-center ring-1 ring-white/10">
            <p className="text-4xl font-black tabular-nums text-white">{match.score.home} - {match.score.away}</p>
            <p className="mt-1 text-xs font-bold uppercase text-emerald-200">
              {match.minute !== null ? `${match.minute}'` : match.kickoffAt ? "Prepartido" : "Sin minuto"}
            </p>
          </div>
          <TeamName name={match.awayTeam} align="right" />
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Estadisticas en vivo" />
            <div className="mt-4 space-y-4">
              <StatRow label="Posesion" home={match.stats.home.possession} away={match.stats.away.possession} suffix="%" />
              <StatRow label="Remates" home={match.stats.home.shots} away={match.stats.away.shots} />
              <StatRow label="Al arco" home={match.stats.home.shotsOnTarget} away={match.stats.away.shotsOnTarget} />
              <StatRow label="xG" home={match.stats.home.xg} away={match.stats.away.xg} />
              <StatRow label="Corners" home={match.stats.home.corners} away={match.stats.away.corners} />
              <StatRow label="Tarjetas amarillas" home={match.stats.home.yellowCards} away={match.stats.away.yellowCards} />
              <StatRow label="Rojas" home={match.stats.home.redCards} away={match.stats.away.redCards} />
              <StatRow label="Faltas" home={match.stats.home.fouls} away={match.stats.away.fouls} />
              {match.stats.home.dangerousAttacks !== undefined && match.stats.away.dangerousAttacks !== undefined ? (
                <StatRow label="Ataques peligrosos" home={match.stats.home.dangerousAttacks} away={match.stats.away.dangerousAttacks} />
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<Users className="h-4 w-4" />} title="Alineaciones y jugadores" />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Lineup title={match.homeTeam} players={match.lineups.home} />
              <Lineup title={match.awayTeam} players={match.lineups.away} />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="text-xs uppercase text-zinc-400">
                  <tr className="border-b border-white/10">
                    <th className="py-2">Jugador</th>
                    <th>Pos</th>
                    <th>Rem</th>
                    <th>Al arco</th>
                    <th>xG</th>
                    <th>Pases clave</th>
                    <th>Faltas</th>
                  </tr>
                </thead>
                <tbody>
                  {match.playerStats.length ? (
                    match.playerStats.map((player) => (
                      <tr key={player.player} className="border-b border-white/5 text-zinc-200">
                        <td className="py-2 font-semibold text-white">{player.player}</td>
                        <td>{player.position}</td>
                        <td>{formatValue(player.shots)}</td>
                        <td>{formatValue(player.shotsOnTarget)}</td>
                        <td>{formatValue(player.xg)}</td>
                        <td>{formatValue(player.keyPasses)}</td>
                        <td>{formatValue(player.foulsCommitted)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-4 text-zinc-400">Estadisticas de jugador pendientes en modo prepartido DEMO.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<CalendarClock className="h-4 w-4" />} title="Eventos y sustituciones" />
            <Timeline events={[...match.events, ...match.substitutions].sort((a, b) => a.minute - b.minute)} />
          </section>
        </div>

        <aside className="space-y-5">
          {currentRecommendation ? (
            <CurrentRecommendationPanel matchId={id} initialRecommendation={currentRecommendation} />
          ) : null}

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<BellRing className="h-4 w-4" />} title="Panel de alertas" />
            <div className="mt-4 space-y-3">
              {alerts.length ? (
                alerts.map((alert, index) => (
                  <div key={`${alert.type}-${index}`} className="rounded border border-yellow-300/20 bg-yellow-300/8 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-yellow-100">{alert.title}</p>
                      <span className="rounded bg-black/30 px-2 py-1 text-xs font-black text-yellow-200">{alert.severity}/10</span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-zinc-300">{alert.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-400">Sin alertas activas.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Cuotas" />
            <div className="mt-4 space-y-2">
              {odds.map((quote) => (
                <div key={`${quote.bookmaker}-${quote.market}-${quote.selection}`} className="grid grid-cols-[1fr_auto] gap-3 rounded border border-white/10 bg-black/20 p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-zinc-400">{quote.bookmaker}</p>
                    <p className="truncate text-sm font-semibold text-white">{quote.market}</p>
                    <p className="truncate text-sm text-zinc-300">{quote.selection}</p>
                  </div>
                  <p className="rounded bg-emerald-400 px-2.5 py-2 text-center text-lg font-black text-black">{quote.price.toFixed(2)}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-xs font-extrabold uppercase text-zinc-400">Historial de movimiento</h3>
            <div className="mt-2 space-y-2">
              {oddsHistory.map((quote, index) => (
                <div key={`${quote.bookmaker}-${index}`} className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                  <span className="truncate">{quote.bookmaker} - {quote.selection}</span>
                  <span className="font-bold tabular-nums text-white">{quote.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Motor de analisis" />
            <div className="mt-4 space-y-3">
              {analysis.map((pick) => (
                <div key={`${pick.market}-${pick.selection}`} className="rounded border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-white">{pick.market}</p>
                      <p className="text-sm text-zinc-300">{pick.selection}</p>
                    </div>
                    <ConfidenceBadge classification={pick.classification} />
                  </div>
                  <p className="mb-3 text-sm font-bold text-emerald-200">Confianza {pick.confidence}/10</p>
                  <ReasonList title="Razones" items={pick.reasons} />
                  <ReasonList title="Riesgos" items={pick.risks} />
                  <ReasonList title="Invalida si" items={pick.invalidators} />
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function TeamName({ name, align }: { name: string; align: "left" | "right" }) {
  return <p className={`text-xl font-black text-white sm:text-2xl ${align === "right" ? "sm:text-right" : ""}`}>{name}</p>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-normal text-zinc-200">
      <span className="text-emerald-300">{icon}</span>
      {title}
    </h2>
  );
}

function Lineup({ title, players }: { title: string; players: { number: number; name: string; position: string }[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-white">{title}</h3>
      <div className="space-y-2">
        {players.length ? (
          players.map((player) => (
            <div key={`${player.number}-${player.name}`} className="flex items-center justify-between rounded bg-black/20 px-3 py-2 text-sm">
              <span className="font-semibold text-zinc-100">{player.number}. {player.name}</span>
              <span className="text-xs font-bold text-zinc-400">{player.position}</span>
            </div>
          ))
        ) : (
          <p className="rounded bg-black/20 px-3 py-2 text-sm text-zinc-400">Pendiente de confirmacion.</p>
        )}
      </div>
    </div>
  );
}

function Timeline({ events }: { events: { minute: number; title: string; detail: string }[] }) {
  return (
    <div className="mt-4 space-y-3">
      {events.map((event, index) => (
        <div key={`${event.minute}-${event.title}-${index}`} className="grid grid-cols-[48px_1fr] gap-3">
          <span className="rounded bg-emerald-400/15 px-2 py-1 text-center text-xs font-black text-emerald-200">{event.minute}'</span>
          <div>
            <p className="font-bold text-white">{event.title}</p>
            <p className="text-sm text-zinc-300">{event.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasonList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-extrabold uppercase text-zinc-500">{title}</p>
      <ul className="mt-1 space-y-1 text-sm text-zinc-300">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatValue(value: number | null) {
  return value === null ? "N/D" : value;
}
