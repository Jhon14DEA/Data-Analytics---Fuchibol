"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { CurrentRecommendation, MatchAnalysisResult } from "@/types/domain";

export function CurrentRecommendationPanel({
  matchId,
  initialRecommendation
}: {
  matchId: string;
  initialRecommendation: CurrentRecommendation;
}) {
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [isLoading, setIsLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function analyzeNow() {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/analyze/${matchId}?refresh=${Date.now()}`, { cache: "no-store" });
      const payload = (await response.json()) as MatchAnalysisResult;
      setRecommendation(payload.currentRecommendation);
      setUpdatedAt(new Date().toISOString());
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.055] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase text-emerald-100">RECOMENDACIÓN ACTUAL</h2>
          {updatedAt ? <p className="mt-1 text-xs text-zinc-400">Recalculado: {new Date(updatedAt).toLocaleTimeString("es-EC")}</p> : null}
        </div>
        <button
          type="button"
          onClick={analyzeNow}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-black uppercase text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          ANALIZAR AHORA
        </button>
      </div>

      {recommendation.options.length ? (
        <div className="space-y-3">
          {recommendation.options.map((option, index) => (
            <article key={`${option.bookmaker}-${option.market}-${option.selection}-${index}`} className="rounded border border-white/10 bg-black/25 p-3">
              <p className="mb-3 text-xs font-black uppercase text-emerald-200">OPCIÓN {index + 1}</p>
              <div className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                <Info label="Mercado" value={option.market} />
                <Info label="Selección" value={option.selection} />
                <Info label="Casa" value={option.bookmaker} />
                <Info label="Cuota" value={option.odd.toFixed(2)} />
                <Info label="Confianza" value={`${option.confidence}/10`} />
                <Info label="Estado" value={option.state} />
              </div>
              <List title="Razones" items={option.reasons.slice(0, 3)} />
              <List title="Riesgos" items={option.risks.slice(0, 2)} />
              <p className="mt-3 text-sm font-black text-white">Decisión: {option.decision}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded border border-white/10 bg-black/25 p-4 text-sm font-black text-zinc-100">
          {recommendation.message ?? "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE AHORA"}
        </p>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="block text-[11px] font-black uppercase text-zinc-500">{label}:</span>
      <span className="font-bold text-white">{value || "N/D"}</span>
    </p>
  );
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
