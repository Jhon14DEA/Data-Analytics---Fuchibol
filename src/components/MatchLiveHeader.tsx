"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import type { MatchAnalysisResult, MatchDetail } from "@/types/domain";

type HeaderMatch = Pick<MatchDetail, "homeTeam" | "awayTeam" | "competition" | "status" | "minute" | "score" | "kickoffAt">;

type SnapshotPayload = {
  match?: Partial<HeaderMatch>;
  dataUpdatedAt?: string | null;
  statusIndicator?: MatchAnalysisResult["statusIndicator"] | null;
};

export function MatchLiveHeader({
  match,
  dataUpdatedAt,
  statusIndicator
}: {
  match: HeaderMatch;
  dataUpdatedAt: string | null;
  statusIndicator: MatchAnalysisResult["statusIndicator"] | null;
}) {
  const [current, setCurrent] = useState(match);
  const [updatedAt, setUpdatedAt] = useState(dataUpdatedAt);
  const [indicator, setIndicator] = useState(statusIndicator);

  useEffect(() => {
    setCurrent(match);
    setUpdatedAt(dataUpdatedAt);
    setIndicator(statusIndicator);
  }, [match, dataUpdatedAt, statusIndicator]);

  useEffect(() => {
    const onSnapshot = (event: Event) => {
      const snapshot = (event as CustomEvent<SnapshotPayload>).detail;
      if (!snapshot?.match) return;
      setCurrent((value) => ({
        ...value,
        ...snapshot.match,
        score: snapshot.match?.score ?? value.score
      }));
      setUpdatedAt(snapshot.dataUpdatedAt ?? new Date().toISOString());
      setIndicator(snapshot.statusIndicator ?? (snapshot.match.status ? statusIndicatorFrom(snapshot.match.status) : null));
    };

    window.addEventListener("fut:snapshot", onSnapshot);
    return () => window.removeEventListener("fut:snapshot", onSnapshot);
  }, []);

  return (
    <header className="mb-6 rounded-lg border border-white/10 bg-black/20 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-normal text-zinc-400">{current.competition}</p>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-4xl">
            {current.homeTeam} vs {current.awayTeam}
          </h1>
          {updatedAt ? (
            <p className="mt-2 text-xs font-bold uppercase text-zinc-400">
              DATA UPDATED: {new Date(updatedAt).toLocaleString("es-EC")} · {indicator ?? statusIndicatorFrom(current.status)}
            </p>
          ) : null}
        </div>
        <StatusPill status={current.status} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <TeamName name={current.homeTeam} align="left" />
        <div className="rounded bg-white/[0.06] px-5 py-3 text-center ring-1 ring-white/10">
          <p className="text-4xl font-black tabular-nums text-white">{current.score.home} - {current.score.away}</p>
          <p className="mt-1 text-xs font-bold uppercase text-emerald-200">{minuteLabel(current)}</p>
        </div>
        <TeamName name={current.awayTeam} align="right" />
      </div>
    </header>
  );
}

function TeamName({ name, align }: { name: string; align: "left" | "right" }) {
  return <p className={`text-xl font-black text-white sm:text-2xl ${align === "right" ? "sm:text-right" : ""}`}>{name}</p>;
}

function minuteLabel(match: HeaderMatch) {
  if (match.status === "FINISHED") return "Finalizado";
  if (match.status === "UPCOMING") return match.kickoffAt ? "Prepartido" : "Sin minuto";
  return match.minute !== null ? `${match.minute}'` : "Tiempo N/D";
}

function statusIndicatorFrom(status: HeaderMatch["status"]): MatchAnalysisResult["statusIndicator"] {
  if (status === "LIVE") return "LIVE";
  if (status === "UPCOMING") return "UPCOMING";
  return "FINAL";
}
