import { Activity, AlertTriangle, Clock, Users } from "lucide-react";
import { AnalysisMarketCard } from "@/components/AnalysisMarketCard";
import { CurrentRecommendationPanel } from "@/components/CurrentRecommendationPanel";
import { StatRow } from "@/components/StatRow";
import { StatusPill } from "@/components/StatusPill";
import type { MatchAnalysisResult, MatchDetail } from "@/types/domain";

export function AnalysisSummary({ analysis }: { analysis: MatchAnalysisResult }) {
  const { match } = analysis;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
        <section className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-zinc-400">{match.competition}</p>
              <h1 className="mt-1 text-2xl font-black text-white sm:text-4xl">
                {match.homeTeam} vs {match.awayTeam}
              </h1>
            </div>
            <StatusPill status={match.status} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <p className="text-xl font-black text-white">{match.homeTeam}</p>
            <div className="rounded bg-white/[0.06] px-5 py-3 text-center ring-1 ring-white/10">
              <p className="text-4xl font-black tabular-nums text-white">{match.score.home} - {match.score.away}</p>
              <p className="mt-1 text-xs font-bold uppercase text-emerald-200">{match.minute !== null ? `${match.minute}'` : "N/D"}</p>
            </div>
            <p className="text-xl font-black text-white sm:text-right">{match.awayTeam}</p>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
          <SectionTitle icon={<Activity className="h-4 w-4" />} title="Datos disponibles" />
          <div className="mt-4 space-y-4">
            <StatRow label="Posesion" home={match.stats.home.possession} away={match.stats.away.possession} suffix="%" />
            <StatRow label="Remates" home={match.stats.home.shots} away={match.stats.away.shots} />
            <StatRow label="Al arco" home={match.stats.home.shotsOnTarget} away={match.stats.away.shotsOnTarget} />
            <StatRow label="xG" home={match.stats.home.xg} away={match.stats.away.xg} />
            <StatRow label="Corners" home={match.stats.home.corners} away={match.stats.away.corners} />
            <StatRow label="Tarjetas" home={(match.stats.home.yellowCards ?? 0) + (match.stats.home.redCards ?? 0)} away={(match.stats.away.yellowCards ?? 0) + (match.stats.away.redCards ?? 0)} />
            <StatRow label="Faltas" home={match.stats.home.fouls} away={match.stats.away.fouls} />
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
          <SectionTitle icon={<Users className="h-4 w-4" />} title="Forma, H2H y contexto" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Info title={`Ultimos ${match.homeTeam}`} value={`${analysis.recentHome.length || "N/D"} partidos`} />
            <Info title={`Ultimos ${match.awayTeam}`} value={`${analysis.recentAway.length || "N/D"} partidos`} />
            <Info title="H2H" value={`${analysis.h2h.length || "N/D"} partidos`} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RecentList title={`Recientes ${match.homeTeam}`} matches={analysis.recentHome} />
            <RecentList title={`Recientes ${match.awayTeam}`} matches={analysis.recentAway} />
          </div>
          <RecentList title="H2H reciente" matches={analysis.h2h} />
        </section>
      </div>

      <aside className="space-y-5">
        {match.status === "LIVE" ? (
          <CurrentRecommendationPanel matchId={match.id} initialRecommendation={analysis.currentRecommendation} />
        ) : null}

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
          <SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="Estado en vivo" />
          <p className="mt-3 text-2xl font-black text-white">{liveLabel(analysis.liveState)}</p>
          <p className="mt-2 text-sm text-zinc-400">Comparacion con los datos reales disponibles. Si falta historial fino de 5-15 minutos, se muestra N/D o una lectura conservadora.</p>
        </section>

        <section className="space-y-3">
          {analysis.markets.map((market) => (
            <AnalysisMarketCard key={`${market.market}-${market.selection}`} market={market} />
          ))}
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
          <SectionTitle icon={<Clock className="h-4 w-4" />} title="Datos no disponibles" />
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-300">
            {["Bajas", "Arbitro", "Entrenador", "Sustituciones habituales"].map((item) => (
              <div key={item} className="rounded bg-black/20 px-3 py-2">
                <span className="block text-xs uppercase text-zinc-500">{item}</span>
                <span className="font-bold text-zinc-200">N/D</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase text-zinc-200">
      <span className="text-emerald-300">{icon}</span>
      {title}
    </h2>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <p className="text-xs uppercase text-zinc-500">{title}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function RecentList({ title, matches }: { title: string; matches: MatchDetail[] }) {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-black text-white">{title}</h3>
      <div className="space-y-2">
        {matches.length ? (
          matches.slice(0, 8).map((match) => (
            <div key={match.id} className="grid grid-cols-[1fr_auto] gap-3 rounded bg-black/20 px-3 py-2 text-sm">
              <span className="truncate text-zinc-200">{match.homeTeam} vs {match.awayTeam}</span>
              <span className="font-black tabular-nums text-white">{match.score.home}-{match.score.away}</span>
            </div>
          ))
        ) : (
          <p className="rounded bg-black/20 px-3 py-2 text-sm text-zinc-400">N/D</p>
        )}
      </div>
    </div>
  );
}

function liveLabel(state: MatchAnalysisResult["liveState"]) {
  const labels = {
    MEJORO: "🟢 MEJORÓ",
    IGUAL: "🟡 IGUAL",
    EMPEORO: "🟠 EMPEORÓ",
    "CAMBIO FUERTE": "🔴 CAMBIO FUERTE",
    "N/D": "N/D"
  };
  return labels[state];
}
