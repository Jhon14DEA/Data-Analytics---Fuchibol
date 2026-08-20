import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import type { MatchSummary } from "@/types/domain";

export function MatchCard({ match }: { match: MatchSummary }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-lg border border-white/10 bg-white/[0.045] p-4 transition hover:border-emerald-300/40 hover:bg-white/[0.075]"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-normal text-zinc-400">{match.competition}</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill status={match.status} />
            {match.source === "api-football" ? (
              <span className="rounded bg-emerald-300/10 px-2 py-1 text-[11px] font-bold uppercase text-emerald-200 ring-1 ring-emerald-300/20">
                Real
              </span>
            ) : null}
            {match.minute !== null ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-200">
                <Radio className="h-3.5 w-3.5" />
                {match.minute}'
              </span>
            ) : null}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 flex-none text-zinc-400" />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="truncate text-base font-bold text-white">{match.homeTeam}</p>
        <div className="rounded bg-black/30 px-3 py-2 text-lg font-black tabular-nums text-white ring-1 ring-white/10">
          {match.score.home} - {match.score.away}
        </div>
        <p className="truncate text-right text-base font-bold text-white">{match.awayTeam}</p>
      </div>
    </Link>
  );
}
