"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CurrentRecommendation, LiveDataFreshness, MatchDetail, MatchEvent, TeamStats } from "@/types/domain";

const LIVE_REFRESH_SECONDS = Number(process.env.NEXT_PUBLIC_LIVE_REFRESH_SECONDS ?? 120);

type SnapshotPayload = {
  match: Pick<MatchDetail, "status" | "events"> & {
    stats?: { home: TeamStats; away: TeamStats };
  };
  analysis?: CurrentRecommendation;
  dataFreshness?: LiveDataFreshness | null;
};

export function CurrentRecommendationPanel({
  matchId,
  initialRecommendation,
  live
}: {
  matchId: string;
  initialRecommendation: CurrentRecommendation;
  live: boolean;
}) {
  const router = useRouter();
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [isLoading, setIsLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(live);
  const [nextRefreshIn, setNextRefreshIn] = useState(LIVE_REFRESH_SECONDS);
  const inFlight = useRef(false);
  const knownCriticalEvents = useRef(new Set<string>());

  async function refreshNow() {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/matches/${matchId}/snapshot?refresh=${Date.now()}`, { cache: "no-store" });
      const payload = (await response.json()) as SnapshotPayload;
      const finished = payload.match?.status === "FINISHED";
      setIsLive(payload.match?.status === "LIVE");
      setRecommendation(finished ? { message: "PARTIDO FINALIZADO", options: [] } : payload.analysis ?? { message: "SIN OPORTUNIDADES ACTUALES", options: [] });
      setUpdatedAt(new Date().toISOString());
      setNextRefreshIn(LIVE_REFRESH_SECONDS);
      window.dispatchEvent(new CustomEvent("fut:snapshot", { detail: payload }));
      if (hasNewCriticalEvent(payload.match?.events ?? [], knownCriticalEvents.current)) {
        setNextRefreshIn(LIVE_REFRESH_SECONDS);
      }
      if (finished) {
        router.refresh();
      }
    } finally {
      setIsLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    setRecommendation(initialRecommendation);
  }, [initialRecommendation]);

  useEffect(() => {
    if (!isLive) return;
    const interval = window.setInterval(() => {
      setNextRefreshIn((value) => {
        if (value <= 1) {
          void refreshNow();
          return LIVE_REFRESH_SECONDS;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isLive, matchId]);

  return (
    <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.055] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase text-emerald-100">MEJOR APUESTA AHORA</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Última actualización: {updatedAt ? new Date(updatedAt).toLocaleTimeString("es-EC") : "datos iniciales"}
            {isLive ? ` · Próxima actualización ${formatCountdown(nextRefreshIn)}` : ""}
            {recommendation.dataFreshness?.providerAgeSeconds !== null && recommendation.dataFreshness?.providerAgeSeconds !== undefined
              ? ` · Datos actualizados hace ${recommendation.dataFreshness.providerAgeSeconds}s`
              : ""}
          </p>
          {recommendation.dataFreshness?.liveDataStale ? (
            <p className="mt-1 text-xs font-black uppercase text-yellow-200">LIVE DATA STALE</p>
          ) : null}
          {recommendation.dataFreshness ? (
            <p className="mt-1 max-w-2xl text-[11px] font-semibold text-zinc-500">
              providerFetchedAt {formatTime(recommendation.dataFreshness.providerFetchedAt)} · lastScoreChangeAt {formatTime(recommendation.dataFreshness.lastScoreChangeAt)} · lastEventAt {formatTime(recommendation.dataFreshness.lastEventAt)} · statsUpdatedAt {formatTime(recommendation.dataFreshness.statsUpdatedAt)} · oddsUpdatedAt {formatTime(recommendation.dataFreshness.oddsUpdatedAt)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={refreshNow}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-black uppercase text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          ACTUALIZAR AHORA
        </button>
      </div>

      {recommendation.options.length ? (
        <div className="space-y-3">
          {recommendation.options.map((option, index) => (
            <article key={`${option.bookmaker}-${option.market}-${option.selection}-${index}`} className="rounded border border-white/10 bg-black/25 p-3">
              <p className="mb-3 text-xs font-black uppercase text-emerald-200">MEJOR APUESTA ACTUAL</p>
              <div className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                <Info label="Mercado" value={option.market} />
                <Info label="Selección" value={option.selection} />
                <Info label="Casa" value={option.bookmaker} />
                <Info label="Cuota" value={option.odd.toFixed(2)} />
                <Info label="Prob. estimada" value={formatPercent(option.estimatedProbability)} />
                <Info label="Prob. implicita" value={formatPercent(option.impliedProbability)} />
                <Info label="Edge ajustado" value={formatPercent(option.uncertaintyAdjustedEdge)} />
                <Info label="Bet score" value={option.betScore !== null && option.betScore !== undefined ? `${option.betScore}/10` : "N/D"} />
                <Info label="Confianza" value={`${option.confidence}/10`} />
                <Info label="Estado" value={displayState(option)} />
                <Info label="Evento requerido" value={option.goalsNeeded !== null && option.goalsNeeded !== undefined ? `${option.goalsNeeded} gol(es)` : option.eventNeeded !== null && option.eventNeeded !== undefined ? `${option.eventNeeded} evento(s)` : "N/D"} />
              </div>
              <List title="Razones" items={option.reasons.slice(0, 3)} />
              <List title="Riesgos" items={option.risks.slice(0, 2)} />
              <List title="Bloqueos" items={(option.decisionBlockers ?? []).map((item) => `${item.rule}: ${item.effect}`).slice(0, 3)} />
              {option.action ? <p className="mt-3 rounded bg-emerald-300/10 p-2 text-sm font-bold text-emerald-100">Acción: {option.action}</p> : null}
              <p className="mt-3 text-sm font-black text-white">Decisión: {option.decision}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded border border-white/10 bg-black/25 p-4 text-sm font-black text-zinc-100">
          {recommendation.message ?? "SIN APUESTA AHORA"}
          {recommendation.mainReason ? <span className="mt-2 block text-xs font-bold normal-case text-zinc-400">{recommendation.mainReason}</span> : null}
        </p>
      )}
    </section>
  );
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="block text-[11px] font-black uppercase text-zinc-500">{label}:</span>
      <span className="font-bold text-white">{value || "N/D"}</span>
    </p>
  );
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "N/D" : `${(value * 100).toFixed(1)}%`;
}

function displayState(option: CurrentRecommendation["options"][number]) {
  if (option.entryState === "WATCH_ENTRY" || option.state === "VENTANA TEMPRANA DE VALOR") return "VENTANA TEMPRANA DE VALOR";
  return option.decision === "CONSIDERAR" ? "ENTRAR" : option.decision === "ESPERAR" ? "ESPERAR" : "NO APOSTAR";
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleTimeString("es-EC") : "N/D";
}

function hasNewCriticalEvent(events: MatchEvent[], known: Set<string>) {
  let found = false;
  for (const event of events) {
    const text = `${event.type} ${event.title}`.toLowerCase();
    const critical = event.type === "goal" ||
      event.type === "substitution" ||
      event.type === "penalty" ||
      event.type === "var" ||
      text.includes("red") ||
      text.includes("roja") ||
      text.includes("second yellow") ||
      text.includes("segunda amarilla");
    const fingerprint = `${event.minute}-${event.type}-${event.team}-${event.title}-${event.detail}`;
    if (critical && !known.has(fingerprint)) found = true;
    known.add(fingerprint);
  }
  return found;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-black uppercase text-zinc-500">{title}:</p>
      <ul className="mt-1 space-y-1 text-sm text-zinc-300">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}
