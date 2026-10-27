import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { HISTORICAL_SCOPE, type ScopeBinding } from './scope';
import { validateBatch, fixtureIssue } from './validation';
import { hash, persistHistoricalFixture } from './persistence';
import type { HistoricalBatch } from './types';
import { historicalErrorText } from './errors';
type Options = {dryRun?:boolean;bindings?:readonly ScopeBinding[];beforeFixture?:(index:number)=>void};
export function previewBatch(b:HistoricalBatch,bindings=HISTORICAL_SCOPE) {
  const scope=validateBatch(b,bindings),seen=new Map<string,string>(),issues:Record<string,string>={};
  for(const f of b.fixtures){const issue=fixtureIssue(f,b);if(issue)issues[f.id??'missing']=issue;const previous=seen.get(f.id);if(previous&&previous!==hash(f))throw Error('CONFLICTING_DUPLICATE_FIXTURE');seen.set(f.id,hash(f));}
  return{mode:'DRY_RUN',competition:scope.binding.key,classification:scope.classification,fixturesFound:b.fixtures.length,uniqueFixtures:seen.size,accepted:seen.size-Object.keys(issues).length,rejected:issues,requests:0};
}
// One bounded page per invocation. No timers, provider HTTP, LIVE imports, or implicit retries.
export async function runHistoricalBatch(db:PrismaClient,b:HistoricalBatch,options:Options={}) {
  const preview=previewBatch(b,options.bindings??HISTORICAL_SCOPE);
  if(options.dryRun!==false)return preview;
  if(b.synthetic)throw Error('MOCK_WRITE_FORBIDDEN');
  const {classification}=validateBatch(b,options.bindings??HISTORICAL_SCOPE),now=new Date(),token=randomUUID();
  const key=hash([b.provider,b.competition.id,b.season.key]),batchKey=hash(b.provider==='FOOTBALL_DATA'?{...b,receivedAt:null}:b);
  const claim=await db.$transaction(async tx=>{
    const lock=await tx.$queryRaw<{ok:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS ok`;
    if(!lock[0].ok)return {state:'BUSY' as const};
    const league=await tx.league.upsert({where:{provider_externalId:{provider:b.provider,externalId:b.competition.id}},create:{provider:b.provider,externalId:b.competition.id,name:b.competition.name,country:b.competition.country,classification:classification.classification,classificationSource:classification.source,classificationEvidence:JSON.parse(JSON.stringify(b.competition))},update:{country:b.competition.country,classification:classification.classification,classificationSource:classification.source,classificationEvidence:JSON.parse(JSON.stringify(b.competition))}});
    const season=await tx.season.upsert({where:{leagueId_key:{leagueId:league.id,key:b.season.key}},create:{leagueId:league.id,key:b.season.key,label:b.season.label,providerSeasonId:b.season.providerSeasonId,startsAt:b.season.startsAt?new Date(b.season.startsAt):null,endsAt:b.season.endsAt?new Date(b.season.endsAt):null,receivedAt:new Date(b.receivedAt)},update:{}});
    const identity={provider:b.provider,leagueId:league.id,seasonId:season.id};
    let state=await tx.historicalIngestionState.findUnique({where:{provider_leagueId_seasonId:identity}});
    if(state?.leaseUntil&&state.leaseUntil>now)return {state:'BUSY' as const};
    if(state){
      const sameRange=state.rangeFrom.getTime()===Date.parse(b.rangeFrom)&&state.rangeTo.getTime()===Date.parse(b.rangeTo);
      if(sameRange&&state.status==='SUCCEEDED')return {state:'ALREADY_DONE' as const};
      if(sameRange&&state.cursor!==b.cursor)return {state:'STALE_CURSOR' as const};
      if(!sameRange&&(state.status!=='SUCCEEDED'||Date.parse(b.rangeFrom)<=state.rangeTo.getTime()||b.cursor!==null))throw Error('UNSAFE_RANGE_ADVANCE');
    }else if(b.cursor!==null)throw Error('INITIAL_CURSOR_REQUIRED');
    const data={rangeFrom:new Date(b.rangeFrom),rangeTo:new Date(b.rangeTo),cursor:b.cursor,status:'RUNNING' as const,lastRunAt:now,lastError:null,leaseToken:token,leaseUntil:new Date(now.getTime()+120000)};
    state=await tx.historicalIngestionState.upsert({where:{provider_leagueId_seasonId:identity},create:{...identity,...data},update:data});
    return {state:'CLAIMED' as const,id:state.id,leagueId:league.id,seasonId:season.id};
  });
  if(claim.state!=='CLAIMED')return{mode:'WRITE',state:claim.state,requests:0};
  try {
    return await db.$transaction(async tx=>{
      // Fence a replaced lease; commit the page and checkpoint together.
      await tx.$queryRaw`SELECT "id" FROM "HistoricalIngestionState" WHERE "id"=${claim.id} FOR UPDATE`;
      const state=await tx.historicalIngestionState.findUniqueOrThrow({where:{id:claim.id}});
      if(state.leaseToken!==token||!state.leaseUntil||state.leaseUntil<new Date())throw Error('LEASE_LOST');
      let inserted=0,updated=0,rejected=0,index=0;
      for(const f of new Map(b.fixtures.map(f=>[f.id,f])).values()) {
        options.beforeFixture?.(index++);
        if(fixtureIssue(f,b)){rejected++;continue;}
        const result=await persistHistoricalFixture(tx,b,f,claim.leagueId,claim.seasonId);
        if(result==='INSERTED')inserted++;else if(result==='UPDATED')updated++;else rejected++;
      }
      await tx.historicalIngestionState.update({where:{id:claim.id},data:{cursor:b.nextCursor,lastBatchKey:batchKey,lastSuccessAt:new Date(),lastError:null,status:b.nextCursor===null?'SUCCEEDED':'READY',leaseToken:null,leaseUntil:null,fixturesFound:{increment:b.fixtures.length},fixturesInserted:{increment:inserted},fixturesUpdated:{increment:updated},fixturesRejected:{increment:rejected}}});
      return{mode:'WRITE',state:b.nextCursor===null?'SUCCEEDED':'READY',inserted,updated,rejected,requests:0};
    },{timeout:30000});
  }catch(error){
    const diagnostic=historicalErrorText(error);
    try{await db.historicalIngestionState.updateMany({where:{id:claim.id,leaseToken:token},data:{status:'FAILED',lastError:diagnostic,retryCount:{increment:1},leaseToken:null,leaseUntil:null}});}catch{/* Keep the original exception if the database is unavailable. */}
    throw error;
  }
}

// Exported capability boundary for a later, separately authorized HTTP transport.
// A transport must return a normalized bounded page and preserve its receipt time.
export interface HistoricalPageSource { readPage(cursor:string|null):Promise<HistoricalBatch> }
