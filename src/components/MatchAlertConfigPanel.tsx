"use client";

import { Bell, Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { MatchAlert, MatchAlertConfiguration, MatchAlertRuleType } from "@/types/domain";

const RULES: { key: MatchAlertRuleType; label: string }[] = [
  { key: "GOAL", label: "Gol" },
  { key: "SHOTS_ON_TARGET", label: "Remates al arco" },
  { key: "XG", label: "xG" },
  { key: "CORNERS", label: "Corners" },
  { key: "CARDS", label: "Tarjetas" },
  { key: "SUBSTITUTIONS", label: "Cambios" },
  { key: "ODDS", label: "Cuotas" },
  { key: "RECOMMENDATION_CHANGE", label: "Cambio importante en la recomendacion" }
];

export function MatchAlertConfigPanel({ matchId }: { matchId: string }) {
  const [config, setConfig] = useState<MatchAlertConfiguration | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alerts, setAlerts] = useState<MatchAlert[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/matches/${matchId}/alert-config`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: MatchAlertConfiguration) => setConfig(payload))
      .catch(() => setMessage("No se pudo cargar configuracion de alertas."));
  }, [matchId]);

  async function save(nextConfig = config) {
    if (!nextConfig) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/matches/${matchId}/alert-config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, rules: nextConfig.rules })
      });
      const payload = (await response.json()) as { config: MatchAlertConfiguration };
      setConfig(payload.config);
      setOpen(true);
      setMessage("Alertas registradas para este partido.");
    } finally {
      setSaving(false);
    }
  }

  async function evaluateNow() {
    setSaving(true);
    try {
      const response = await fetch(`/api/matches/${matchId}/alerts/evaluate`, { method: "POST", cache: "no-store" });
      const payload = (await response.json()) as { alerts: MatchAlert[]; knownFingerprints: number };
      setAlerts(payload.alerts);
      setMessage(`Motor evaluado. Fingerprints registrados: ${payload.knownFingerprints}.`);
    } finally {
      setSaving(false);
    }
  }

  function toggleRule(key: MatchAlertRuleType) {
    if (!config) return;
    setConfig({ ...config, rules: { ...config.rules, [key]: !config.rules[key] } });
  }

  return (
    <section className="rounded-lg border border-yellow-300/20 bg-yellow-300/[0.055] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase text-yellow-100">Alertas del partido</h2>
          <p className="mt-1 text-xs text-zinc-400">{config?.enabled ? "Configuracion activa" : "Sin configurar"}</p>
        </div>
        <button
          type="button"
          onClick={() => (config?.enabled ? setOpen((value) => !value) : save())}
          disabled={saving || !config}
          className="inline-flex items-center gap-2 rounded bg-yellow-300 px-3 py-2 text-xs font-black uppercase text-black transition hover:bg-yellow-200 disabled:cursor-wait disabled:opacity-70"
        >
          <Bell className="h-4 w-4" />
          {saving ? "Guardando..." : config?.enabled ? "Configurar alertas" : "Activar alertas"}
        </button>
      </div>

      {open && config ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {RULES.map((rule) => (
              <label key={rule.key} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-zinc-200">
                <input type="checkbox" checked={config.rules[rule.key]} onChange={() => toggleRule(rule.key)} className="h-4 w-4 accent-emerald-400" />
                {rule.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => save()} disabled={saving} className="inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-black uppercase text-black">
              <Check className="h-4 w-4" />
              Guardar
            </button>
            <button type="button" onClick={evaluateNow} disabled={saving} className="inline-flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-black uppercase text-zinc-200 hover:bg-white/10">
              <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
              Evaluar motor
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="mt-3 text-sm text-zinc-300">{message}</p> : null}
      {alerts.length ? (
        <div className="mt-3 space-y-2">
          {alerts.map((alert) => (
            <div key={alert.fingerprint ?? `${alert.type}-${alert.minute}`} className="rounded border border-yellow-300/20 bg-black/25 p-3">
              <p className="font-bold text-yellow-100">{alert.title}</p>
              <p className="text-sm text-zinc-300">{alert.message}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
