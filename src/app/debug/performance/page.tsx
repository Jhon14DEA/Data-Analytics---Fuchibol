import Link from "next/link";
import { getPerformanceMetrics } from "@/lib/performance";

export const dynamic = "force-dynamic";

export default function PerformancePage() {
  const metrics = getPerformanceMetrics();
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 text-white">
      <Link href="/" className="text-sm text-emerald-200">Volver al dashboard</Link>
      <h1 className="mt-5 text-3xl font-black">Rendimiento</h1>
      <p className="mt-2 text-sm text-zinc-400">Solo visible en desarrollo. Las metricas no contienen credenciales ni parametros sensibles.</p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-white/[0.06] text-xs uppercase text-zinc-400">
            <tr><th className="p-3">Proceso</th><th className="p-3">Media</th><th className="p-3">Maximo</th><th className="p-3">Hits</th><th className="p-3">Misses</th><th className="p-3">Errores</th><th className="p-3">Proveedor</th></tr>
          </thead>
          <tbody>
            {metrics.map((metric) => <tr key={metric.process} className="border-t border-white/10"><td className="p-3 font-bold">{metric.process}</td><td className="p-3">{metric.averageMs} ms</td><td className="p-3">{metric.maxMs} ms</td><td className="p-3">{metric.cacheHits}</td><td className="p-3">{metric.cacheMisses}</td><td className="p-3">{metric.errors}</td><td className="p-3">{metric.providers.join(", ") || "interno"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}