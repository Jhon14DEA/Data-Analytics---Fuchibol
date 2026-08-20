export function StatRow({
  label,
  home,
  away,
  suffix = ""
}: {
  label: string;
  home: number | null;
  away: number | null;
  suffix?: string;
}) {
  const numericHome = home ?? 0;
  const numericAway = away ?? 0;
  const total = Math.max(numericHome + numericAway, 1);
  const homeWidth = `${Math.max((numericHome / total) * 100, numericHome > 0 ? 8 : 0)}%`;
  const awayWidth = `${Math.max((numericAway / total) * 100, numericAway > 0 ? 8 : 0)}%`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[52px_1fr_52px] items-center gap-3 text-sm">
        <span className="font-semibold text-emerald-100">
          {formatValue(home, suffix)}
        </span>
        <span className="text-center text-xs uppercase tracking-normal text-zinc-400">{label}</span>
        <span className="text-right font-semibold text-rose-100">
          {formatValue(away, suffix)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex h-2 justify-end overflow-hidden rounded bg-white/8">
          <div className="h-full rounded bg-emerald-400" style={{ width: homeWidth }} />
        </div>
        <div className="h-2 overflow-hidden rounded bg-white/8">
          <div className="h-full rounded bg-rose-400" style={{ width: awayWidth }} />
        </div>
      </div>
    </div>
  );
}

function formatValue(value: number | null, suffix: string) {
  return value === null ? "N/D" : `${value}${suffix}`;
}
