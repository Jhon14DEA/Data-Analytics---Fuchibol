const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {prisma}=require('../../src/lib/prisma.ts');
const {sample}=require('./hybrid-fixtures.cjs');
const {rememberTrainingReceipt}=require('../../src/services/training/observation.ts');
const {observeLiveMarketDataset,resolveObservedMarketResults}=require('../../src/services/training/liveMarketSnapshots.ts');
const {runHybridBatch}=require('../../src/services/training/hybrid/processor.ts');
const {reserveApiRequest,reconcileApiBudget}=require('../../src/services/training/hybrid/budget.ts');
const {ApiFootballProvider}=require('../../src/providers/football/apiFootball.ts');
const {simulateHybridTraffic}=require('../../src/services/training/hybrid/simulation.ts');
const day=()=>new Date().toISOString().slice(0,10);
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw new Error('REAL_NETWORK_FORBIDDEN_IN_TEST');};
after(async()=>{globalThis.fetch=originalFetch;await prisma.$disconnect();});
async function rolledBack(run){
 const envNames=['HYBRID_DATASET_PROCESSOR_ENABLED','HYBRID_DATASET_SESSION_ID','MAX_REAL_API_REQUESTS_SESSION'];
 const saved=envNames.map(k=>[k,process.env[k]]);
 process.env.HYBRID_DATASET_PROCESSOR_ENABLED='true';process.env.HYBRID_DATASET_SESSION_ID='test-'+randomUUID();process.env.MAX_REAL_API_REQUESTS_SESSION='10';
 const marker=new Error('ROLLBACK_HYBRID_TEST');
 const oldEnabled=process.env.API_FOOTBALL_HYBRID_ENABLED,oldBudget=process.env.API_FOOTBALL_DAILY_BUDGET;
 process.env.API_FOOTBALL_HYBRID_ENABLED='true';process.env.API_FOOTBALL_DAILY_BUDGET='80';
 try{await prisma.$transaction(async tx=>{
  // These temporary budget values are rolled back. Never delete application data.
  assert.equal(await tx.hybridScout.count(),0,'Run hybrid DB tests with an empty scout queue; never clear real scouts');
  await tx.apiFootballBudget.upsert({where:{day:day()},create:{day:day()},update:{used:0,automaticUsed:0,validationUsed:0,remoteLimit:100}});
  await run(tx);throw marker;
 },{timeout:30000});}catch(e){if(e!==marker)throw e;}
 finally{for(const [k,v]of [...saved,['API_FOOTBALL_HYBRID_ENABLED',oldEnabled],['API_FOOTBALL_DAILY_BUDGET',oldBudget]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
async function setup(tx,id=String(Date.now())){
 const s=sample(new Date(Date.now()-1000),id),tag='hybrid-test-'+randomUUID();
 const league=await tx.league.create({data:{provider:tag,externalId:tag,name:s.identity.league}});
 const home=await tx.team.create({data:{provider:tag,externalId:'home',name:s.identity.home}});
 const away=await tx.team.create({data:{provider:tag,externalId:'away',name:s.identity.away}});
 const fixture=await tx.fixture.create({data:{provider:'AllSportsApi',externalId:id,leagueId:league.id,homeTeamId:home.id,awayTeamId:away.id,kickoff:new Date(s.identity.kickoff),status:'LIVE'}});
 const live=await tx.liveSnapshot.create({data:{fixtureId:fixture.id,minute:17,homeScore:0,awayScore:0,sourceHash:tag}});
 await observeLiveMarketDataset(s.match,fixture,live.id,tx);
 return {...s,fixture,live};
}
function fakeApi(raws){let requests=0;return {get requests(){return requests;},fetch:async(params,budget)=>{
 if(!await budget.reserve())throw Error('BUDGET_BLOCKED');requests++;
 const rows=structuredClone(raws.filter(x=>!params.id||String(x.fixture.id)===params.id));rememberTrainingReceipt(rows);return rows;
}};}
const options={authorized:true,projectedDailyRequests:40};
async function nextObservation(tx,s,minute=18) {
 const observation={...s.observation,minute,observedAt:new Date().toISOString()};
 await observeLiveMarketDataset({...s.match,trainingObservation:observation},s.fixture,s.live.id,tx);
 return observation;
}

test('real DB hook: unknown AllSports stays pending; 1H cert produces linked hybrid snapshot',async()=>rolledBack(async tx=>{
 const s=await setup(tx);assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),0);
 const scout=await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}});assert.equal(scout.phase,'PENDING_PERIOD_CONFIRMATION');
 const api=fakeApi([s.raw]);const result=await runHybridBatch(options,tx,api.fetch);assert.equal(result.requests,1);
 assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),0,'Later certificate must not backdate a capture');
 await nextObservation(tx,s);
 const row=await tx.liveMarketSnapshot.findFirst({where:{matchId:s.fixture.id}});
 assert.ok(row);assert.equal(row.liveSnapshotId,s.live.id);assert.equal(row.providerFixtureId,s.identity.providerFixtureId);
 assert.equal(row.periodProvider,'API_FOOTBALL');assert.equal(row.statsProvider,'ALLSPORTS');assert.equal(row.totalXg,null);assert.equal(row.homeSot,0);assert.equal(row.marketOdds,null);
 assert.equal((await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}})).apiFootballFixtureId,String(s.raw.fixture.id));
}));
test('next AllSports snapshot within TTL and restarted batch use durable cache with zero requests',async()=>rolledBack(async tx=>{
 const s=await setup(tx),api=fakeApi([s.raw]);await runHybridBatch(options,tx,api.fetch);
 await observeLiveMarketDataset({...s.match,trainingObservation:{...s.observation,observedAt:new Date().toISOString(),minute:18}},s.fixture,s.live.id,tx);
 const restarted=fakeApi([s.raw]);assert.equal((await runHybridBatch(options,tx,restarted.fetch)).requests,0);assert.equal(restarted.requests,0);
 assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),1);
}));
test('expired TTL cannot capture; elapsed cooldown permits exactly one new validation',async()=>rolledBack(async tx=>{
 const s=await setup(tx),api=fakeApi([s.raw]);await runHybridBatch(options,tx,api.fetch);
 await nextObservation(tx,s);
 const row=await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}});
 const c={...row.certificate,expiresAt:new Date(Date.now()-1).toISOString()};
 await tx.hybridScout.update({where:{matchId:s.fixture.id},data:{certificate:c}});
 const fresh={...s.match,trainingObservation:{...s.observation,minute:18,observedAt:new Date().toISOString()}};
 await observeLiveMarketDataset(fresh,s.fixture,s.live.id,tx);
 assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),1);
 const blocked=fakeApi([s.raw]);await runHybridBatch(options,tx,blocked.fetch);assert.equal(blocked.requests,0);
 await tx.hybridScout.update({where:{matchId:s.fixture.id},data:{nextValidationAt:new Date(Date.now()-1)}});
 await runHybridBatch(options,tx,blocked.fetch);assert.equal(blocked.requests,1);
}));
test('HT from existing listing invalidates persisted certificate and resolves without API',async()=>rolledBack(async tx=>{
 const s=await setup(tx);await runHybridBatch(options,tx,fakeApi([s.raw]).fetch);
 await nextObservation(tx,s);
 const ht={...s.observation,period:'HALFTIME',minute:45,score:{home:1,away:0},halfTimeScore:{home:1,away:0},observedAt:new Date().toISOString()};
 await resolveObservedMarketResults('AllSportsApi',[ht],tx);
 const row=await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}});assert.equal(row.invalidated,true);assert.equal(row.certificate,null);
 const noApi=fakeApi([]);await runHybridBatch(options,tx,noApi.fetch);assert.equal(noApi.requests,0);
 assert.equal((await tx.liveMarketSnapshot.findFirst({where:{matchId:s.fixture.id}})).goalBeforeHt,true);
 // A stale 1H replay cannot reopen the fixture.
 await observeLiveMarketDataset(s.match,s.fixture,s.live.id,tx);assert.equal((await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}})).invalidated,true);
}));
test('missing HT and FT use one minimal request each; FT never supplies an absent HT score',async()=>rolledBack(async tx=>{
 const s=await setup(tx);await runHybridBatch(options,tx,fakeApi([s.raw]).fetch);
 await nextObservation(tx,s);
 await resolveObservedMarketResults('AllSportsApi',[{...s.observation,period:'HALFTIME',minute:45,halfTimeScore:null,observedAt:new Date().toISOString()}],tx);
 const ht=fakeApi([{...s.raw,fixture:{...s.raw.fixture,status:{short:'HT',elapsed:45}},goals:{home:1,away:0},score:{halftime:{home:1,away:0},fulltime:{home:null,away:null}}}]);
 await runHybridBatch(options,tx,ht.fetch);await runHybridBatch(options,tx,ht.fetch);assert.equal(ht.requests,1);
 await resolveObservedMarketResults('AllSportsApi',[{...s.observation,period:'FINISHED',minute:90,fullTimeScore:null,observedAt:new Date().toISOString()}],tx);
 const ft=fakeApi([{...s.raw,fixture:{...s.raw.fixture,status:{short:'FT',elapsed:90}},score:{halftime:{home:null,away:null},fulltime:{home:2,away:0}}}]);
 await runHybridBatch(options,tx,ft.fetch);await runHybridBatch(options,tx,ft.fetch);assert.equal(ft.requests,1);
 const row=await tx.liveMarketSnapshot.findFirst({where:{matchId:s.fixture.id}});assert.equal(row.goalBeforeHt,true);assert.equal(row.goalBeforeFt,true);assert.equal(row.finalHomeScore,2);
}));
test('ambiguous API fixtures never create mapping or snapshot',async()=>rolledBack(async tx=>{
 const s=await setup(tx),other={...s.raw,fixture:{...s.raw.fixture,id:s.raw.fixture.id+1}};
 const api=fakeApi([s.raw,other]);await runHybridBatch(options,tx,api.fetch);
 assert.equal(api.requests,1);assert.equal((await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}})).apiFootballFixtureId,null);
 assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),0);
}));
test('ambiguous local scouts spend zero requests',async()=>rolledBack(async tx=>{
 const a=await setup(tx,'91001'),b=await setup(tx,'91002');
 await tx.hybridScout.update({where:{matchId:b.fixture.id},data:{identity:{...a.identity,providerFixtureId:b.identity.providerFixtureId}}});
 const api=fakeApi([a.raw]);await runHybridBatch(options,tx,api.fetch);assert.equal(api.requests,0);
}));

test('maximum validations is persistent; an expired certificate cannot exceed four attempts',async()=>rolledBack(async tx=>{
 const s=await setup(tx),api=fakeApi([s.raw]);
 await tx.hybridScout.update({where:{matchId:s.fixture.id},data:{validationCount:4,nextValidationAt:new Date(Date.now()-1)}});
 await runHybridBatch(options,tx,api.fetch);assert.equal(api.requests,0);assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:s.fixture.id}}),0);
}));

test('outcome budget denial preserves its one future attempt',async()=>rolledBack(async tx=>{
 const s=await setup(tx);await runHybridBatch(options,tx,fakeApi([s.raw]).fetch);
 await nextObservation(tx,s);
 await resolveObservedMarketResults('AllSportsApi',[{...s.observation,period:'HALFTIME',minute:45,halfTimeScore:null,observedAt:new Date().toISOString()}],tx);
 await tx.apiFootballBudget.update({where:{day:day()},data:{used:80,automaticUsed:80}});
 const blocked=fakeApi([]);await runHybridBatch(options,tx,blocked.fetch);assert.equal(blocked.requests,0);
 assert.equal((await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}})).htAttemptedAt,null);
}));

test('ten durable admissions limit new fixtures and higher coverage wins the last slot',async()=>rolledBack(async tx=>{
 const a=await setup(tx,'93001'),b=await setup(tx,'93002');
 await tx.hybridApiCache.create({data:{key:'admissions:'+day(),payload:Array.from({length:9},(_,i)=>'reserved-test-'+i)}});
 await tx.hybridScout.update({where:{matchId:b.fixture.id},data:{priority:9999}});
 const api=fakeApi([a.raw,b.raw]);await runHybridBatch(options,tx,api.fetch);
 assert.equal((await tx.hybridScout.findUnique({where:{matchId:b.fixture.id}})).apiFootballFixtureId,String(b.raw.fixture.id));
 assert.equal((await tx.hybridScout.findUnique({where:{matchId:a.fixture.id}})).validationCount,0);
 assert.equal(api.requests,1);
}));

test('stale in-memory hybrid evidence is rejected after persisted invalidation',async()=>rolledBack(async tx=>{
 const {persistLiveMarketSnapshot}=require('../../src/services/training/liveMarketSnapshots.ts');
 const {hybridObservation}=require('../../src/services/training/hybrid/policy.ts');
 const s=await setup(tx);await runHybridBatch(options,tx,fakeApi([s.raw]).fetch);
 const scout=await tx.hybridScout.findUnique({where:{matchId:s.fixture.id}});
 const merged=hybridObservation(s.identity,{...s.observation,observedAt:new Date().toISOString()},scout.certificate,true);assert.ok(merged);
 await tx.hybridScout.update({where:{matchId:s.fixture.id},data:{invalidated:true}});
 assert.equal(await persistLiveMarketSnapshot(s.fixture.id,s.live.id,merged,tx),null);
}));

test('API FT with no explicit halftime score resolves only FT, never fabricates HT',async()=>rolledBack(async tx=>{
 const s=await setup(tx);await runHybridBatch(options,tx,fakeApi([s.raw]).fetch);
 await nextObservation(tx,s);
 await resolveObservedMarketResults('AllSportsApi',[{...s.observation,period:'FINISHED',minute:90,halfTimeScore:null,fullTimeScore:null,observedAt:new Date().toISOString()}],tx);
 const api=fakeApi([{...s.raw,fixture:{...s.raw.fixture,status:{short:'FT',elapsed:90}},goals:{home:2,away:0},score:{halftime:{home:null,away:null},fulltime:{home:2,away:0}}}]);
 await runHybridBatch(options,tx,api.fetch);assert.equal(api.requests,1);
 const row=await tx.liveMarketSnapshot.findFirst({where:{matchId:s.fixture.id}});assert.equal(row.goalBeforeHt,null);assert.equal(row.goalBeforeFt,true);assert.equal(row.finalHomeScore,2);assert.equal(row.finalAwayScore,0);
}));
test('budget exhaustion and protected reserve persist in PostgreSQL and block before HTTP',async()=>rolledBack(async tx=>{
 await tx.apiFootballBudget.update({where:{day:day()},data:{used:60,automaticUsed:60,validationUsed:60}});
 assert.equal(await reserveApiRequest('VALIDATION',tx),false);assert.equal(await reserveApiRequest('OUTCOME',tx),true);
 await tx.apiFootballBudget.update({where:{day:day()},data:{used:80,automaticUsed:80}});
 assert.equal(await reserveApiRequest('OUTCOME',tx),false);
 const s=await setup(tx),api=fakeApi([s.raw]);await runHybridBatch(options,tx,api.fetch);assert.equal(api.requests,0);
 assert.equal((await tx.apiFootballBudget.findUnique({where:{day:day()}})).used,80);
}));
test('remote quota can only tighten usage; missing headers never become zero',async()=>rolledBack(async tx=>{
 await reserveApiRequest('VALIDATION',tx);await reconcileApiBudget(new Headers(),tx);assert.equal((await tx.apiFootballBudget.findUnique({where:{day:day()}})).used,1);
 await reconcileApiBudget(new Headers({'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'5'}),tx);
 await reconcileApiBudget(new Headers({'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'99'}),tx);
 assert.equal((await tx.apiFootballBudget.findUnique({where:{day:day()}})).used,95);assert.equal(await reserveApiRequest('VALIDATION',tx),false);
}));
test('fixture B does not borrow fixture A certificate or outcomes',async()=>rolledBack(async tx=>{
 const a=await setup(tx,'92001'),b=await setup(tx,'92002');
 await runHybridBatch(options,tx,fakeApi([a.raw]).fetch);
 await nextObservation(tx,a);
 assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:b.fixture.id}}),0);
 await resolveObservedMarketResults('API-Football',[{...b.certificate.observation,period:'FINISHED',halfTimeScore:{home:1,away:0},fullTimeScore:{home:2,away:0},observedAt:new Date().toISOString()}],tx);
 assert.equal((await tx.liveMarketSnapshot.findFirst({where:{matchId:a.fixture.id}})).goalBeforeFt,null);
}));
test('hybrid client uses only /fixtures, counts cache misses and never retries failed HTTP',async()=>{
 const oldKey=process.env.API_FOOTBALL_KEY,oldFetch=globalThis.fetch;process.env.API_FOOTBALL_KEY='test-only';let count=0,reserved=0;
 globalThis.fetch=async url=>{assert.equal(new URL(url).pathname,'/fixtures');count++;return new Response(JSON.stringify({response:[],errors:[]}),{status:200});};
 try{const provider=new ApiFootballProvider(),budget={reserve:async()=>{reserved++;return true;},reconcile:async()=>{}};
  await provider.getPeriodFixtures({id:'99999901'},budget);await provider.getPeriodFixtures({id:'99999901'},budget);assert.equal(count,1);assert.equal(reserved,1);
  globalThis.fetch=async()=>{count++;return new Response('{}',{status:500});};
  await assert.rejects(()=>provider.getPeriodFixtures({id:'99999902'},budget));assert.equal(count,2);assert.equal(reserved,2);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.API_FOOTBALL_KEY;else process.env.API_FOOTBALL_KEY=oldKey;}
});
test('concurrent workers and a new Prisma client cannot reset the persisted reservation',async()=>{
 const oldSession=process.env.HYBRID_DATASET_SESSION_ID;process.env.HYBRID_DATASET_SESSION_ID='test-'+randomUUID();
 const key=require('../../src/services/training/hybrid/activation.ts').sessionKey();
 // Dedicated non-current UTC day; real concurrent connections, always cleaned up.
 const at=new Date('2091-01-02T12:00:00Z'),testDay=at.toISOString().slice(0,10),other=new PrismaClient();let created=false;
 try{await prisma.apiFootballBudget.create({data:{day:testDay,used:59,automaticUsed:59,validationUsed:59}});created=true;
  const results=await Promise.all([reserveApiRequest('VALIDATION',prisma,at),reserveApiRequest('VALIDATION',other,at)]);
  assert.equal(results.filter(Boolean).length,1);assert.equal((await other.apiFootballBudget.findUnique({where:{day:testDay}})).used,60);
 }finally{if(created)await prisma.apiFootballBudget.deleteMany({where:{day:testDay}});await prisma.hybridApiCache.deleteMany({where:{key:{in:[key,`telemetry:HYBRID_API_SKIPPED_BUDGET:${testDay}:VALIDATION`]}}});if(oldSession===undefined)delete process.env.HYBRID_DATASET_SESSION_ID;else process.env.HYBRID_DATASET_SESSION_ID=oldSession;await other.$disconnect();}
});

test('session cap includes outcomes, survives another day, and denial consumes no daily budget',async()=>rolledBack(async tx=>{
 const {sessionKey}=require('../../src/services/training/hybrid/activation.ts');
 for(let i=0;i<9;i++)assert.equal(await reserveApiRequest('VALIDATION',tx),true);
 assert.equal(await reserveApiRequest('OUTCOME',tx),true);
 assert.equal(await reserveApiRequest('VALIDATION',tx),false);
 assert.equal(await reserveApiRequest('OUTCOME',tx,new Date('2092-01-01T12:00:00Z')),false);
 assert.equal((await tx.hybridApiCache.findUnique({where:{key:sessionKey()}})).payload.requests,10);
 assert.equal((await tx.apiFootballBudget.findUnique({where:{day:day()}})).automaticUsed,10);
 assert.equal(await tx.apiFootballBudget.findUnique({where:{day:'2092-01-01'}}),null);
}));

test('concurrent workers share last session slot and reconnection cannot reset it',async()=>{
 const old=process.env.HYBRID_DATASET_SESSION_ID;process.env.HYBRID_DATASET_SESSION_ID='test-'+randomUUID();
 const {sessionKey}=require('../../src/services/training/hybrid/activation.ts'),key=sessionKey();
 const at=new Date('2093-01-01T12:00:00Z'),d='2093-01-01',other=new PrismaClient();let created=false;
 try{
  await prisma.apiFootballBudget.create({data:{day:d}});created=true;
  await prisma.hybridApiCache.create({data:{key,payload:{requests:9,validations:9,outcomes:0,lastRequest:null}}});
  const result=await Promise.all([reserveApiRequest('VALIDATION',prisma,at),reserveApiRequest('OUTCOME',other,at)]);
  assert.equal(result.filter(Boolean).length,1);await other.$disconnect();
  assert.equal(await reserveApiRequest('OUTCOME',other,at),false);
  assert.equal((await other.hybridApiCache.findUnique({where:{key}})).payload.requests,10);
  assert.equal((await other.apiFootballBudget.findUnique({where:{day:d}})).automaticUsed,1);
 }finally{
  if(created)await prisma.apiFootballBudget.deleteMany({where:{day:d}});
  await prisma.hybridApiCache.deleteMany({where:{key:{in:[key,`telemetry:HYBRID_API_SKIPPED_BUDGET:${key}`]}}});await other.$disconnect();
  if(old===undefined)delete process.env.HYBRID_DATASET_SESSION_ID;else process.env.HYBRID_DATASET_SESSION_ID=old;
 }
});
