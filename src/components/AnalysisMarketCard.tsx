import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import type { AnalyzedMarket } from "@/types/domain";

export function AnalysisMarketCard({ market }: { market: AnalyzedMarket }) {
  return (
    <article className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase text-zinc-500">{market.market}</p>
          <h3 className="text-base font-black text-white">{market.selection}</h3>
        </div>
        <ConfidenceBadge classification={market.classification} />
      </div>
      <p className="mb-3 text-sm font-bold text-emerald-200">Confianza {market.confidence}/10</p>
      <List title="Datos a favor" items={market.supportingData} />
      <List title="Riesgos" items={market.risks} />
      <List title="Invalida si" items={market.invalidators} />
    </article>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-extrabold uppercase text-zinc-500">{title}</p>
      <ul className="mt-1 space-y-1 text-sm leading-5 text-zinc-300">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}
