"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { StatRow } from "@/components/StatRow";
import type { TeamStats } from "@/types/domain";

type Snapshot = {
  match: { status?: string; stats: { home: TeamStats; away: TeamStats } };
};

export function LiveStatsPanel({ matchId, initialStats, live }: { matchId: string; initialStats: Snapshot["match"]["stats"]; live: boolean }) {
  const [stats, setStats] = useState(initialStats);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const [isLive, setIsLive] = useState(live);

  useEffect(() => {
    setIsLive(live);
  }, [live]);

  useEffect(() => {
    if (!isLive) return;

    let active = true;
    const onSnapshot = (event: Event) => {
      const snapshot = (event as CustomEvent<Snapshot>).detail;
      if (!active || !snapshot?.match?.stats) return;
      setStats(snapshot.match.stats);
      setUpdatedAt(new Date());
      setFailed(false);
      if (snapshot.match.status === "FINISHED") {
        active = false;
        setIsLive(false);
      }
    };

    window.addEventListener("fut:snapshot", onSnapshot);
    return () => {
      active = false;
      window.removeEventListener("fut:snapshot", onSnapshot);
    };
  }, [isLive, matchId]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{failed ? "Mostrando ultimos datos validos" : updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString("es-EC")}` : "Datos iniciales"}</span>
        {isLive ? <RefreshCw className="h-3.5 w-3.5" /> : null}
      </div>
      <div className="space-y-4">
        <StatRow label="Posesion" home={stats.home.possession} away={stats.away.possession} suffix="%" />
        <StatRow label="Remates" home={stats.home.shots} away={stats.away.shots} />
        <StatRow label="Fuera" home={stats.home.shotsOffTarget ?? null} away={stats.away.shotsOffTarget ?? null} />
        <StatRow label="Al arco" home={stats.home.shotsOnTarget} away={stats.away.shotsOnTarget} />
        <StatRow label="xG" home={stats.home.xg} away={stats.away.xg} />
        <StatRow label="Corners" home={stats.home.corners} away={stats.away.corners} />
        <StatRow label="Tarjetas amarillas" home={stats.home.yellowCards} away={stats.away.yellowCards} />
        <StatRow label="Rojas" home={stats.home.redCards} away={stats.away.redCards} />
        <StatRow label="Faltas" home={stats.home.fouls} away={stats.away.fouls} />
        {stats.home.dangerousAttacks !== undefined && stats.away.dangerousAttacks !== undefined ? (
          <StatRow label="Ataques peligrosos" home={stats.home.dangerousAttacks} away={stats.away.dangerousAttacks} />
        ) : null}
        {stats.home.attacks !== undefined && stats.away.attacks !== undefined ? (
          <StatRow label="Ataques" home={stats.home.attacks ?? null} away={stats.away.attacks ?? null} />
        ) : null}
      </div>
    </>
  );
}
