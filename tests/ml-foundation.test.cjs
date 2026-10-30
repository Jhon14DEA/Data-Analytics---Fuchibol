const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {certifiedPoints,windowDelta,futureLabels,oddsAt,chronologicalSplit,buildDatasets,number}=require('../src/services/ml/foundation.ts');
const {SNAPSHOT_FIELDS,sealPointInTime}=require('../src/services/training/pointInTime.ts');
const at=minute=>new Date(Date.parse('2022-10-01T12:00:00Z')+minute*60000).toISOString();
function point(minute,extra={}){return {id:`s${minute}`,fixtureId:'f',minute,at:at(minute),observedAt:at(minute),period:'FIRST_HALF',
  features:{scoreHome:0,scoreAway:0,shotsHome:3,shotsAway:2,sotHome:1,sotAway:0,xgHome:null,xgAway:null,cornersHome:1,cornersAway:0,cardsHome:0,cardsAway:0},...extra};}
function fixture(overrides={}){return {id:'f',provider:'AllSportsApi',externalId:'123',homeTeamId:'h',awayTeamId:'a',leagueId:'l',seasonId:'season',kickoff:at(0),kickoffPrecision:'EXACT',status:'FINISHED',createdAt:at(-60),updatedAt:at(100),...overrides};}
function stats(period='FULL_TIME',home=2,away=1,time=110){return ['h','a'].map((teamId,i)=>({id:period+teamId,fixtureId:'f',teamId,provider:'AllSportsApi',period,goals:i?away:home,corners:i?3:5,yellowCards:i?1:2,redCards:0,receivedAt:at(time)}));}
function source(){return {fixtures:[fixture()],snapshots:[],marketSnapshots:[],periodStats:stats(),teamStats:[],odds:[],seasons:[],leagues:[],halftimeObservations:[]};}
const boundaries={validationStart:'2023-07-01T00:00:00Z',testStart:'2024-07-01T00:00:00Z'};
function sealed(minute=20){
  const row=Object.fromEntries(SNAPSHOT_FIELDS.FEATURE_POINT_IN_TIME.map(k=>[k,null]));
  Object.assign(row,{id:'sealed',matchId:'f',providerFixtureId:'123',liveSnapshotId:'s',capturedAt:at(minute),minute,marketType:'OVER_0_5',marketPeriod:'FIRST_HALF',homeScore:0,awayScore:0});
  row.dataQualityDetails={pointInTime:sealPointInTime(row,{observedAt:at(minute)})};return row;
}

test('NULL and explicit zero are different; NaN/empty/boolean rejected',()=>{
  for(const x of [null,undefined,'',' ',true,NaN,-1])assert.equal(number(x),null);
  assert.equal(number(0),0);assert.equal(number('0'),0);
});
test('legacy snapshots and unsealed market snapshots are quarantined',()=>{
  const s=source();s.snapshots=[{id:'legacy',fixtureId:'f',timestamp:at(20),createdAt:at(20),sourceHash:'old'}];
  s.marketSnapshots=[{id:'oldmarket',matchId:'f',capturedAt:at(20)}];
  const out=certifiedPoints(s);assert.equal(out.points.length,0);assert.equal(out.rejected.length,2);
});
test('verified market snapshot projects only known features; final scores excluded',()=>{
  const s=source();s.marketSnapshots=[{...sealed(),finalHomeScore:6,goalBeforeFt:true}];
  const out=certifiedPoints(s);assert.equal(out.points.length,1);
  assert.equal(out.points[0].features.scoreHome,0);assert.equal(out.points[0].features.xgHome,null);
  assert.equal(out.points[0].features.finalHomeScore,undefined);
});
test('tampered sealed features or later evidence are rejected',()=>{
  const s=source();s.marketSnapshots=[{...sealed(),homeScore:1}];assert.equal(certifiedPoints(s).points.length,0);
  const row=sealed();row.dataQualityDetails.pointInTime.periodAvailableAt=at(21);s.marketSnapshots=[row];assert.equal(certifiedPoints(s).points.length,0);
});
test('new LIVE list writer is recognized using original receipt; period not inferred',()=>{
  const s=source();s.snapshots=[{id:'new',fixtureId:'f',timestamp:at(20),createdAt:at(20),minute:20,homeScore:0,awayScore:0,
    sourceHash:createHash('sha256').update(`live-list:123:${at(20)}`).digest('hex')}];
  const out=certifiedPoints(s);assert.equal(out.points.length,1);assert.equal(out.points[0].period,null);
});
test('complete exact future window produces positive and confirmed zero labels',()=>{
  const points=Array.from({length:16},(_,i)=>point(10+i));points[10].features={...points[10].features,scoreHome:1};
  for(let i=11;i<16;i++)points[i].features={...points[i].features,scoreHome:1};
  const out=futureLabels(points[0],points,fixture(),[]);
  assert.equal(out.labels.goalNext5,0);assert.equal(out.labels.goalNext10,1);assert.equal(out.labels.goalNext15,1);
  assert.equal(out.labels.cornersNext10,0);assert.equal(out.labels.cardsNext15,0);assert.equal(out.labels.shotsOnTargetNext10,0);
});
test('missing future endpoint is NULL, not zero, even with a final result',()=>{
  const p=point(10);const out=futureLabels(p,[p,point(19)],fixture(),stats());
  assert.equal(out.labels.goalNext10,null);assert.equal(out.labels.cornersNext10,null);assert.equal(out.labels.goalsRemainingFT,3);
});
test('gaps, corrections, missing counters and unknown/crossed periods invalidate windows',()=>{
  const base=Array.from({length:6},(_,i)=>point(10+i));
  assert.equal(windowDelta(base[0],base[5],[base[0],base[5]],'score'),null);
  base[2].features={...base[2].features,cornersHome:null};assert.equal(windowDelta(base[0],base[5],base,'corners'),null);
  base[2].features={...base[2].features,scoreHome:1};assert.equal(windowDelta(base[0],base[5],base,'score'),null);
  base[0].period=null;assert.equal(windowDelta(base[0],base[5],base,'sot'),null);
});
test('added time and halftime are not inferred from minute 45',()=>{
  const points=Array.from({length:6},(_,i)=>point(40+i));assert.equal(windowDelta(points[0],points[5],points,'score'),null);
  const s=source();s.marketSnapshots=[sealed(45)];assert.equal(buildDatasets(s,boundaries).datasets.halftime_second_half_goal_dataset.length,0);
});
test('HT and FT future goals use distinct confirmed periods and side-specific monotonic scores',()=>{
  const p=point(20);p.features={...p.features,scoreHome:1};
  const out=futureLabels(p,[p],fixture(),[...stats('FIRST_HALF',1,0,50),...stats()]);
  assert.equal(out.labels.goalsRemaining1H,0);assert.equal(out.labels.goalsRemainingFT,2);assert.equal(out.labels.twoPlusGoalsRemainingFT,1);
  p.features.scoreHome=3;assert.equal(futureLabels(p,[p],fixture(),stats()).labels.goalsRemainingFT,null);
});
test('missing future period results and unknown current scores stay NULL',()=>{
  const p=point(20);p.features.scoreHome=null;const out=futureLabels(p,[p],fixture(),stats());
  assert.equal(out.labels.goalsRemainingFT,null);assert.equal(out.labels.goalsRemaining1H,null);
});
test('odds require both quote and receipt before cutoff; archived closing odds cannot leak',()=>{
  const base={id:'o',price:2,market:'GOALS',selection:'OVER',bookmakerId:'b',quotedAt:at(10),receivedAt:at(11)};
  assert.equal(oddsAt([{...base,quotedAt:null}],at(20)),null);
  assert.equal(oddsAt([{...base,receivedAt:at(21)}],at(20)),null);
  assert.equal(oddsAt([{...base,quotedAt:at(12)}],at(20)),null);
  assert.equal(oddsAt([base],at(20))[0].price,2);
  assert.equal(oddsAt([{...base,line:-0.5}],at(20))[0].line,-0.5);
});
test('chronological partitions are fixed and boundaries belong to the next partition',()=>{
  assert.equal(chronologicalSplit('2022-08-01',boundaries),'train');
  assert.equal(chronologicalSplit(boundaries.validationStart,boundaries),'validation');
  assert.equal(chronologicalSplit(boundaries.testStart,boundaries),'test');
  assert.throws(()=>chronologicalSplit('bad',boundaries));
});
test('late imported historical fixtures produce outcome candidates, never certified prematch rows',()=>{
  const s=source();s.fixtures[0].createdAt=at(200);const b=buildDatasets(s,boundaries);
  assert.equal(b.datasets.prematch_goal_dataset.length,0);assert.equal(b.candidates[0].prematch_goal_dataset,3);
});
test('prematch features exclude target result and future updates in historical profiles',()=>{
  const s=source();const b=buildDatasets(s,boundaries),row=b.datasets.prematch_goal_dataset[0];
  assert.equal(row.labels.goalsFT,3);assert.equal(row.features.goalsFT,undefined);
  assert.equal(row.features.historical.home[5].sampleSize,0);assert.equal(row.features.historical.home[5].features.avgGoalsFor,null);
});
test('training labels resolved after validation boundary are not usable',()=>{
  const s=source();s.periodStats=s.periodStats.map(r=>({...r,receivedAt:'2025-01-01T00:00:00Z'}));
  const row=buildDatasets(s,boundaries).datasets.prematch_goal_dataset[0];
  assert.equal(row.labels.goalsFT,3);assert.equal(row.trainingEligible,false);assert.deepEqual(row.usableLabels,[]);
});
test('a purported final result received before prediction is not a future label',()=>{
  const s=source();s.periodStats=s.periodStats.map(r=>({...r,receivedAt:at(-10)}));
  assert.equal(buildDatasets(s,boundaries).datasets.prematch_goal_dataset[0].labels.goalsFT,null);
});
test('FT totals on a non-terminal fixture cannot settle remaining goals',()=>{
  assert.equal(futureLabels(point(20),[],fixture({status:'LIVE'}),stats()).labels.goalsRemainingFT,null);
});
test('observed halftime predicts 1+/2+/3+ second-half goals without FT features',()=>{
  const s=source();s.halftimeObservations=[{id:'ht',fixtureId:'f',period:'HALFTIME',availableAt:at(48),capturedAt:at(48),homeScore:1,awayScore:0,provenance:'OBSERVED_HALFTIME_STATE_V1'}];
  const row=buildDatasets(s,boundaries).datasets.halftime_second_half_goal_dataset[0];
  assert.deepEqual(row.labels,{onePlusGoals2H:1,twoPlusGoals2H:1,threePlusGoals2H:0});assert.equal(row.features.scoreHome,1);assert.equal(row.features.goalsFT,undefined);
});
test('delayed HT observation is rejected rather than backdated',()=>{
  const s=source();s.halftimeObservations=[{id:'ht',fixtureId:'f',period:'HALFTIME',availableAt:at(50),capturedAt:at(48),homeScore:1,awayScore:0,provenance:'OBSERVED_HALFTIME_STATE_V1'}];
  assert.equal(buildDatasets(s,boundaries).datasets.halftime_second_half_goal_dataset.length,0);
});
test('build is deterministic and every row of one fixture stays in a single split',()=>{
  const s=source();s.marketSnapshots=[sealed(20),{...sealed(21),id:'other'}];
  const a=buildDatasets(s,boundaries);assert.deepEqual(a,buildDatasets(s,boundaries));
  assert.equal(new Set(Object.values(a.datasets).flat().map(r=>r.split)).size,1);
});
