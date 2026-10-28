'use client';
import { useEffect, useRef, useState } from 'react';

type Fixture = { fixtureId:string; teams:{home:string;away:string}; competition:string; minute:number|null;
  score:{home:number|null;away:number|null}; pressureLevel:string|null; matchExplosion:boolean|null };
type Turn = {role:'user'|'assistant';content:string;sources?:string[];at?:string;warning?:string};
const questions = ['¿Qué partidos LIVE tienen mayor presión de gol?','Analiza este partido.','¿Qué ves para goles, córners, tarjetas o remates?','¿Qué dice el histórico?','¿Qué mercados merece revisar?'];
const display = (value: unknown) => value == null ? 'N/D' : String(value);
const field = 'w-full rounded-lg border border-white/15 bg-zinc-900 p-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-400';

export function AiChat() {
  const [authenticated,setAuthenticated]=useState<boolean|null>(null),[password,setPassword]=useState('');
  const [fixtures,setFixtures]=useState<Fixture[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState('');
  const [threads,setThreads]=useState<Record<string,Turn[]>>({}),[question,setQuestion]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const end=useRef<HTMLDivElement>(null),locked=useRef(false);
  const turns=threads[selected]??[];
  useEffect(()=>{const controller=new AbortController();fetch('/api/ai-chat/session',{cache:'no-store',signal:controller.signal})
    .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);setAuthenticated(data.authenticated);})
    .catch(e=>{if(e.name!=='AbortError'){setError(e.message);setAuthenticated(false);}});return()=>controller.abort();},[]);
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[turns.length,busy]);
  async function api(path:string,init?:RequestInit){
    const r=await fetch('/api/ai-chat/'+path,{cache:'no-store',...init});const data=await r.json();
    if(r.status===401){setAuthenticated(false);setThreads({});setFixtures([]);}
    if(!r.ok)throw Error(data.error??'No se pudo completar la consulta.');return data;
  }
  async function live(next?:string){
    setLoading(true);setError('');try{const data=await api('live'+(next?'?cursor='+encodeURIComponent(next):''));
      setFixtures(old=>next?[...old,...data.items.filter((f:Fixture)=>!old.some(x=>x.fixtureId===f.fixtureId))]:data.items);setCursor(data.nextCursor);
    }catch(e){setError(e instanceof Error?e.message:'Error al consultar LIVE.');}finally{setLoading(false);}
  }
  // One load when a valid session is recovered/created; subsequent refresh is manual.
  useEffect(()=>{if(authenticated)void live();},[authenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  async function login(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
    await api('session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});setPassword('');setAuthenticated(true);
  }catch(e){setError(e instanceof Error?e.message:'No se pudo acceder.');}finally{setBusy(false);}}
  async function send(e:React.FormEvent){
    e.preventDefault();if(!question.trim()||locked.current)return;locked.current=true;setBusy(true);setError('');
    const key=selected, prior=threads[key]??[], user:Turn={role:'user',content:question.trim()}, outgoing=[...prior,user];
    setThreads(t=>({...t,[key]:outgoing}));setQuestion('');
    try{const data=await api('message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixtureId:key||null,
      messages:outgoing.slice(-8).map(({role,content})=>({role,content:content.slice(0,1800)}))})});
      const answer:Turn={role:'assistant',content:data.answer,sources:data.sources,at:data.generatedAt,
        warning:data.incomplete?'Respuesta cortada por el límite de extensión.':data.truncated?'Comparación limitada a una parte de los partidos LIVE.':undefined};
      setThreads(t=>({...t,[key]:[...(t[key]??[]),answer].slice(-40)}));
    }catch(e){setThreads(t=>({...t,[key]:prior}));setQuestion(user.content);setError(e instanceof Error?e.message:'Error al consultar.');}
    finally{locked.current=false;setBusy(false);}
  }
  async function logout(){setBusy(true);try{await api('session',{method:'DELETE'});setAuthenticated(false);setThreads({});setFixtures([]);setQuestion('');setSelected('');}
    catch(e){setError(e instanceof Error?e.message:'No se pudo cerrar sesión.');}finally{setBusy(false);}}
  if(authenticated===null)return <p className="text-zinc-400" role="status">Comprobando acceso…</p>;
  if(!authenticated)return <section className="mx-auto max-w-md rounded-xl border border-white/10 bg-white/[.03] p-6">
    <h2 className="text-xl font-bold text-white">Acceso privado</h2><p className="my-3 text-sm text-zinc-400">Introduce la contraseña del chat. No es tu clave de OpenAI ni la de los proveedores.</p>
    <form onSubmit={login} className="space-y-4"><label className="block text-sm text-zinc-300">Contraseña
      <input className={field+' mt-2'} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={256}/></label>
      <button disabled={busy} className="w-full rounded-lg bg-emerald-400 p-3 font-bold text-zinc-950 disabled:opacity-50">{busy?'Accediendo…':'Entrar al chat'}</button></form>
    {error&&<p role="alert" className="mt-4 text-sm text-amber-300">{error}</p>}
  </section>;
  const chosen=fixtures.find(f=>f.fixtureId===selected);
  return <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
    <aside className="space-y-4 rounded-xl border border-white/10 bg-white/[.03] p-4">
      <div className="flex items-center justify-between"><h2 className="font-bold text-white">Partidos LIVE</h2><button disabled={loading||busy} onClick={()=>live()} className="text-sm text-emerald-300 disabled:opacity-50">{loading?'Cargando…':'Actualizar'}</button></div>
      <label className="block text-sm text-zinc-400">Contexto de la conversación
        <select className={field+' mt-2'} value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setQuestion('');setError('');}}>
          <option value="">Panorama LIVE · comparar presión</option>
          {selected&&!chosen&&<option value={selected}>Partido seleccionado · fuera de LIVE</option>}
          {fixtures.map(f=><option key={f.fixtureId} value={f.fixtureId}>{f.teams.home} — {f.teams.away}</option>)}
        </select></label>
      {!loading&&!fixtures.length&&<p className="text-sm text-amber-200">No hay partidos LIVE con datos frescos guardados. El chat no consulta a los proveedores para actualizarlos.</p>}
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {fixtures.map(f=><button key={f.fixtureId} disabled={busy} onClick={()=>{setSelected(f.fixtureId);setQuestion('');}} aria-pressed={selected===f.fixtureId}
          className={`w-full rounded-lg border p-3 text-left text-sm ${selected===f.fixtureId?'border-emerald-400 bg-emerald-400/10':'border-white/10 bg-zinc-900'}`}>
          <span className="block font-bold text-white">{f.teams.home} — {f.teams.away}</span>
          <span className="block text-zinc-400">{f.competition} · {display(f.minute)}′ · {display(f.score.home)}–{display(f.score.away)}</span>
          <span className="block text-emerald-200">Presión: {display(f.pressureLevel)}</span>
          <span className="text-zinc-400">Match explosion: {f.matchExplosion===null?'N/D':f.matchExplosion?'Sí':'No'}</span>
        </button>)}
      </div>
      {cursor&&<button disabled={loading||busy} onClick={()=>live(cursor)} className="text-sm text-emerald-300">Cargar más partidos</button>}
      <p className="text-xs text-zinc-500">Cada pregunta consulta los datos guardados de nuevo. Los mensajes se conservan en esta pestaña, separados por partido.</p>
      <button onClick={logout} disabled={busy} className="text-sm text-zinc-400 underline">Cerrar sesión</button>
    </aside>
    <section className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-white/[.03]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4"><h2 className="font-bold text-white">{selected?(chosen?`${chosen.teams.home} — ${chosen.teams.away}`:'Partido seleccionado'):'Panorama LIVE'}</h2>
        <button disabled={busy} onClick={()=>setThreads(t=>({...t,[selected]:[]}))} className="shrink-0 text-xs text-zinc-400 underline">Borrar conversación</button></div>
      <div role="log" aria-live="polite" aria-busy={busy} className="h-[45vh] min-h-64 space-y-4 overflow-y-auto p-4 sm:h-[52vh]">
        {!turns.length&&<p className="text-sm text-zinc-400">{selected?'Pregunta por presión, goles, córners, tarjetas, remates o histórico.':'Compara la presión entre los LIVE. Selecciona un partido para analizar sus estadísticas, eventos y alineaciones.'}</p>}
        {turns.map((m,i)=><article key={i} className={`rounded-lg p-3 ${m.role==='user'?'ml-6 bg-emerald-400/10':'mr-2 border border-white/10 bg-zinc-900'}`}>
          <p className="mb-2 text-xs font-bold uppercase text-emerald-300">{m.role==='user'?'Tú':'FUT AI'}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{m.content}</p>
          {m.warning&&<p className="mt-2 text-xs text-amber-300">{m.warning}</p>}
          {m.sources&&<details className="mt-3 break-all text-xs text-zinc-500"><summary>Fuentes FUT · {m.at?new Date(m.at).toLocaleString():''}</summary>{m.sources.map(s=><p key={s}>{s}</p>)}</details>}
        </article>)}
        {busy&&<p role="status" className="text-sm text-emerald-200">Consultando datos y preparando respuesta…</p>}<div ref={end}/>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3">{questions.map(q=><button key={q} disabled={busy} onClick={()=>{if(q===questions[0])setSelected('');setQuestion(q);}} className="rounded-full border border-white/10 px-3 py-2 text-left text-xs text-zinc-300 hover:border-emerald-400">{q}</button>)}</div>
      <form onSubmit={send} className="border-t border-white/10 p-4"><label htmlFor="chat-question" className="sr-only">Tu pregunta</label>
        <textarea id="chat-question" className={field} value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1800} rows={3} placeholder="¿Qué observas en los datos actuales?" disabled={busy} required/>
        <div className="mt-3 flex items-center justify-between gap-4"><p className="text-xs text-zinc-500">Tu pregunta y el contexto FUT se envían a OpenAI. Respuestas informativas, revisa las fuentes.</p>
          <button disabled={busy||!question.trim()} className="rounded-lg bg-emerald-400 px-5 py-2 font-bold text-zinc-950 disabled:opacity-50">Enviar</button></div>
        {error&&<p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
      </form>
    </section>
  </div>;
}
