"use client";
import { useState } from 'react';
import type { LiveHistoricalContext } from '@/services/historical/liveContext';
type Profile=LiveHistoricalContext['home'][number];
const fields:[keyof Profile['features'],string,boolean][]=[['scoredRate','Marca',true],['concededRate','Recibe',true],['over05HtRate','O0.5 1H',true],['over15HtRate','O1.5 1H',true],['over05FtRate','O0.5 FT',true],['over15FtRate','O1.5 FT',true],['over25FtRate','O2.5 FT',true],['bttsRate','BTTS',true],['avgShotsOnTarget','SOT / partido',false],['avgCorners','Córners / partido',false],['avgYellowCards','Amarillas / partido',false],['avgFouls','Faltas / partido',false],['scoringStreak','Racha marcando',false],['concedingStreak','Racha recibiendo',false]];
const format=(n:number|null|undefined,percent=false)=>n==null?'N/D':percent?`${Math.round(n*100)}%`:String(Math.round(n*100)/100);
export function HistoricalContextPanel({name,context,liveSot}:{name:string;context?:LiveHistoricalContext;liveSot:number|null}){
 const [window,setWindow]=useState<5|10|20>(10);
 const columns=[context?.home.find(p=>p.window===window&&p.venue==='ALL'),context?.home.find(p=>p.window===window&&p.venue==='HOME'),context?.away.find(p=>p.window===window&&p.venue==='ALL'),context?.away.find(p=>p.window===window&&p.venue==='AWAY')];
 const h=columns[1]?.features.avgShotsOnTarget,a=columns[3]?.features.avgShotsOnTarget;
 return <details className="rounded-lg border border-sky-800/40 bg-sky-950/10 p-3 text-sm">
  <summary className="cursor-pointer text-sky-200">Contexto histórico · {name} · {context?.status==='AVAILABLE'?'Disponible':'N/D'}</summary>
  <p className="mt-2 text-xs text-zinc-400">Informativo. No altera LIVE, ALERT, HYBRID ni decisiones. Tasas de partidos completos, no probabilidades del minuto actual.</p>
  {!context||context.status==='N/D'?<p className="mt-2 text-zinc-400">HISTORICAL_CONTEXT = N/D · {context?.reason==='NO_OBSERVED_HISTORY'?'Sin historia disponible antes del kickoff.':'Sin mapping confiable o contexto disponible.'}</p>:<>
   <label className="my-2 block">Ventana <select aria-label={`Ventana histórica ${name}`} className="rounded bg-zinc-900 p-1" value={window} onChange={e=>setWindow(Number(e.target.value) as 5|10|20)}>{[5,10,20].map(n=><option key={n} value={n}>Últimos {n}</option>)}</select></label>
   <p>LIVE: SOT acumulado {format(liveSot)} · Histórico local HOME + visitante AWAY: {format(h==null||a==null?null:h+a)} SOT por partido completo. No son ventanas temporales equivalentes.</p>
   <p className="mt-2">O0.5 1H: {context.comparison.OVER05_1H??'N/D'} · O0.5 FT: {context.comparison.OVER05_FT??'N/D'}</p>
   <p className="text-xs text-zinc-500">Comparación fija: últimos 10 HOME/AWAY; ambos con frecuencia &gt;50% apoyan el mercado, ambos &lt;50% contradicen; resto neutro. Muestra o cobertura insuficiente: N/D. No es señal de entrada.</p>
   <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Estadística</th>{['Local ALL','Local HOME','Visitante ALL','Visitante AWAY'].map(label=><th key={label} className="px-2">{label}</th>)}</tr></thead><tbody>
    <tr><td>Muestra</td>{columns.map((p,i)=><td className="px-2" key={i}>{p?.sampleSize??'N/D'}/{window}</td>)}</tr>
    {fields.map(([key,label,percent])=><tr key={key}><td>{label}</td>{columns.map((p,i)=><td className="px-2" key={i}>{format(p?.features[key],percent)}{key==='scoringStreak'&&p?.streakCensored.scoring||key==='concedingStreak'&&p?.streakCensored.conceding?' (mín.)':''}</td>)}</tr>)}
    <tr><td>Último partido</td>{columns.map((p,i)=><td className="px-2" key={i}>{p?.newestFixtureDate?.slice(0,10)??'N/D'}</td>)}</tr>
   </tbody></table></div>
   <details className="mt-2 text-xs text-zinc-400"><summary>Cobertura por grupo · corte {context.before}</summary>{columns.map((p,i)=><p key={i}>{i<2?'Local':'Visitante'} {p?.venue}: {p?Object.entries(p.coverage).map(([key,c])=>`${key} ${c.available}/${c.available+c.missing} (${format(c.ratio,true)})`).join(' · '):'N/D'}</p>)}</details>
  </>}
 </details>;
}
