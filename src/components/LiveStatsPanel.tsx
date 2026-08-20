"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { StatRow } from "@/components/StatRow";
import type { TeamStats } from "@/types/domain";

type Snapshot = {
  match: { stats: { home: TeamStats; away: TeamStats } };
};

export function LiveStatsPanel({ matchId, initialStats, live }: { matchId: string; initialStats: Snapshot["match"]["stats"]; live: boolean }) {
  const [stats, setStats] = useState(initialStats);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!live) return;

    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}/snapshot`, { cache: "no-store" });
        if (!response.ok) throw new Error("snapshot failed");
        const snapshot = (await response.json()) as Snapshot;
        if (active) {
          setStats(snapshot.match.stats);
          setUpdatedAt(new Date());
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };

    const interval = window.setInterval(refresh, 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [live, matchId]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{failed ? "Mostrando ultimos datos validos" : updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString("es-EC")}` : "Datos iniciales"}</span>
        {live ? <RefreshCw className="h-3.5 w-3.5" /> : null}
      </div>
      <div className="space-y-4">
        <StatRow label="Posesion" home={stats.home.possession} away={stats.away.possession} suffix="%" />
        <StatRow label="Remates" home={stats.home.shots} away={stats.away.shots} />
        <StatRow label="Al arco" home={stats.home.shotsOnTarget} away={stats.away.shotsOnTarget} />
        <StatRow label="xG" home={stats.home.xg} away={stats.away.xg} />
        <StatRow label="Corners" home={stats.home.corners} away={stats.away.corners} />
        <StatRow label="Tarjetas amarillas" home={stats.home.yellowCards} away={stats.away.yellowCards} />
        <StatRow label="Rojas" home={stats.home.redCards} away={stats.away.redCards} />
        <StatRow label="Faltas" home={stats.home.fouls} away={stats.away.fouls} />
        {stats.home.dangerousAttacks !== undefined && stats.away.dangerousAttacks !== undefined ? (
          <StatRow label="Ataques peligrosos" home={stats.home.dangerousAttacks} away={stats.away.dangerousAttacks} />
        ) : null}
      </div>
    </>
  );
}
