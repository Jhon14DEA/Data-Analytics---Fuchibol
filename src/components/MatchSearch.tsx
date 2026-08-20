"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { MatchSummary } from "@/types/domain";

const searchCache = new Map<string, MatchSummary[]>();

export function MatchSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const cacheKey = query.trim().toLowerCase();
      const cached = searchCache.get(cacheKey);
      if (cached) {
        setMatches(cached);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as { matches: MatchSummary[] };
        searchCache.set(cacheKey, payload.matches);
        setMatches(payload.matches);
      } catch {
        if (!controller.signal.aborted) {
          setMatches([]);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <section className="mb-5 rounded-lg border border-white/10 bg-black/20 p-4">
      <label className="mb-2 block text-xs font-extrabold uppercase text-zinc-400">Analizar partido</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar partido..."
          className="w-full rounded border border-white/10 bg-white/[0.06] py-2.5 pl-10 pr-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/50"
        />
      </div>
      <div className="mt-3 space-y-2">
        {loading ? <p className="text-sm text-zinc-400">Buscando...</p> : null}
        {matches.map((match) => (
          <button
            key={match.id}
            type="button"
            onClick={() => router.push(`/analyze/${match.id}`)}
            className="grid w-full grid-cols-[1fr_auto] gap-3 rounded border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-emerald-300/40 hover:bg-white/[0.07]"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-white">
                {match.homeTeam} vs {match.awayTeam}
              </span>
              <span className="block truncate text-xs text-zinc-400">{match.competition}</span>
            </span>
            <span className="text-sm font-black tabular-nums text-emerald-200">
              {match.score.home}-{match.score.away}
            </span>
          </button>
        ))}
        {query.trim().length >= 2 && !loading && !matches.length ? <p className="text-sm text-zinc-400">Sin resultados.</p> : null}
      </div>
    </section>
  );
}
