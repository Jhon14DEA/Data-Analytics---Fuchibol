const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.startsWith('/fut_historical_test_'))throw Error('ISOLATED_HISTORICAL_TEST_DATABASE_REQUIRED');
const db=new PrismaClient();after(()=>db.$disconnect());
const {batch}=require('./fixtures.cjs');
const {runHistoricalBatch}=require('../../src/services/historical/worker.ts');
const {persistMapping,resolveMapping}=require('../../src/services/historical/mapping.ts');
const {buildSnapshotFeatures}=require('../../src/services/training/features.ts');
const {apiFootballObservation}=require('../../src/services/training/observation.ts');
const {pointInTimeFeatures}=require('../../src/services/training/pointInTime.ts');
const write=(b,options={})=>runHistoricalBatch(db,b,{dryRun:false,...options});
const fixtureFor=b=>db.fixture.findUnique({where:{provider_externalId:{provider:b.provider,externalId:b.fixtures[0].id}}});
const stateFor=b=>db.historicalIngestionState.findFirst({where:{season:{key:b.season.key}}});

test('historical persistence reuses entities, stores period stats, events, players and generic outcomes',async()=>{
 const b=batch(),result=await write(b);assert.equal(result.inserted,1);const f=await fixtureFor(b);
 assert.equal(f.season,null);assert.ok(f.seasonId);assert.equal((await db.season.findUnique({where:{id:f.seasonId}})).label,'2026/27');
 assert.equal((await db.league.findUnique({where:{id:f.leagueId}})).classification,'MEN_SENIOR');
 const ht=await db.teamPeriodStats.findFirst({where:{fixtureId:f.id,teamId:f.homeTeamId,period:'FIRST_HALF'}}),ft=await db.teamPeriodStats.findFirst({where:{fixtureId:f.id,teamId:f.homeTeamId,period:'FULL_TIME'}});
 assert.equal(ht.goals,0);assert.equal(ht.shotsOnTarget,null);assert.equal(ft.shotsOnTarget,4);assert.equal(ft.xg,null);
 assert.equal(await db.teamMatchStats.count({where:{fixtureId:f.id}}),2);assert.equal(await db.matchEvent.count({where:{fixtureId:f.id}}),1);
 assert.equal(await db.lineup.count({where:{fixtureId:f.id}}),1);assert.equal(await db.playerMatchStats.count({where:{fixtureId:f.id}}),1);
 const outcomes=await db.historicalMarketOutcome.findMany({where:{fixtureId:f.id}});assert.equal(outcomes.length,8);assert.equal(outcomes.find(x=>x.period==='FIRST_HALF'&&Number(x.line)===0.5).status,'LOSS');
});
test('repeated fixtures and completed page replay never duplicate facts or counters',async()=>{
 const b=batch();b.fixtures.push(structuredClone(b.fixtures[0]));assert.equal((await write(b)).inserted,1);assert.equal((await write(b)).state,'ALREADY_DONE');
 const s=await stateFor(b),f=await fixtureFor(b);assert.equal(s.fixturesInserted,1);assert.equal(s.fixturesFound,2);assert.equal(await db.matchEvent.count({where:{fixtureId:f.id}}),1);
});
test('failed page rolls back fixtures; retry and a new Prisma client preserve checkpoint and counters',async()=>{
 const b=batch();b.nextCursor='page2';await write(b);const s=await stateFor(b);
 const next={...b,cursor:'page2',nextCursor:null};
 await assert.rejects(()=>write(next,{beforeFixture(){throw Error('TEST_FAILURE')}}),/TEST_FAILURE/);
 const failed=await stateFor(b);assert.equal(failed.cursor,'page2');assert.equal(failed.retryCount,1);assert.equal(failed.fixturesInserted,1);assert.equal(failed.lastError,'TEST_FAILURE');assert.equal(failed.lastSuccessAt.getTime(),s.lastSuccessAt.getTime());
 const restarted=new PrismaClient();try{assert.equal((await runHistoricalBatch(restarted,next,{dryRun:false})).updated,1);}finally{await restarted.$disconnect();}
 assert.equal((await stateFor(b)).status,'SUCCEEDED');assert.equal((await stateFor(b)).retryCount,1);
});
test('a mid-page failure does not leave partial fixtures or advance progress',async()=>{
 const b=batch(),other=structuredClone(b.fixtures[0]);other.id+='second';b.fixtures.push(other);
 await assert.rejects(()=>write(b,{beforeFixture(index){if(index===1)throw Error('MID_PAGE_FAILURE')}}),/MID_PAGE_FAILURE/);
 assert.equal(await fixtureFor(b),null);assert.equal((await stateFor(b)).cursor,null);assert.equal((await stateFor(b)).fixturesInserted,0);
 assert.equal((await write(b)).inserted,2);
});
test('concurrent independent clients do not consume the same page twice',async()=>{
 const b=batch(),other=new PrismaClient();try{
  const results=await Promise.all([write(b),runHistoricalBatch(other,b,{dryRun:false})]);assert.equal(results.filter(x=>x.inserted===1).length,1);
  assert.equal((await stateFor(b)).fixturesInserted,1);
 }finally{await other.$disconnect();}
});
test('live fixture identities are never closed or rewritten by historical ingestion',async()=>{
 const b=batch();await write(b);const f=await fixtureFor(b),s=await stateFor(b);
 await db.fixture.update({where:{id:f.id},data:{status:'LIVE',homeScore:0,awayScore:0}});
 await db.historicalIngestionState.update({where:{id:s.id},data:{status:'READY',cursor:'replay'}});
 const before=await fixtureFor(b);assert.equal((await write({...b,cursor:'replay'})).rejected,1);assert.deepEqual(await fixtureFor(b),before);
});
test('historical final facts cannot change an existing sealed LiveMarketSnapshot or its labels',async()=>{
 const b=batch();b.nextCursor='page2';await write(b);const f=await fixtureFor(b);
 const live=await db.liveSnapshot.create({data:{fixtureId:f.id,minute:17,homeScore:0,awayScore:0,sourceHash:'historical-pit-'+f.id}});
 const o=apiFootballObservation({fixture:{id:777,status:{short:'1H',elapsed:17}},teams:{home:{id:1},away:{id:2}},goals:{home:0,away:0}},new Date().toISOString());
 o.providerFixtureId='777';const features=buildSnapshotFeatures(f.id,o,[]);
 const row=await db.liveMarketSnapshot.create({data:{...features,liveSnapshotId:live.id}});assert.ok(pointInTimeFeatures(row));
 await write({...b,cursor:'page2',nextCursor:null});assert.deepEqual(await db.liveMarketSnapshot.findUnique({where:{id:row.id}}),row);
});
test('odds require safe clocks, explicit period and correct line; replay stays idempotent',async()=>{
 const b=batch(),q={bookmaker:'Historical test',market:'Goals 1H',selection:'Over 0.5',price:1.8,quotedAt:b.rangeFrom,receivedAt:b.receivedAt};
 b.fixtures[0].odds=[q,{...q,quotedAt:new Date(Date.now()+60000).toISOString()},{...q,market:'1x2 (1st Half)',selection:'1'}];b.nextCursor='next';await write(b);const f=await fixtureFor(b);
 await write({...b,cursor:'next',nextCursor:null});const quotes=await db.oddsSnapshot.findMany({where:{fixtureId:f.id}});assert.equal(quotes.length,1);assert.equal(Number(quotes[0].line),0.5);assert.equal(quotes[0].marketPeriod,'FIRST_HALF');assert.ok(quotes[0].receivedAt);
});
test('unknown final scores and non-men batches cannot enter the historical fixtures',async()=>{
 const b=batch();b.fixtures[0].periods.find(p=>p.period==='FULL_TIME').home.goals=null;assert.equal((await write(b)).rejected,1);assert.equal(await fixtureFor(b),null);
 const women=batch();women.competition.gender='female';await assert.rejects(()=>write(women),/NOT_MEN_SENIOR/);assert.equal(await stateFor(women),null);
});
test('persisted competition/team/fixture mappings are unique and do not accept a second target',async()=>{
 const tag=batch().season.key;
 for(const kind of ['COMPETITION','TEAM','FIXTURE']) {
  const a={provider:'AllSportsApi',id:tag+kind,name:'Exact',country:'England',competitionKey:'premier-league',home:'Home',away:'Away',kickoff:'2026-01-01T12:00:00Z'},b={...a,provider:'API-Football',id:tag+kind+'api'};
  await persistMapping(db,kind,a,b,'EXACT_IDENTITY');await persistMapping(db,kind,a,b,'EXACT_IDENTITY');
  assert.equal((await resolveMapping(db,kind,a,'API-Football',[b,{...b,id:'ambiguous'}])).id,b.id);
  await assert.rejects(()=>persistMapping(db,kind,a,{...b,id:'second'},'EXACT_IDENTITY'),/AMBIGUOUS/);
 }
});
test('expired leases resume after restart while an active lease stays exclusive',async()=>{
 const b=batch();b.nextCursor='next';await write(b);const s=await stateFor(b),next={...b,cursor:'next',nextCursor:null};
 await db.historicalIngestionState.update({where:{id:s.id},data:{status:'RUNNING',leaseToken:'dead-process',leaseUntil:new Date(Date.now()+60000)}});
 assert.equal((await write(next)).state,'BUSY');
 await db.historicalIngestionState.update({where:{id:s.id},data:{leaseUntil:new Date(Date.now()-1)}});assert.equal((await write(next)).state,'SUCCEEDED');
});
test('stale cursors and overlapping range advances fail without resetting progress',async()=>{
 const b=batch();b.nextCursor='next';await write(b);assert.equal((await write({...b,cursor:'wrong',nextCursor:null})).state,'STALE_CURSOR');
 await assert.rejects(()=>write({...b,rangeFrom:new Date(Date.parse(b.rangeFrom)-86400000).toISOString(),cursor:null}),/UNSAFE_RANGE_ADVANCE/);
 assert.equal((await stateFor(b)).cursor,'next');
});
test('a completed range advances incrementally and retains cumulative counters',async()=>{
 const b=batch(),previous=structuredClone(b);const earlier=s=>new Date(Date.parse(s)-86400000).toISOString();
 previous.rangeFrom=earlier(b.rangeFrom);previous.rangeTo=earlier(b.rangeTo);previous.fixtures[0].kickoff=earlier(b.fixtures[0].kickoff);previous.fixtures[0].id+='previous';
 await write(previous);assert.equal((await write(b)).inserted,1);const state=await stateFor(b);
 assert.equal(state.rangeFrom.toISOString(),b.rangeFrom);assert.equal(state.fixturesInserted,2);assert.equal(state.fixturesFound,2);assert.equal(state.status,'SUCCEEDED');
});
