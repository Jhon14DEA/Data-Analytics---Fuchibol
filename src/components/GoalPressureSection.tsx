import type { HighGoalPressure } from '@/services/analysis/highGoalPressure';

export function GoalPressureSection({matches}:{matches:readonly {fixtureId:string;match?:string;competition?:string;minute?:number|null;score?:{home:number;away:number};status?:string;goalPressure?:HighGoalPressure}[]}){
 const live=matches.filter(m=>m.status==='LIVE'&&m.goalPressure);
 const rank={PRESSURE_HIGH:0,PRESSURE_MEDIUM:1,PRESSURE_LOW:2,INSUFFICIENT_DATA:3};
 const unique=[...new Map(live.map(m=>[m.fixtureId,m])).values()].sort((a,b)=>rank[a.goalPressure!.level]-rank[b.goalPressure!.level]);
 return <section className="rounded-2xl border border-cyan-800 bg-zinc-950 p-4">
  <h2 className="font-bold text-cyan-300">PRESIÓN DE GOL ({unique.length})</h2>
  <p className="text-xs text-zinc-400">Contexto informativo independiente de LIVE ALERT y HYBRID. No es una recomendación de entrada ni una probabilidad calibrada.</p>
  {!unique.length&&<p className="mt-3 text-sm text-zinc-400">Sin fixtures con contexto disponible.</p>}
  <div className="mt-3 grid gap-3 lg:grid-cols-2">{unique.map(m=>{const p=m.goalPressure!;return <article key={m.fixtureId} className="rounded-xl border border-zinc-700 p-3">
   <p className="text-xs text-zinc-400">{m.competition} · {m.minute??'N/D'}′ · {m.score?`${m.score.home}-${m.score.away}`:'N/D'}</p>
   <h3 className="font-semibold">{m.match??m.fixtureId}</h3>
   <p className="text-sm text-cyan-300">{p.derivedState==='MATCH_EXPLOSION'?'REVISAR URGENTE — PARTIDO ABIERTO':p.level==='PRESSURE_HIGH'?'REVISAR URGENTE — ALTA PRESIÓN DE GOL':p.level==='INSUFFICIENT_DATA'?'DATOS INSUFICIENTES':p.level.replace('PRESSURE_','')}</p>
   <p className="text-xs">Cobertura: {p.dataQuality}% · Confianza de evidencia: {p.confidence??'N/D'}{p.confidence!==null?'/100':''}</p>
   <p className="text-xs">Histórico: {p.historicalStrength?.support==='BOTH_STRONG'?'apoyo ofensivo de ambos':p.historicalStrength?'apoyo no confirmado':'N/D'}</p>
   <p className="text-xs">Razones: {p.reasons.join(' · ')||'Sin señales suficientes'}</p>
   <p className="text-xs text-amber-300">Limitaciones: {p.blockers.join(' · ')||'Ninguna detectada'}</p>
   {!!p.markets.length&&<p className="mt-2 text-xs">Mercados para revisar, sin cuota verificada: {p.markets.join(' · ')}</p>}
  </article>;})}</div>
 </section>;
}
