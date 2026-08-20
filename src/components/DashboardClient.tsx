"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bell, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { MainNav } from "@/components/MainNav";
import { MatchCard } from "@/components/MatchCard";
import { MatchSearch } from "@/components/MatchSearch";
import type { MatchStatus, MatchSummary, ProviderState } from "@/types/domain";

type MatchesResponse = {
  apiState: ProviderState;
  demo: boolean;
  providerStatus: string;
  message: string;
  lastUpdatedAt: string;
  liveRefreshSeconds: number;
  matches: MatchSummary[];
};

const sections: { status: MatchStatus; title: string }[] = [
  { status: "LIVE", title: "En vivo" },
  { status: "UPCOMING", title: "Proximos" },
  { status: "FINISHED", title: "Finalizados" }
];

export function DashboardClient({ initialData }: { initialData: MatchesResponse }) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasLiveMatches = useMemo(() => data.matches.some((match) => match.status === "LIVE"), [data.matches]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/matches", { cache: "no-store" });
      const payload = (await response.json()) as MatchesResponse;
      setData(payload);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasLiveMatches) {
      return;
    }

    const interval = window.setInterval(refresh, Math.max(data.liveRefreshSeconds, 10) * 1000);
    return () => window.clearInterval(interval);
  }, [data.liveRefreshSeconds, hasLiveMatches, refresh]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <MainNav />
      <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-emerald-400/10 px-2.5 py-1 text-xs font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/25">
            <Database className="h-3.5 w-3.5" />
            {data.apiState === "REAL" ? "API REAL" : data.apiState === "ERROR" ? "API ERROR" : "DEMO"}
          </div>
          <div className={`mb-2 inline-flex items-center rounded px-2.5 py-1 text-xs font-black uppercase ring-1 ${stateClassName(data.apiState)}`}>
            {data.apiState === "REAL" ? "🟢 API REAL" : data.apiState === "ERROR" ? "🔴 API ERROR" : "🟡 DEMO"}
          </div>
          <h1 className="text-3xl font-black tracking-normal text-white sm:text-4xl">FUT Analytics</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
            {data.message}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center justify-center gap-2 rounded bg-emerald-400 px-4 py-2 text-sm font-black uppercase text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70"
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <p className="text-xs text-zinc-400">Ultima actualizacion: {formatDateTime(data.lastUpdatedAt)}</p>
        </div>
      </header>

      <MatchSearch />

      <div className="mb-5 grid grid-cols-3 gap-2 text-xs text-zinc-300">
        <span className="rounded border border-white/10 bg-white/[0.045] px-3 py-2"><Activity className="mb-1 h-4 w-4 text-emerald-300" />Stats</span>
        <span className="rounded border border-white/10 bg-white/[0.045] px-3 py-2"><Bell className="mb-1 h-4 w-4 text-yellow-300" />Alertas</span>
        <span className="rounded border border-white/10 bg-white/[0.045] px-3 py-2"><ShieldCheck className="mb-1 h-4 w-4 text-sky-300" />Sin scraping</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {sections.map((section) => {
          const sectionMatches = data.matches.filter((match) => match.status === section.status);
          return (
            <section key={section.status} className="min-w-0">
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-normal text-zinc-300">{section.title}</h2>
              <div className="space-y-3">
                {sectionMatches.length ? (
                  sectionMatches.map((match) => <MatchCard key={match.id} match={match} />)
                ) : (
                  <p className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-zinc-400">Sin partidos en esta categoria.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function stateClassName(state: ProviderState) {
  if (state === "REAL") {
    return "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25";
  }
  if (state === "ERROR") {
    return "bg-red-400/10 text-red-200 ring-red-300/25";
  }
  return "bg-yellow-400/10 text-yellow-100 ring-yellow-300/25";
}
