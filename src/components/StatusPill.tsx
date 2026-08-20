import { Circle, Clock, Trophy } from "lucide-react";
import type { MatchStatus } from "@/types/domain";

const statusMap: Record<MatchStatus, { label: string; className: string; Icon: typeof Circle }> = {
  LIVE: { label: "EN VIVO", className: "bg-red-500/15 text-red-200 ring-red-400/35", Icon: Circle },
  UPCOMING: { label: "PROXIMO", className: "bg-sky-400/15 text-sky-100 ring-sky-300/30", Icon: Clock },
  FINISHED: { label: "FINALIZADO", className: "bg-zinc-400/15 text-zinc-200 ring-zinc-300/25", Icon: Trophy }
};

export function StatusPill({ status }: { status: MatchStatus }) {
  const { label, className, Icon } = statusMap[status];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-bold uppercase ring-1 ${className}`}>
      <Icon className="h-3 w-3" fill={status === "LIVE" ? "currentColor" : "none"} />
      {label}
    </span>
  );
}
