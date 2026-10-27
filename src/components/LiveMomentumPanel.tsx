import type { LiveMomentumAnalysis, LivePeriodStats, TeamSide } from "@/types/domain";

export function LiveMomentumPanel({ momentum, homeTeam, awayTeam }: { momentum?: LiveMomentumAnalysis | null; homeTeam: string; awayTeam: string }) {
  if (!momentum) {
    return <p className="mt-4 rounded border border-white/10 bg-black/20 p-3 text-sm text-zinc-400">Momentum live N/D.</p>;
  }

  const pressureTeam = momentum.strongerPressure === "home" ? homeTeam : momentum.strongerPressure === "away" ? awayTeam : momentum.strongerPressure === "balanced" ? "Equilibrada" : "N/D";

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="ACUMULADO" value={`${momentum.cumulativeAttackScore}/100`} detail={formatAccumulated(momentum)} />
        <Tile title="ÚLTIMOS 15'" value={`${momentum.recentMomentumScore}/100`} detail={formatRecent(momentum)} />
        <Tile title="TENDENCIA" value={momentum.trendDirection ?? momentum.matchTrendState} detail={`Score ${momentum.matchTrendScore}/100 · Presión ${momentum.pressureStrength}`} />
        <Tile title="SEÑAL DE GOL" value={momentum.goalPressureSignal} detail={`Mayor presión: ${pressureTeam}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="uppercase text-zinc-500">
            <tr className="border-b border-white/10">
              <th className="py-2">Periodo</th>
              <th>{homeTeam} remates</th>
              <th>{homeTeam} SOT</th>
              <th>{awayTeam} remates</th>
              <th>{awayTeam} SOT</th>
              <th>xG</th>
              <th>Corners</th>
            </tr>
          </thead>
          <tbody>
            {momentum.periods.map((period) => <PeriodRow key={period.period} period={period} />)}
          </tbody>
        </table>
      </div>
      {momentum.substitutions.length ? (
        <div>
          <p className="text-xs font-extrabold uppercase text-zinc-500">Cambios: impacto observado</p>
          <ul className="mt-1 space-y-1 text-sm text-zinc-300">
            {momentum.substitutions.slice(0, 4).map((item) => (
              <li key={`${item.minute}-${item.detail}`}>- {item.minute}' {sideLabel(item.team)}: {item.substitutionIntent} · {item.observedImpact}. {item.note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {momentum.favoriteReactionSignal ? (
        <div className="rounded border border-emerald-300/20 bg-emerald-300/10 p-3">
          <p className="text-xs font-black uppercase text-emerald-100">{momentum.favoriteReactionSignal.label}</p>
          <p className="mt-1 text-sm text-zinc-200">
            {momentum.favoriteReactionSignal.team === "home" ? homeTeam : awayTeam}: {momentum.favoriteReactionSignal.reasons.join(" · ")}
          </p>
        </div>
      ) : null}
      <ul className="space-y-1 text-xs text-zinc-500">
        {momentum.notes.map((note) => <li key={note}>- {note}</li>)}
      </ul>
    </div>
  );
}

function PeriodRow({ period }: { period: LivePeriodStats }) {
  return (
    <tr className="border-b border-white/5 text-zinc-300">
      <td className="py-2 font-bold text-white">{period.period}</td>
      <td>{value(period.home.shots)}</td>
      <td>{value(period.home.shotsOnTarget)}</td>
      <td>{value(period.away.shots)}</td>
      <td>{value(period.away.shotsOnTarget)}</td>
      <td>{pair(period.home.xgDelta, period.away.xgDelta)}</td>
      <td>{pair(period.home.corners, period.away.corners)}</td>
    </tr>
  );
}

function Tile({ title, value: tileValue, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] font-black uppercase text-zinc-500">{title}</p>
      <p className="mt-1 text-lg font-black text-white">{tileValue}</p>
      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

function formatAccumulated(momentum: LiveMomentumAnalysis) {
  const item = momentum.accumulated;
  return `Rem ${value(item.totalShots)} · Fuera ${value(item.totalShotsOffTarget)} · SOT ${value(item.totalShotsOnTarget)} · xG ${value(item.totalXg)} · Corners ${value(item.totalCorners)} · Ataques ${value(item.totalAttacks)} · Peligrosos ${value(item.totalDangerousAttacks)}`;
}

function formatRecent(momentum: LiveMomentumAnalysis) {
  const item = momentum.recent.fifteen;
  return `Rem ${value(item.shots)} · Fuera ${value(item.shotsOffTarget)} · SOT ${value(item.shotsOnTarget)} · xG ${value(item.xg)} · Corners ${value(item.corners)} · Ataques ${value(item.attacks)} · Cobertura ${item.coveragePercentage}%`;
}

function sideLabel(side?: TeamSide) {
  if (side === "home") return "Local";
  if (side === "away") return "Visitante";
  return "N/D";
}

function pair(home: number | null, away: number | null) {
  if (home === null && away === null) return "N/D";
  return `${value(home)} / ${value(away)}`;
}

function value(input: number | null | undefined) {
  return input === null || input === undefined ? "N/D" : Number.isInteger(input) ? String(input) : input.toFixed(2);
}
