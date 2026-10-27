import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import type { AnalyzedMarket } from "@/types/domain";

export function AnalysisMarketCard({ market }: { market: AnalyzedMarket }) {
  const probabilityDetails = [
    market.estimatedProbability !== null && market.estimatedProbability !== undefined ? `Prob. est. ${(market.estimatedProbability * 100).toFixed(1)}%` : null,
    market.impliedProbability !== null && market.impliedProbability !== undefined ? `Impl. ${(market.impliedProbability * 100).toFixed(1)}%` : null,
    market.edge !== null && market.edge !== undefined ? `Raw edge ${(market.edge * 100).toFixed(1)}%` : null,
    market.uncertaintyAdjustedEdge !== null && market.uncertaintyAdjustedEdge !== undefined ? `Edge ajustado ${(market.uncertaintyAdjustedEdge * 100).toFixed(1)}%` : null
  ].filter((item): item is string => Boolean(item));
  const hasRealOddsMovement = Boolean(market.oddsMovement && market.oddsMovement.movementPercent !== null && market.oddsMovement.movementPercent !== undefined);

  return (
    <article className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase text-zinc-500">{market.market}</p>
          <h3 className="text-base font-black text-white">{market.selection}</h3>
        </div>
        <ConfidenceBadge classification={market.classification} />
      </div>
      <p className="mb-1 text-sm font-bold text-emerald-200">Valoración {market.confidence}/10</p>
      <p className="mb-1 text-xs font-black uppercase text-zinc-300">ENTRY STATE {market.entryState ?? "NO_ENTRY"}</p>
      <p className="mb-1 text-xs font-black uppercase text-zinc-400">MARKET STATUS {market.marketStatus ?? "UNRESOLVED"}</p>
      <p className="mb-1 text-xs font-bold text-zinc-300">Statistical Score {market.statisticalScore ?? market.confidence}/10</p>
      <p className="mb-1 text-xs font-bold text-zinc-300">BET SCORE {market.betScore ?? "N/D"}</p>
      <p className="mb-1 text-xs font-black uppercase text-zinc-400">Decisión {market.decision ?? "ESPERAR"}</p>
      <p className="mb-1 text-xs font-bold text-zinc-300">Calidad datos {market.marketDataQuality?.score ?? market.dataQuality ?? "N/D"}%</p>
      {market.marketDataQuality ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Histórica {market.marketDataQuality.historicalDataQuality ?? "N/D"}% · Live execution {market.marketDataQuality.liveExecutionQuality ?? "N/D"}%
        </p>
      ) : null}
      {market.sampleSize !== undefined ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Sample {market.sampleSize} · Raw {formatPercent(market.rawRate)} · Adjusted {formatPercent(market.adjustedRate)} · Incertidumbre {formatPercent(market.uncertainty)}
        </p>
      ) : null}
      {market.probabilityNote ? <p className="mb-1 text-xs font-black uppercase text-yellow-100">{market.probabilityNote}</p> : null}
      {market.bookmaker && market.odd ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Cuota {market.odd.toFixed(2)} · {market.bookmaker}
        </p>
      ) : null}
      {market.finalTimeDebug ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Tiempo restante {market.finalTimeDebug.remainingMinutes !== null ? `${market.finalTimeDebug.remainingMinutes} min` : "N/D"}
        </p>
      ) : null}
      {probabilityDetails.length ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          {probabilityDetails.join(" · ")}
        </p>
      ) : null}
      {market.liveProbability !== null && market.liveProbability !== undefined ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Outlook {market.statisticalOutlook ?? "N/D"} · Prematch {formatPercent(market.adjustedRate)} · Live {formatPercent(market.liveProbability)} · Pesos {formatPercent(market.prematchWeight)}/{formatPercent(market.liveWeight)}
        </p>
      ) : null}
      {market.concordanceScore !== null && market.concordanceScore !== undefined ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Concordance {market.concordanceScore}/100 · Coverage {market.evidenceCoverage ?? "N/D"}% · Live attack {market.liveAttackScore ?? "N/D"}/100
        </p>
      ) : null}
      {market.lambdaRemaining !== null && market.lambdaRemaining !== undefined ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Lambda restante {market.lambdaRemaining.toFixed(2)} · P&gt;=1 {formatPercent(market.remainingGoalProbabilities?.gte1)} · P&gt;=2 {formatPercent(market.remainingGoalProbabilities?.gte2)} · P&gt;=3 {formatPercent(market.remainingGoalProbabilities?.gte3)}
        </p>
      ) : null}
      {market.recentMomentumScore !== null && market.recentMomentumScore !== undefined ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Momentum: acumulado {market.cumulativeAttackScore ?? "N/D"}/100 · reciente {market.recentMomentumScore}/100 · tendencia {market.matchTrendState ?? "N/D"} ({market.matchTrendScore ?? "N/D"}/100) · señal {market.goalPressureSignal ?? "N/D"}
        </p>
      ) : null}
      {market.finalTimeDebug ? (
        <pre className="mb-2 overflow-x-auto rounded border border-yellow-300/20 bg-yellow-300/8 p-2 text-[11px] leading-4 text-yellow-50">
          {JSON.stringify(market.finalTimeDebug, null, 2)}
        </pre>
      ) : null}
      {hasRealOddsMovement && market.oddsMovement ? (
        <p className="mb-1 text-xs font-bold text-zinc-300">
          Movimiento real {formatMovement(market.oddsMovement)}
        </p>
      ) : null}
      <p className="mb-3 text-xs font-black uppercase text-zinc-400">Riesgo {market.risk ?? riskFromConfidence(market.confidence)}</p>
      <List title="Datos a favor" items={market.supportingData} />
      <List title="Riesgos" items={market.risks} />
      {market.missingRequirements?.length ? <List title="Falta" items={market.missingRequirements} /> : null}
      {market.decisionBlockers?.length ? <List title="Decision blockers" items={market.decisionBlockers.map((item) => `${item.rule}: valor ${item.value ?? "N/D"} / umbral ${item.threshold}. ${item.effect}`)} /> : null}
      {market.discardReason ? <List title="Motivo descarte" items={[market.discardReason]} /> : null}
      {market.improvements?.length ? <List title="Para mejorar" items={market.improvements} /> : null}
      <List title="Invalida si" items={market.invalidators} />
    </article>
  );
}

function riskFromConfidence(confidence: number) {
  if (confidence >= 7.5) return "bajo";
  if (confidence >= 5.5) return "medio";
  return "alto";
}

function formatPercent(value: number | null | undefined) {
  return value !== null && value !== undefined ? `${(value * 100).toFixed(1)}%` : "N/D";
}

function formatMovement(movement: NonNullable<AnalyzedMarket["oddsMovement"]>) {
  const parts = [
    movement.openingOdds !== null && movement.openingOdds !== undefined ? `apertura ${movement.openingOdds.toFixed(2)}` : null,
    movement.previousOdds !== null && movement.previousOdds !== undefined ? `previa ${movement.previousOdds.toFixed(2)}` : null,
    movement.currentOdds !== null && movement.currentOdds !== undefined ? `actual ${movement.currentOdds.toFixed(2)}` : null,
    movement.movementPercent !== null && movement.movementPercent !== undefined ? `variación ${formatPercent(movement.movementPercent)}` : null
  ].filter((item): item is string => Boolean(item));
  return parts.join(" · ");
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
