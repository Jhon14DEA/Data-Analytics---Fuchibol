"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { MatchSearchDiagnostics, MatchSummary } from "@/types/domain";

const searchCache = new Map<string, MatchSummary[]>();

type MatchSearchProps = {
  label?: string;
  target?: "analysis" | "deep-analysis";
  showDate?: boolean;
};

export function MatchSearch({ label = "Analizar partido", target = "analysis", showDate = false }: MatchSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<MatchSearchDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      setDiagnostics(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const cacheKey = `${query.trim().toLowerCase()}:${date}`;
      const cached = searchCache.get(cacheKey);
      if (cached) {
        setMatches(cached);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (date) {
          params.set("date", date);
        }
        const response = await fetch(`/api/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as { matches: MatchSummary[]; diagnostics?: MatchSearchDiagnostics };
        searchCache.set(cacheKey, payload.matches);
        setMatches(payload.matches);
        setDiagnostics(payload.diagnostics ?? null);
      } catch {
        if (!controller.signal.aborted) {
          setMatches([]);
          setDiagnostics(null);
        }
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, date]);

  return (
    <section className="mb-5 rounded-lg border border-white/10 bg-black/20 p-4">
      <label className="mb-2 block text-xs font-extrabold uppercase text-zinc-400">{label}</label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar partido..."
            className="w-full rounded border border-white/10 bg-white/[0.06] py-2.5 pl-10 pr-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/50"
          />
        </div>
        {showDate ? (
          <input
            value={date}
            onChange={(event) => setDate(event.target.value)}
            type="date"
            className="rounded border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-300/50"
          />
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {loading ? <p className="text-sm text-zinc-400">Buscando...</p> : null}
        {matches.map((match) => (
          <button
            key={match.id}
            type="button"
            onClick={() => router.push(target === "deep-analysis" ? `/matches/${match.id}/deep-analysis` : `/analyze/${match.id}`)}
            className="grid w-full grid-cols-[1fr_auto] gap-3 rounded border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-emerald-300/40 hover:bg-white/[0.07]"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-white">
                {match.homeTeam} vs {match.awayTeam}
              </span>
              <span className="block truncate text-xs text-zinc-400">{match.competition}</span>
              <span className="block truncate text-xs text-zinc-500">
                {formatDate(match.kickoffAt)} · {statusLabel(match.status)}
              </span>
            </span>
            <span className="text-sm font-black tabular-nums text-emerald-200">
              {match.status === "UPCOMING" ? "Pre" : `${match.score.home}-${match.score.away}`}
            </span>
          </button>
        ))}
        {query.trim().length >= 2 && !loading && !matches.length ? (
          <div className="rounded border border-yellow-300/15 bg-yellow-300/8 p-3 text-sm text-zinc-300">
            <p className="font-bold text-yellow-100">Sin resultados para "{diagnostics?.term ?? query}".</p>
            <p className="mt-1">Proveedor: {diagnostics?.provider ?? "N/D"}</p>
            <p>Rango consultado: {diagnostics?.searchedRanges.join(", ") || "N/D"}</p>
            <p>Resultados API: {diagnostics?.apiResults ?? "N/D"} · Filtrados: {diagnostics?.filteredOut ?? "N/D"}</p>
            <p>Motivo: {diagnostics?.filterReasons.join("; ") || "N/D"}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatDate(value?: string) {
  if (!value) return "Fecha N/D";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: MatchSummary["status"]) {
  if (status === "LIVE") return "EN VIVO";
  if (status === "FINISHED") return "Finalizado";
  return "Proximo";
}
