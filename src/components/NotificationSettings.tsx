"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

export function NotificationSettings() {
  const [state, setState] = useState<"idle" | "enabled" | "unavailable" | "error">("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unavailable");
      return;
    }

    navigator.serviceWorker.getRegistration("/sw.js").then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) setState("enabled");
    });
  }, []);

  async function enableNotifications() {
    setBusy(true);
    try {
      const configResponse = await fetch("/api/notifications/config", { cache: "no-store" });
      const config = (await configResponse.json()) as { configured: boolean; publicKey: string | null };
      if (!config.configured || !config.publicKey || Notification.permission === "denied") {
        setState("unavailable");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("unavailable");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(config.publicKey)
      });
      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON())
      });
      if (!response.ok) throw new Error("No se pudo guardar la suscripcion");
      setState("enabled");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "enabled") {
    return <span className="inline-flex items-center gap-2 rounded border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200"><Bell className="h-4 w-4" /> Alertas activas</span>;
  }

  return (
    <button
      type="button"
      onClick={enableNotifications}
      disabled={busy || state === "unavailable"}
      title={state === "unavailable" ? "Configura Web Push y usa un navegador compatible" : undefined}
      className="inline-flex items-center justify-center gap-2 rounded border border-yellow-300/30 bg-yellow-400/10 px-3 py-2 text-xs font-black uppercase text-yellow-100 transition hover:bg-yellow-400/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <BellOff className="h-4 w-4" />
      {busy ? "Activando..." : state === "error" ? "Reintentar alertas" : "Activar alertas"}
    </button>
  );
}

function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}