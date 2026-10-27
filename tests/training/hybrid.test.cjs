const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sample, scenario } = require('./hybrid-fixtures.cjs');
const { hybridObservation, matchFixture, isScout, canValidate, normalizeExact, priority } = require('../../src/services/training/hybrid/policy.ts');
const { candidateSkipReason, buildSnapshotFeatures } = require('../../src/services/training/features.ts');
const { simulateHybridTraffic } = require('../../src/services/training/hybrid/simulation.ts');
const { automaticBudget,validationBudget } = require('../../src/services/training/hybrid/budget.ts');
const { runHybridBatch } = require('../../src/services/training/hybrid/processor.ts');

test('AllSports numeric 17 is only a scout, never a confirmed candidate',()=>{
 const s=sample();assert.equal(s.observation.period,'UNKNOWN');assert.equal(isScout(s.observation,true),true);
 assert.equal(hybridObservation(s.identity,s.observation,null,true),null);assert.equal(candidateSkipReason(s.observation),'INVALID_PERIOD');
});
test('API 1H certifies period while preserving AllSports stats and provenance',()=>{
 const s=sample();const o=hybridObservation(s.identity,s.observation,s.certificate,true);
 assert.ok(o);assert.equal(candidateSkipReason(o),null);assert.equal(o.periodProvider,'API_FOOTBALL');assert.equal(o.statsProvider,'ALLSPORTS');
 assert.equal(o.stats.home.sot,0);assert.equal(o.stats.away.sot,1);
 const f=buildSnapshotFeatures('match',o,[]);assert.equal(f.periodProvider,'API_FOOTBALL');assert.equal(f.statsProvider,'ALLSPORTS');assert.equal(f.oddsProvider,null);
});
test('subsequent observation within TTL reuses confirmation without changing its receipt',()=>{
 const at=new Date(Date.now()-120000),s=sample(at),o={...s.observation,observedAt:new Date().toISOString(),minute:19};
 const merged=hybridObservation(s.identity,o,s.certificate,true);assert.ok(merged);assert.equal(merged.hybridEvidence.observedAt,at.toISOString());
});
test('expired confirmation never captures; validation also observes persistent cooldown and cap',()=>{
 const s=sample(new Date(Date.now()-600001));assert.equal(hybridObservation(s.identity,{...s.observation,observedAt:new Date().toISOString(),minute:27},s.certificate,true),null);
 assert.equal(canValidate(1,new Date(Date.now()+10000),new Date()),false);assert.equal(canValidate(1,new Date(Date.now()-1),new Date()),true);assert.equal(canValidate(4,null,new Date()),false);
});
test('HT, 2H, FT, score changes and non-live states cannot reuse FIRST_HALF',()=>{
 const s=sample();for(const period of ['HALFTIME','SECOND_HALF','FINISHED'])assert.equal(hybridObservation(s.identity,{...s.observation,period},s.certificate,true),null);
 assert.equal(hybridObservation(s.identity,{...s.observation,score:{home:1,away:0}},s.certificate,true),null);
 assert.equal(hybridObservation(s.identity,s.observation,s.certificate,false),null);
});
test('matching requires unique exact teams, orientation, league and nearby kickoff',()=>{
 const s=sample();assert.equal(matchFixture(s.identity,[s.raw]).fixture.id,s.raw.fixture.id);
 assert.equal(matchFixture(s.identity,[s.raw,{...s.raw,fixture:{...s.raw.fixture,id:999}}]),null);
 assert.equal(matchFixture({...s.identity,home:s.identity.away,away:s.identity.home},[s.raw]),null);
 assert.equal(matchFixture({...s.identity,league:'Other'},[s.raw]),null);
 assert.equal(matchFixture({...s.identity,kickoff:new Date(Date.parse(s.identity.kickoff)+360000).toISOString()},[s.raw]),null);
 assert.notEqual(normalizeExact('Team U21'),normalizeExact('Team'));assert.equal(normalizeExact('  TEAM   FC '),'team fc');
});
test('persisted mapping takes precedence but contradictory identities are rejected',()=>{
 const s=sample(),other={...s.raw,fixture:{...s.raw.fixture,id:999}};
 assert.equal(matchFixture(s.identity,[s.raw,other],String(s.raw.fixture.id)).fixture.id,s.raw.fixture.id);
 assert.equal(matchFixture({...s.identity,home:'Different'},[s.raw],String(s.raw.fixture.id)),null);
});
test('different fixture cannot consume another fixture certificate',()=>{
 const s=sample(),b=sample(new Date(),'702');assert.equal(hybridObservation(b.identity,b.observation,s.certificate,true),null);
 assert.equal(hybridObservation({...s.identity,home:'Wrong'},s.observation,s.certificate,true),null);
});
test('N/D stays NULL, zero is retained, no FT odds substitute',()=>{
 const s=sample();const f=buildSnapshotFeatures('match',hybridObservation(s.identity,s.observation,s.certificate,true),[]);
 assert.equal(f.totalXg,null);assert.equal(f.totalBigChances,null);assert.equal(f.totalSot,1);assert.equal(f.homeSot,0);assert.equal(f.marketOdds,null);
});
test('unknown score, stale observation, clock regression/jump and expired identities fail closed',()=>{
 const s=sample();for(const patch of [{score:null},{minute:3},{minute:40},{minute:45},{observedAt:new Date(Date.now()-300000).toISOString()}])assert.equal(hybridObservation(s.identity,{...s.observation,...patch},s.certificate,true),null);
});
test('better AllSports coverage is prioritized independently from betting scores',()=>{
 const s=sample();assert.ok(priority(s.observation)>priority({...s.observation,stats:{home:Object.fromEntries(Object.keys(s.observation.stats.home).map(k=>[k,null])),away:Object.fromEntries(Object.keys(s.observation.stats.away).map(k=>[k,null]))}}));
});
test('automatic ceiling and outcome reserve cannot be bypassed with configuration',()=>{
 const original=process.env.API_FOOTBALL_DAILY_BUDGET;
 try{for(const [value,cap,validation] of [['1000',80,60],['40',40,20],['0',0,0],['garbage',0,0]]){process.env.API_FOOTBALL_DAILY_BUDGET=value;assert.equal(automaticBudget(),cap);assert.equal(validationBudget(),validation);}}
 finally{if(original===undefined)delete process.env.API_FOOTBALL_DAILY_BUDGET;else process.env.API_FOOTBALL_DAILY_BUDGET=original;}
});
test('disabled worker performs zero database access and zero requests even with authorization argument',async()=>{
 const flag=process.env.HYBRID_DATASET_PROCESSOR_ENABLED;process.env.HYBRID_DATASET_PROCESSOR_ENABLED='false';
 const old=process.env.API_FOOTBALL_HYBRID_ENABLED;delete process.env.API_FOOTBALL_HYBRID_ENABLED;
 try{assert.deepEqual(await runHybridBatch({authorized:true,projectedDailyRequests:40},new Proxy({},{get(){throw Error('DB accessed');}}),async()=>{throw Error('HTTP called');}),{state:'DISABLED',requests:0});}
 finally{if(old!==undefined)process.env.API_FOOTBALL_HYBRID_ENABLED=old;if(flag===undefined)delete process.env.HYBRID_DATASET_PROCESSOR_ENABLED;else process.env.HYBRID_DATASET_PROCESSOR_ENABLED=flag;}
});

test('radar schedules after response, does not await provider, and contains processor failures',async()=>{
 const {scheduleHybridBatch}=require('../../src/services/training/hybrid/trigger.ts');
 const old=process.env.HYBRID_DATASET_PROCESSOR_ENABLED;let task,calls=0;
 try{
  process.env.HYBRID_DATASET_PROCESSOR_ENABLED='false';scheduleHybridBatch(()=>{throw Error('must not schedule');});
  process.env.HYBRID_DATASET_PROCESSOR_ENABLED='true';
  assert.equal(scheduleHybridBatch(cb=>{task=cb;},async()=>{calls++;throw Error('provider unavailable');}),undefined);
  assert.equal(calls,0);await assert.doesNotReject(task);assert.equal(calls,1);
  assert.doesNotThrow(()=>scheduleHybridBatch(()=>{throw Error('response context unavailable');}));
 }finally{if(old===undefined)delete process.env.HYBRID_DATASET_PROCESSOR_ENABLED;else process.env.HYBRID_DATASET_PROCESSOR_ENABLED=old;}
});
test('simulation never activates and flags demand above 80 independently from budget truncation',()=>{
 const low=simulateHybridTraffic(scenario(10));assert.equal(low.uniqueFixtures,10);assert.ok(low.cacheHits>0);assert.equal(low.projectedWithoutBudget,50);
 const high=simulateHybridTraffic(scenario(40));assert.equal(high.projectedWithoutBudget,200);assert.equal(high.estimatedDailyRequests,50);assert.equal(high.deferredFixtures,30);
 assert.equal(simulateHybridTraffic([]).activationAllowedByProjection,false);
});

test('10-minute TTL matches revalidation; late evidence ends before minute 43',()=>{
 const {HYBRID_POLICY:P,certificateExpiresAt}=require('../../src/services/training/hybrid/policy.ts');
 assert.equal(P.confirmationTtlMs,P.validationCooldownMs);assert.equal(P.maxValidationsPerFixture,4);
 const at=new Date(Date.now()-9*60000),s=sample(at),now=new Date();
 const o={...s.observation,observedAt:now.toISOString(),minute:26};assert.ok(hybridObservation(s.identity,o,s.certificate,true,now));
 assert.equal(hybridObservation(s.identity,{...o,minute:17},s.certificate,true,now),null,'Frozen clock cannot extend a first-half certificate');
 assert.equal(Date.parse(certificateExpiresAt(at.toISOString(),39))-at.getTime(),4*60000);
});

test('PostgreSQL key ordering cannot change a hybrid snapshot hash',()=>{
 const {snapshotSourceHash}=require('../../src/services/training/features.ts');
 const s=sample(),o=hybridObservation(s.identity,s.observation,s.certificate,true);
 const reordered=JSON.parse(JSON.stringify(o,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 assert.equal(snapshotSourceHash(o),snapshotSourceHash(reordered));
});
