const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../../src/lib/prisma.ts');
const { allSportsObservation } = require('../../src/services/training/observation.ts');
const { persistLiveMarketSnapshot, resolveFirstHalfSnapshotOutcomes, resolveFinalSnapshotOutcomes, trainingSummary } = require('../../src/services/training/liveMarketSnapshots.ts');

after(()=>prisma.$disconnect());
const {pointInTimeFeatures,pointInTimeIssue}=require('../../src/services/training/pointInTime.ts');
// All synthetic records live in a rolled-back transaction, including failed tests.
async function rolledBack(run) {
  const marker = new Error('EXPECTED_TEST_ROLLBACK');
  try { await prisma.$transaction(async tx => { await run(tx); throw marker; }, {timeout:30000}); }
  catch(error) { if(error !== marker) throw error; }
}
async function setup(tx, externalId = '111') {
  const tag = 'training-test-'+randomUUID();
  const league=await tx.league.create({data:{provider:tag,externalId:'league',name:tag}});
  const home=await tx.team.create({data:{provider:tag,externalId:'home',name:'Test home'}});
  const away=await tx.team.create({data:{provider:tag,externalId:'away',name:'Test away'}});
  const fixture=await tx.fixture.create({data:{provider:tag,externalId,leagueId:league.id,homeTeamId:home.id,awayTeamId:away.id,kickoff:new Date(),status:'LIVE'}});
  const live=await tx.liveSnapshot.create({data:{fixtureId:fixture.id,minute:17,homeScore:0,awayScore:0,sourceHash:tag}});
  const at=new Date(Date.now()-60000);
  const observation=allSportsObservation({event_key:externalId,event_status:'1H 17',event_final_result:'0 - 0',statistics:[{type:'Shots On Target',home:'0',away:'1'}]},at.toISOString());
  return {fixture,live,observation,at};
}
function outcome(source, patch) {return {...source,observedAt:new Date().toISOString(),...patch};}

test('PIT features survive later HT and FT resolution byte-for-byte in PostgreSQL',async()=>rolledBack(async tx=>{
 const {fixture,live,observation}=await setup(tx);
 const row=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx),features=pointInTimeFeatures(row);
 assert.ok(features);
 const ht=outcome(observation,{period:'HALFTIME',halfTimeScore:{home:1,away:0},fullTimeScore:{home:3,away:0}});
 assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,ht,tx),1);
 assert.equal(await resolveFinalSnapshotOutcomes(fixture.id,ht,tx),0,'HT cannot resolve FT even with a populated fulltime score');
 let got=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
 assert.equal(got.goalBeforeHt,true);assert.equal(got.goalBeforeFt,null);assert.deepEqual(pointInTimeFeatures(got),features);
 assert.equal(await resolveFinalSnapshotOutcomes(fixture.id,outcome(observation,{period:'FINISHED',fullTimeScore:{home:3,away:0}}),tx),1);
 got=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
 assert.equal(got.goalBeforeFt,true);assert.deepEqual(pointInTimeFeatures(got),features);assert.deepEqual(got.dataQualityDetails,row.dataQualityDetails);
}));

test('outcomes with future receipt or before the logical market end cannot resolve labels',async()=>rolledBack(async tx=>{
 const {fixture,live,observation}=await setup(tx);await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
 const early=outcome(observation,{period:'FIRST_HALF',halfTimeScore:{home:1,away:0},fullTimeScore:{home:2,away:0}});
 assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,early,tx),0);assert.equal(await resolveFinalSnapshotOutcomes(fixture.id,early,tx),0);
 const future={...early,period:'FINISHED',observedAt:new Date(Date.now()+60000).toISOString()};
 assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,future,tx),0);assert.equal(await resolveFinalSnapshotOutcomes(fixture.id,future,tx),0);
}));

test('out-of-band historical feature updates are excluded by the persisted integrity seal',async()=>rolledBack(async tx=>{
 const {fixture,live,observation}=await setup(tx);const row=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
 // Deliberate corruption only inside this rolled-back synthetic test transaction.
 const corrupted=await tx.liveMarketSnapshot.update({where:{id:row.id},data:{homeSot:900}});
 assert.equal(pointInTimeIssue(corrupted),'FEATURE_PAYLOAD_CHANGED');assert.equal(pointInTimeFeatures(corrupted),null);
}));

test('PostgreSQL persists NULL/zero, deduplicates and retains a changed same-minute sample', async()=>rolledBack(async tx=>{
  const {fixture,live,observation}=await setup(tx);
  const a=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  const b=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  assert.equal(a.id,b.id);assert.equal(a.homeXg,null);assert.equal(a.totalXg,null);assert.equal(a.homeSot,0);
  assert.equal(a.sotLast15,null);assert.equal(a.coveragePercent,0);
  const changed=structuredClone(observation);changed.stats.home.sot=1;
  const c=await persistLiveMarketSnapshot(fixture.id,live.id,changed,tx);
  assert.notEqual(a.id,c.id);
  assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:fixture.id}}),2);
}));

test('17m/20m 0-0 -> goal 24 -> HT resolves BOTH forward labels, FT finalizes', async()=>rolledBack(async tx=>{
  const {fixture,live,observation}=await setup(tx);
  const a=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  const b=await persistLiveMarketSnapshot(fixture.id,live.id,{...observation,minute:20,observedAt:new Date(Date.now()-30000).toISOString()},tx);
  const goal=outcome(observation,{minute:24,score:{home:1,away:0}});
  assert.equal(await persistLiveMarketSnapshot(fixture.id,live.id,goal,tx),null);
  assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,goal,tx),0);
  const ht=outcome(observation,{period:'HALFTIME',halfTimeScore:{home:1,away:0}});
  assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,ht,tx),2);
  assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,ht,tx),0);
  let rows=await tx.liveMarketSnapshot.findMany({where:{id:{in:[a.id,b.id]}}});
  assert.ok(rows.every(r=>r.goalBeforeHt===true&&r.goalBeforeFt===null&&r.resultResolvedAt===null));
  const ft=outcome(ht,{period:'FINISHED',fullTimeScore:{home:2,away:1}});
  assert.equal(await resolveFinalSnapshotOutcomes(fixture.id,ft,tx),2);
  rows=await tx.liveMarketSnapshot.findMany({where:{matchId:fixture.id}});
  assert.ok(rows.every(r=>r.goalBeforeFt===true&&r.finalHomeScore===2&&r.finalAwayScore===1&&r.resultResolvedAt));
  assert.equal(await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx),null);
}));

test('35m 0-0 -> HT 0-0 -> FT 1-0 gives HT=false, FT=true; other fixtures untouched', async()=>rolledBack(async tx=>{
  const a=await setup(tx,'222'),b=await setup(tx,'333');
  const rowA=await persistLiveMarketSnapshot(a.fixture.id,a.live.id,{...a.observation,minute:35},tx);
  const rowB=await persistLiveMarketSnapshot(b.fixture.id,b.live.id,b.observation,tx);
  const ht=outcome(a.observation,{period:'HALFTIME',halfTimeScore:{home:0,away:0}});
  assert.equal(await resolveFirstHalfSnapshotOutcomes(b.fixture.id,ht,tx),0);
  await resolveFirstHalfSnapshotOutcomes(a.fixture.id,ht,tx);
  await resolveFinalSnapshotOutcomes(a.fixture.id,outcome(ht,{period:'FINISHED',fullTimeScore:{home:1,away:0}}),tx);
  const gotA=await tx.liveMarketSnapshot.findUnique({where:{id:rowA.id}}),gotB=await tx.liveMarketSnapshot.findUnique({where:{id:rowB.id}});
  assert.equal(gotA.goalBeforeHt,false);assert.equal(gotA.goalBeforeFt,true);
  assert.equal(gotB.goalBeforeHt,null);assert.equal(gotB.goalBeforeFt,null);
  await assert.rejects(()=>persistLiveMarketSnapshot(a.fixture.id,b.live.id,a.observation,tx),/mismatch/);
}));

test('FT without confirmed HT resolves only FT; later HT fills missing label without guessing', async()=>rolledBack(async tx=>{
  const {fixture,live,observation}=await setup(tx);
  const row=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  const ft=outcome(observation,{period:'FINISHED',fullTimeScore:{home:0,away:1},halfTimeScore:null});
  await resolveFirstHalfSnapshotOutcomes(fixture.id,ft,tx);
  await resolveFinalSnapshotOutcomes(fixture.id,ft,tx);
  let got=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
  assert.equal(got.goalBeforeHt,null);assert.equal(got.goalBeforeFt,true);assert.equal(got.resultResolvedAt,null);
  await resolveFirstHalfSnapshotOutcomes(fixture.id,{...ft,halfTimeScore:{home:0,away:0}},tx);
  got=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
  assert.equal(got.goalBeforeHt,false);assert.ok(got.resultResolvedAt);
}));

test('stale outcome predating capture cannot label the snapshot; summary ignores null averages', async()=>rolledBack(async tx=>{
  const {fixture,live,observation}=await setup(tx);
  await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  assert.equal(await resolveFirstHalfSnapshotOutcomes(fixture.id,{...observation,observedAt:new Date(Date.now()-120000).toISOString(),period:'HALFTIME',halfTimeScore:{home:1,away:0}},tx),0);
  const summary=await trainingSummary({limit:100},tx);
  assert.equal(summary.totalSnapshots,summary.resolvedSnapshots+summary.unresolvedSnapshots);
  assert.equal(summary.resolvedSnapshots,summary.positives+summary.negatives);
  assert.ok(summary.snapshots.some(r=>r.matchId===fixture.id&&r.totalXg===null));
}));

test('database enforces FIRST_HALF-only market candidates', async()=>rolledBack(async tx=>{
  const {fixture,live,observation}=await setup(tx);
  const row=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  await assert.rejects(()=>tx.liveMarketSnapshot.update({where:{id:row.id},data:{marketPeriod:'FULL_TIME'}}));
}));

test('existing observation hook captures confirmed LIVE and skips demo/unknown/goaled/second half',async()=>rolledBack(async tx=>{
  const {observeLiveMarketDataset}=require('../../src/services/training/liveMarketSnapshots.ts');
  const {fixture,live,observation}=await setup(tx);
  const match={status:'LIVE',demo:false,trainingObservation:observation};
  for (const patch of [{demo:true},{trainingObservation:{...observation,score:null}},
    {trainingObservation:{...observation,score:{home:1,away:0}}},{trainingObservation:{...observation,period:'SECOND_HALF'}}]) {
    await observeLiveMarketDataset({...match,...patch},fixture,live.id,tx);
    assert.equal(await tx.liveMarketSnapshot.count({where:{matchId:fixture.id}}),0);
  }
  await observeLiveMarketDataset(match,fixture,live.id,tx);
  await observeLiveMarketDataset(match,fixture,live.id,tx);
  const rows=await tx.liveMarketSnapshot.findMany({where:{matchId:fixture.id}});
  assert.equal(rows.length,1);
  for(const field of ['totalXg','totalBigChances','totalShotsInsideBox','totalDangerousAttacks','marketOdds','homeOver05FirstHalfRate','sotLast5','sotLast10','sotLast15']) assert.equal(rows[0][field],null);
  assert.deepEqual(rows[0].dataQualityDetails.windows.map(w=>[w.size,w.coverage]),[[5,0],[10,0],[15,0]]);
}));

test('existing listings retry missing HT after FT, and cannot overwrite resolved outcomes',async()=>rolledBack(async tx=>{
  const {resolveObservedMarketResults}=require('../../src/services/training/liveMarketSnapshots.ts');
  const {fixture,live,observation}=await setup(tx);
  const row=await persistLiveMarketSnapshot(fixture.id,live.id,observation,tx);
  const ft=outcome(observation,{period:'FINISHED',fullTimeScore:{home:2,away:1},halfTimeScore:null});
  await resolveObservedMarketResults(fixture.provider,[ft],tx);
  const partial=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
  assert.equal(partial.goalBeforeHt,null);assert.equal(partial.goalBeforeFt,true);assert.ok(partial.ftResolvedAt);assert.equal(partial.resultResolvedAt,null);
  await resolveObservedMarketResults(fixture.provider,[{...ft,halfTimeScore:{home:0,away:0}}],tx);
  const settled=await tx.liveMarketSnapshot.findUnique({where:{id:row.id}});
  assert.equal(settled.goalBeforeHt,false);assert.ok(settled.resultResolvedAt);
  await resolveObservedMarketResults(fixture.provider,[{...ft,halfTimeScore:{home:1,away:0},fullTimeScore:{home:4,away:3}}],tx);
  assert.deepEqual(await tx.liveMarketSnapshot.findUnique({where:{id:row.id}}),settled);
  const summary=await trainingSummary({},tx);
  assert.equal(summary.totalSnapshots,summary.resolvedHt+summary.unresolvedHt);
  assert.equal(summary.totalSnapshots,summary.resolvedFt+summary.unresolvedFt);
  assert.equal(summary.featureCoverage.SOT.availableCount,1);
  assert.equal(summary.featureCoverage.xG.availableCount,0);
  assert.equal(summary.minuteBuckets['16-20'],1);
  assert.equal(summary.lastFtResolved.toISOString(),partial.ftResolvedAt.toISOString());
}));

test('full persistMatchDetail -> saveLiveSnapshot -> dataset hook persists linked confirmed API fixture',async()=>rolledBack(async tx=>{
  const prismaModule=require('../../src/lib/prisma.ts');
  const {apiFootballObservation}=require('../../src/services/training/observation.ts');
  const {persistMatchDetail}=require('../../src/services/persistence/footballPersistence.ts');
  const id=Date.now(), tag='flow-test-'+randomUUID();
  const raw={fixture:{id,status:{short:'1H',elapsed:17}},teams:{home:{id:id+1},away:{id:id+2}},goals:{home:0,away:0}};
  const trainingObservation=apiFootballObservation(raw,new Date().toISOString());
  const stats=Object.fromEntries(['possession','shots','shotsOnTarget','xg','corners','yellowCards','redCards','fouls','dangerousAttacks'].map(k=>[k,null]));
  const match={id:String(id),source:'api-football',demo:false,providerStatus:'API-Football',homeTeam:tag+' home',awayTeam:tag+' away',competition:tag,
    homeTeamExternalId:String(id+1),awayTeamExternalId:String(id+2),leagueExternalId:tag,status:'LIVE',minute:17,score:{home:0,away:0},
    kickoffAt:new Date(Date.now()-17*60000).toISOString(),stats:{home:stats,away:stats},lineups:{home:[],away:[]},events:[],substitutions:[],playerStats:[],odds:[],oddsHistory:[],analysis:[],alerts:[],trainingObservation};
  const original=prismaModule.prisma;
  try {
    prismaModule.prisma=tx;
    const fixture=await persistMatchDetail(match);
    const rows=await tx.liveMarketSnapshot.findMany({where:{matchId:fixture.id},include:{liveSnapshot:true}});
    assert.equal(rows.length,1);assert.equal(rows[0].liveSnapshot.fixtureId,fixture.id);
    assert.equal(rows[0].homeScore,0);assert.equal(rows[0].marketPeriod,'FIRST_HALF');assert.equal(rows[0].totalXg,null);
  } finally {prismaModule.prisma=original;}
}));
