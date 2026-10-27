"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CurrentRecommendation, LiveMomentumAnalysis, MatchDetail, TeamStats } from "@/types/domain";

type SnapshotPayload = {
  match?: Pick<MatchDetail, "status" | "minute" | "score" | "stats" | "events"> & {
    liveMomentum?: LiveMomentumAnalysis | null;
  };
  analysis?: CurrentRecommendation;
  dataUpdatedAt?: string;
};

type DeltaState = {
  shots: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  dangerousAttacks: number | null;
  corners: number | null;
  odds: string;
};

export function LiveStatePanel({
  match,
  momentum,
  recommendation
}: {
  match: MatchDetail;
  momentum?: LiveMomentumAnalysis | null;
  recommendation?: CurrentRecommendation | null;
}) {
  const [current, setCurrent] = useState(match);
  const [liveMomentum, setLiveMomentum] = useState(momentum ?? null);
  const [currentRecommendation, setCurrentRecommendation] = useState(recommendation ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [delta, setDelta] = useState<DeltaState>({ shots: null, shotsOnTarget: null, xg: null, dangerousAttacks: null, corners: null, odds: "Sin movimiento confirmado" });
  const previous = useRef<Pick<MatchDetail, "stats" | "score" | "minute"> | null>({ stats: match.stats, score: match.score, minute: match.minute });

  useEffect(() => {
    function onSnapshot(event: Event) {
      const payload = (event as CustomEvent<SnapshotPayload>).detail;
      if (!payload?.match) return;
      const next = {
        ...current,
        ...payload.match,
        events: payload.match.events ?? current.events,
        lineups: current.lineups,
        playerStats: current.playerStats,
        odds: current.odds,
        oddsHistory: current.oddsHistory,
        substitutions: current.substitutions
      };
      setDelta(diffSnapshot(payload.match.stats, previous.current?.stats ?? null));
      previous.current = { stats: payload.match.stats, score: payload.match.score, minute: payload.match.minute };
      setCurrent(next);
      setLiveMomentum(payload.match.liveMomentum ?? null);
      setCurrentRecommendation(payload.analysis ?? null);
      setUpdatedAt(payload.dataUpdatedAt ?? new Date().toISOString());
    }

    window.addEventListener("fut:snapshot", onSnapshot);
    return () => window.removeEventListener("fut:snapshot", onSnapshot);
  }, [current]);

  const offensivePlayers = useMemo(() => offensivePlayersInPlay(current), [current]);
  const recent = liveMomentum?.recent.ten ?? null;
  const redCards = sum(current.stats.home.redCards, current.stats.away.redCards);
  const bestOption = currentRecommendation?.options[0] ?? null;
  const gainingValue = bestOption?.uncertaintyAdjustedEdge !== null && bestOption?.uncertaintyAdjustedEdge !== undefined && bestOption.uncertaintyAdjustedEdge > 0
    ? `${bestOption.market} ${bestOption.selection} · edge ajustado ${(bestOption.uncertaintyAdjustedEdge * 100).toFixed(1)}pp`
    : "Sin mercado con valor confirmado";

  return (
    <section className="mb-5 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.055] p-4">
      <div className="grid gap-3 lg:grid-cols-4">
        <Block
          title="ESTADO ACTUAL"
          lines={[
            `Minuto: ${current.minute ?? "N/D"}`,
            `Marcador: ${current.score.home}-${current.score.away}`,
            `Roja: ${redCards === null ? "N/D" : redCards > 0 ? "SÍ" : "NO"}`,
            `Cambios recientes: ${recent?.substitutions ?? "N/D"}`
          ]}
        />
        <Block
          title="QUÉ CAMBIÓ"
          lines={[
            `Remates ${formatDelta(delta.shots)}`,
            `SOT ${formatDelta(delta.shotsOnTarget)}`,
            `xG ${formatDelta(delta.xg)}`,
            `Peligrosos ${formatDelta(delta.dangerousAttacks)}`,
            `Corners ${formatDelta(delta.corners)}`
          ]}
        />
        <Block
          title="ÚLTIMOS 10 MIN"
          lines={[
            `Señal: ${liveMomentum?.matchTrendState ?? "N/D"}`,
            `Presión: ${liveMomentum?.pressureStrength ?? "N/D"}`,
            `SOT: ${recent?.shotsOnTarget ?? "N/D"}`,
            `xG: ${recent?.xg ?? "N/D"}`,
            `Ocasiones claras: N/D`
          ]}
        />
        <Block
          title="VALOR Y JUGADORES"
          lines={[
            `Ganando valor: ${gainingValue}`,
            `Perdiendo valor: ${delta.odds}`,
            `Ofensivos: ${offensivePlayers.length ? offensivePlayers.slice(0, 4).join(", ") : "DATA_GAP"}`,
            offensivePlayers.length ? "XI/jugadores desde proveedor" : "requiere verificación externa de alineación/jugadores",
            updatedAt ? `Actualizado: ${new Date(updatedAt).toLocaleTimeString("es-EC")}` : "Actualizado: inicial"
          ]}
        />
      </div>
      {liveMomentum?.favoriteReactionSignal ? (
        <p className="mt-3 rounded border border-emerald-300/25 bg-black/25 p-2 text-sm font-bold text-emerald-100">
          FAVORITO EN REACCIÓN: {liveMomentum.favoriteReactionSignal.team === "home" ? current.homeTeam : current.awayTeam} · {liveMomentum.favoriteReactionSignal.reasons.join(" · ")}
        </p>
      ) : null}
      {liveMomentum?.notes.some((note) => note.includes("DATA_WARNING")) ? (
        <ul className="mt-3 space-y-1 text-xs font-semibold text-yellow-200">
          {liveMomentum.notes.filter((note) => note.includes("DATA_WARNING")).map((note) => <li key={note}>- {note}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] font-black uppercase text-emerald-200">{title}</p>
      <ul className="mt-2 space-y-1 text-xs font-semibold text-zinc-300">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}

function diffSnapshot(current: { home: TeamStats; away: TeamStats }, previous: { home: TeamStats; away: TeamStats } | null): DeltaState {
  return {
    shots: previous ? diffTotal(current, previous, "shots") : null,
    shotsOnTarget: previous ? diffTotal(current, previous, "shotsOnTarget") : null,
    xg: previous ? diffTotal(current, previous, "xg") : null,
    dangerousAttacks: previous ? diffTotal(current, previous, "dangerousAttacks") : null,
    corners: previous ? diffTotal(current, previous, "corners") : null,
    odds: "Sin movimiento confirmado"
  };
}

function diffTotal(current: { home: TeamStats; away: TeamStats }, previous: { home: TeamStats; away: TeamStats }, key: keyof TeamStats) {
  const currentTotal = sum(current.home[key], current.away[key]);
  const previousTotal = sum(previous.home[key], previous.away[key]);
  if (currentTotal === null || previousTotal === null) return null;
  return Math.round((currentTotal - previousTotal) * 100) / 100;
}

function sum(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a + b;
}

function formatDelta(value: number | null) {
  if (value === null) return "+N/D";
  return `${value >= 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function offensivePlayersInPlay(match: MatchDetail) {
  const players = [...match.lineups.home, ...match.lineups.away]
    .filter((player) => /(fw|st|cf|lw|rw|wing|delanter|forward|striker|attack|am|cam|mediapunta)/i.test(player.position))
    .map((player) => player.name);
  if (players.length) return players;
  return match.playerStats
    .filter((player) => /(fw|st|cf|lw|rw|wing|delanter|forward|striker|attack|am|cam|mediapunta)/i.test(player.position))
    .map((player) => player.player);
}
