import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { allSportsObservation, knownNumber, trainingReceipt, type AllSportsTrainingRaw } from '../training/observation';
import { windowDelta, type Point } from './foundation';

type Row = Record<string, any>;
type Db = Pick<PrismaClient,'fixture'|'mlShadowSnapshot'|'mlShadowOutcome'>;
const protocol='OPERATIONAL_POINT_IN_TIME';
function hash(value: unknown): string {return createHash('sha256').update(JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');}
const time=(v:unknown)=>new Date(v as string).getTime();
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export function shadowIssue(row:Row):string|null {
  if(row.dataQuality?.version!=='ML_SHADOW_V1'||row.dataQuality?.temporalPolicy!==protocol||!row.dataQuality?.scoreConfirmed
    ||!row.stats?.home||!row.stats?.away)return 'UNVERIFIED_SHADOW_VERSION';
  if(!Number.isFinite(time(row.receivedAt))||!Number.isFinite(time(row.capturedAt))||time(row.receivedAt)>time(row.capturedAt))return 'EVIDENCE_AFTER_CAPTURE';
  const fields=['fixtureId','provider','providerFixtureId','receivedAt','capturedAt','minute','period','homeScore','awayScore','stats','recent','dataQuality'];
  return hash(Object.fromEntries(fields.map(k=>[k,row[k]])))===row.sourceHash?null:'FEATURE_PAYLOAD_CHANGED';
}

export function shadowPoint(row:Row):Point {
  const f:Row={scoreHome:row.homeScore,scoreAway:row.awayScore};
  for(const [side,key]of [['home','Home'],['away','Away']]) {
    const s=row.stats[side];for(const metric of ['shots','sot','xg','bigChances','shotsInsideBox','corners']) f[metric+key]=s[metric]??null;
    f['cards'+key]=s.yellowCards==null||s.redCards==null?null:s.yellowCards+s.redCards;
  }
  return {id:row.id??row.sourceHash??'new',fixtureId:row.fixtureId,at:new Date(row.capturedAt).toISOString(),observedAt:new Date(row.receivedAt).toISOString(),minute:row.minute,
    period:['FIRST_HALF','SECOND_HALF'].includes(row.period)&&row.dataQuality?.periodEvidence?.confidence==='CONFIRMED'?row.period:null,features:f,provenance:'ML_SHADOW_V1'};
}

export function buildShadow(raw:AllSportsTrainingRaw,fixtureId:string,previous:Row[],now=new Date()) {
  const receipt=trainingReceipt(raw);if(!receipt)return null;
  const age=now.getTime()-Date.parse(receipt);if(!Number.isFinite(age)||age<0||age>180000)return null;
  const o=allSportsObservation(raw,receipt);
  if(!o.score || o.period==='FINISHED' || (raw.event_live!=='1'&&!['FIRST_HALF','HALFTIME','SECOND_HALF'].includes(o.period)))return null;
  const read=(side:'home'|'away',names:string[],integer=true)=>{
    const value=raw.statistics?.find(s=>names.includes((s.type??'').trim().toLowerCase()))?.[side];
    return knownNumber(typeof value==='string'?value.replace(/%$/,'').trim():value,integer);
  };
  const side=(s:'home'|'away')=>({...o.stats[s],shotsOffTarget:read(s,['shots off goal','shots off target']),
    yellowCards:read(s,['yellow cards']),possession:read(s,['ball possession','possession'],false),attacks:read(s,['attacks']),fouls:read(s,['fouls','fouls committed'])});
  const stats={home:side('home'),away:side('away'),availableProviderStatistics:(raw.statistics??[]).map(s=>({
    type:(s.type??'').slice(0,100),home:typeof s.home==='string'?s.home.slice(0,100):typeof s.home==='number'?s.home:null,
    away:typeof s.away==='string'?s.away.slice(0,100):typeof s.away==='number'?s.away:null}))};
  const base={fixtureId,provider:'AllSportsApi',providerFixtureId:String(raw.event_key),receivedAt:new Date(receipt),capturedAt:new Date(receipt),
    minute:o.minute,period:o.period,homeScore:o.score.home,awayScore:o.score.away,stats};
  const current=shadowPoint({...base,dataQuality:{periodEvidence:o.periodEvidence}}),past=previous.filter(p=>!shadowIssue(p)&&time(p.receivedAt)<Date.parse(receipt)&&time(p.capturedAt)<=Date.parse(receipt));
  const points=[...past.map(shadowPoint),current].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const recent=Object.fromEntries([5,10,15].map(n=>{
    const prior=[...points].reverse().find(p=>p.minute!==null&&current.minute!==null&&p.minute===current.minute-n&&Date.parse(p.at)<Date.parse(current.at));
    return [`recent${n}`,prior?Object.fromEntries(['score','shots','sot','xg','bigChances','shotsInsideBox','corners','cards'].map(k=>[k,windowDelta(prior,current,points,k)])):null];
  }));
  const values=Object.entries(stats.home).concat(Object.entries(stats.away));
  const dataQuality={version:'ML_SHADOW_V1',temporalPolicy:protocol,periodEvidence:o.periodEvidence??null,elapsedStoppageTime:o.elapsedStoppageTime,
    stoppageTime:o.stoppageTime,receiptAgeAtPersistenceMs:age,statisticsCoverage:values.filter(([,v])=>v!==null).length/values.length,
    missingHome:Object.entries(stats.home).filter(([,v])=>v===null).map(([k])=>k),missingAway:Object.entries(stats.away).filter(([,v])=>v===null).map(([k])=>k),
    shortWindowPeriodConfirmed:current.period!==null,scoreConfirmed:true};
  return {...base,stats:json(stats),recent:json(recent),dataQuality:json(dataQuality),sourceHash:hash({...base,recent,dataQuality})};
}

export function shadowOutcomes(rows:Row[],raw:AllSportsTrainingRaw) {
  const receipt=trainingReceipt(raw);if(!receipt)return [];
  const o=allSportsObservation(raw,receipt),points=rows.filter(r=>!shadowIssue(r)&&time(r.capturedAt)<=Date.parse(receipt)).map(shadowPoint).sort((a,b)=>time(a.at)-time(b.at));
  const outcomes:Row[]=[];
  for(const start of points) {
    if(time(start.at)>=Date.parse(receipt))continue;
    const add=(label:string,value:number,evidence:unknown,resolvedAt=receipt)=>outcomes.push({snapshotId:start.id,label,value,resolvedAt:new Date(resolvedAt),evidence:json(evidence)});
    for(const [metric,horizons,prefix]of [['score',[5,10,15],'goalNext'],['corners',[5,10,15],'cornersNext'],['cards',[10,15],'cardsNext'],['sot',[10],'shotsOnTargetNext']] as const)for(const n of horizons) {
      const end=points.find(p=>p.minute!==null&&start.minute!==null&&p.minute===start.minute+n&&time(p.at)>time(start.at));
      const delta=end?windowDelta(start,end,points,metric):null;
      if(delta!==null)add(prefix+n,metric==='score'?Number(delta>0):delta,{kind:'EXACT_OBSERVED_WINDOW',endSnapshotId:end!.id},end!.at);
    }
    const regularFt=['ft','finished','full time','fulltime','ended'].includes((raw.event_status??'').trim().toLowerCase())?o.fullTimeScore:null;
    for(const [label,score]of [['goalsRemaining1H',start.period==='FIRST_HALF'?o.halfTimeScore:null],['goalsRemainingFT',regularFt]] as const) {
      if(score&&score.home>=start.features.scoreHome&&score.away>=start.features.scoreAway) {
        const value=score.home+score.away-start.features.scoreHome-start.features.scoreAway;
        add(label,value,{kind:'CONFIRMED_PROVIDER_RESULT',provider:'AllSportsApi',receivedAt:receipt,period:o.period,score});
        if(label==='goalsRemainingFT')add('twoPlusGoalsRemainingFT',Number(value>=2),{kind:'CONFIRMED_PROVIDER_RESULT',receivedAt:receipt,score});
      }
    }
  }
  return outcomes;
}

/** Best-effort isolated sidecar. Missing migration/DB errors never trigger a provider fallback. */
export async function collectAllSportsShadow(rawRows:AllSportsTrainingRaw[],db:Db,now=new Date()) {
  if(process.env.ML_SHADOW_ENABLED==='false')return {captured:0,labels:0,failed:0};
  let captured=0,labels=0;
  try {
    const fresh=rawRows.filter(r=>{const t=trainingReceipt(r);return t&&now.getTime()-Date.parse(t)>=0&&now.getTime()-Date.parse(t)<=180000;});
    if(!fresh.length)return {captured,labels,failed:0};
    const fixtures=await db.fixture.findMany({where:{provider:'AllSportsApi',externalId:{in:fresh.map(r=>String(r.event_key))}},select:{id:true,externalId:true,status:true}});
    for(const f of fixtures) {
      const raw=fresh.find(r=>String(r.event_key)===f.externalId)!;
      // Existing request only; at most 1000 points per fixture. No history backfill.
      const previous=await db.mlShadowSnapshot.findMany({where:{fixtureId:f.id},orderBy:[{capturedAt:'desc'},{id:'desc'}],take:1000});
      if(['LIVE','HALFTIME'].includes(f.status)) {
        const row=buildShadow(raw,f.id,previous,now);
        if(row) {
          const saved=await db.mlShadowSnapshot.createMany({data:row,skipDuplicates:true});captured+=saved.count;
          if(saved.count){const current=await db.mlShadowSnapshot.findUniqueOrThrow({where:{fixtureId_provider_receivedAt:{fixtureId:f.id,provider:'AllSportsApi',receivedAt:row.receivedAt}}});previous.push(current);}
        }
      }
      const outcomes=shadowOutcomes(previous,raw);
      if(outcomes.length) {
        // One batch, not a write per label. Persist first sufficient resolution;
        // revisions require separate reconciliation, never mutation of features.
        const saved=await db.mlShadowOutcome.createMany({data:outcomes as Prisma.MlShadowOutcomeCreateManyInput[],skipDuplicates:true});labels+=saved.count;
      }
    }
    return {captured,labels,failed:0};
  }catch{console.warn('[ml-shadow] Capture unavailable; operational response retained.');return {captured,labels,failed:1};}
}
