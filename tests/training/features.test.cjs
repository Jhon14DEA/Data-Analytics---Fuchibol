const { test } = require('node:test');
const assert = require('node:assert/strict');
const { alignedApiFootballObservation, allSportsObservation, apiFootballObservation, knownNumber, selectFirstHalfOdds, trainingReceipt, rememberTrainingReceipt } = require('../../src/services/training/observation.ts');
const { calculateRecentWindowMetrics, forwardGoalLabel, isFirstHalfCandidate, buildSnapshotFeatures, snapshotSourceHash, minutesRemainingMarket } = require('../../src/services/training/features.ts');
const { parseTrainingFilters } = require('../../src/services/training/liveMarketSnapshots.ts');

const now = new Date();
const {resolveMatchPeriodEvidence}=require('../../src/services/training/periodEvidence.ts');
function observation(status = '17', score = '0 - 0') {
  if (/^\d/.test(status) && parseInt(status,10) <= 45) status = `1H ${status}`;
  return allSportsObservation({ event_key: '123', event_status: status, event_final_result: score }, now.toISOString());
}
function point(minute, overrides = {}) {
  return { matchId: 'fixture-a', marketType: 'OVER_0_5', marketPeriod: 'FIRST_HALF', minute, elapsedStoppageTime: null,
    capturedAt: new Date(now.getTime() - (23 - minute) * 60000), homeSot: minute, awaySot: 0, homeXg: minute / 10, awayXg: 0,
    homeBigChances: 0, awayBigChances: 0, homeCorners: Math.floor(minute / 3), awayCorners: 0, ...overrides };
}

test('17m 0-0, goal at 24 and confirmed HT 1-0 => forward label true', () => {
  assert.equal(forwardGoalLabel({homeScore:0,awayScore:0}, {home:1,away:0}), true);
});
test('35m 0-0 and confirmed HT 0-0 => false, not missing', () => {
  assert.equal(forwardGoalLabel({homeScore:0,awayScore:0}, {home:0,away:0}), false);
  assert.equal(forwardGoalLabel({homeScore:0,awayScore:0}, null), null);
});
test('labels are forward relative to each snapshot, not match-had-a-goal', () => {
  assert.equal(forwardGoalLabel({homeScore:1,awayScore:0}, {home:1,away:0}), false);
  assert.equal(forwardGoalLabel({homeScore:1,awayScore:0}, {home:2,away:0}), true);
  assert.equal(forwardGoalLabel({homeScore:1,awayScore:0}, {home:0,away:0}), null);
});
test('missing xG remains null; confirmed zero remains zero; one missing side makes total null', () => {
  const o = observation(); o.stats.home.sot = 0;
  const row = buildSnapshotFeatures('fixture-a', o, []);
  assert.equal(row.homeXg, null); assert.equal(row.totalXg, null);
  assert.equal(row.homeSot, 0); assert.equal(row.totalSot, null);
  assert.ok(row.dataQualityDetails.confirmedZero.includes('home.sot'));
  assert.ok(row.dataQualityDetails.missing.includes('home.xg'));
  for(const v of [null, undefined, '', ' ', 'N/D', true, -1, NaN]) assert.equal(knownNumber(v), null);
});
test('strict raw mapping does not mistake shots on target for total shots', () => {
  const o = allSportsObservation({event_key:'123',event_status:'17',event_final_result:'0 - 0',statistics:[{type:'Shots On Target',home:'0',away:'2'}]}, now.toISOString());
  assert.equal(o.stats.home.shots, null); assert.equal(o.stats.home.sot, 0);
});
test('capture starts at minute 18: last15 at minute 22 is null, coverage is 4/15', () => {
  const r = calculateRecentWindowMetrics(point(22), [18,20].map(m=>point(m)));
  assert.equal(r.sotLast15, null); assert.equal(r.sotLast5, null); assert.equal(r.coveragePercent, 27);
});
test('real continuous coverage produces exact deltas without FT or other-fixture contamination', () => {
  const history = Array.from({length:15},(_,i)=>point(i+8));
  history.push(point(18,{matchId:'fixture-b',homeSot:999}));
  history.push(point(13,{marketPeriod:'FULL_TIME',homeSot:999}));
  const r=calculateRecentWindowMetrics(point(23),history);
  assert.equal(r.sotLast5,5); assert.equal(r.sotLast10,10); assert.equal(r.sotLast15,15);
  assert.equal(r.xgLast5,.5); assert.equal(r.bigChancesLast15,0); assert.equal(r.coveragePercent,100);
});
test('endpoint coverage alone cannot fill a 15-minute gap; resets invalidate the affected metric', () => {
  assert.equal(calculateRecentWindowMetrics(point(23),[point(8)]).sotLast15,null);
  const history=Array.from({length:15},(_,i)=>point(i+8)); history[10].homeSot=0;
  assert.equal(calculateRecentWindowMetrics(point(23),history).sotLast15,null);
});
test('goaled, HT, second-half, unknown score, invalid id and stale observations are not candidates', () => {
  for(const o of [observation('17','1 - 0'),observation('HT'),observation('46'),observation(''),observation('17',''),
    {...observation(),providerFixtureId:''},{...observation(),observedAt:new Date(now-240000).toISOString()}]) assert.equal(isFirstHalfCandidate(o),false);
  assert.equal(isFirstHalfCandidate(observation()),true);
});
test('45+2 is first-half added time played, not two announced minutes remaining', () => {
  const o=observation('45+2'); assert.equal(o.minute,45); assert.equal(o.elapsedStoppageTime,2);
  assert.equal(o.stoppageTime,null); assert.equal(minutesRemainingMarket(o),null);
  assert.equal(minutesRemainingMarket({...o,stoppageTime:5}),3);
  assert.equal(minutesRemainingMarket(observation('40')),5);
});
test('FT score never substitutes for an unavailable HT result; abandonment is not FT', () => {
  const ft=allSportsObservation({event_key:'123',event_status:'Finished',event_final_result:'2 - 1'},now.toISOString());
  assert.equal(ft.halfTimeScore,null); assert.deepEqual(ft.fullTimeScore,{home:2,away:1});
  assert.equal(allSportsObservation({event_key:'123',event_status:'Abandoned',event_final_result:'1 - 0'},now.toISOString()).fullTimeScore,null);
});
test('API-Football keeps 1H/HT/2H and unknown scores separate', () => {
  const raw={fixture:{id:12,status:{short:'2H',elapsed:45}},teams:{home:{id:1},away:{id:2}},goals:{home:null,away:null},score:{halftime:{home:0,away:0}}};
  const o=apiFootballObservation(raw,now.toISOString()); assert.equal(o.period,'SECOND_HALF');assert.equal(o.score,null);assert.deepEqual(o.halfTimeScore,{home:0,away:0});
});
test('duplicates are stable; useful changes within the same minute are retained', () => {
  const o=observation(); assert.equal(snapshotSourceHash(o),snapshotSourceHash(structuredClone(o)));
  const changed=structuredClone(o);changed.stats.home.sot=1;
  assert.notEqual(snapshotSourceHash(o),snapshotSourceHash(changed));
  assert.notEqual(snapshotSourceHash(o),snapshotSourceHash({...o,providerFixtureId:'999'}));
});
test('a cached raw object keeps its original receipt time', () => {
  const raw={};rememberTrainingReceipt([raw],now.toISOString());assert.equal(trainingReceipt(raw),now.toISOString());assert.equal(trainingReceipt({}),null);
});
test('odds require explicit FIRST HALF OVER 0.5, fresh timestamp and match-wide goals', () => {
  const q={market:'Total goles 1T',selection:'Over 0.5 1T',price:1.8,quotedAt:new Date(now-1000).toISOString(),bookmaker:'A'};
  assert.equal(selectFirstHalfOdds([q],now.toISOString(),now.toISOString()).price,1.8);
  for(const bad of [{...q,market:'Total goles',selection:'Over 0.5'},{...q,market:'Home team goals 1T'},
    {...q,selection:'Over 1.5 1T'},{...q,quotedAt:new Date(now-240000).toISOString()},{...q,quotedAt:new Date(+now+1000).toISOString()}])
    assert.equal(selectFirstHalfOdds([bad],now.toISOString(),now.toISOString()),null);
});
test('validation filters reject malformed, reversed and excessive inputs', () => {
  assert.deepEqual(parseTrainingFilters(new URLSearchParams('limit=100&minMinute=10&minDataQuality=50')), {limit:100,minMinute:10,minDataQuality:50});
  for(const query of ['limit=1001','limit=0','minMinute=46','minMinute=20&maxMinute=10','minDataQuality=NaN']) assert.throws(()=>parseTrainingFilters(new URLSearchParams(query)));
});

test('separately fetched stats are not backdated and stale clocks never acquire fresh metrics',()=>{
  const raw={fixture:{id:12,status:{short:'1H',elapsed:17}},teams:{home:{id:1},away:{id:2}},goals:{home:0,away:0}};
  const stats=[{team:{id:1},statistics:[{type:'Shots on goal',value:2}]}];
  rememberTrainingReceipt([raw],new Date(now-10000).toISOString());rememberTrainingReceipt(stats,now.toISOString());
  const fresh=alignedApiFootballObservation(raw,stats);assert.equal(fresh.observedAt,now.toISOString());assert.equal(fresh.stats.home.sot,2);
  rememberTrainingReceipt([raw],new Date(now-60000).toISOString());
  assert.equal(alignedApiFootballObservation(raw,stats).stats.home.sot,null);
});

test('numeric AllSports status alone is ambiguous, explicit API 1H permits capture',()=>{
  for(const status of ['17','45','45+2','LIVE','']) {
    const o=allSportsObservation({event_key:'123',event_status:status,event_final_result:'0 - 0'},new Date().toISOString());
    assert.equal(isFirstHalfCandidate(o),false);
  }
  const raw={fixture:{id:12,status:{short:'1H',elapsed:17}},teams:{home:{id:1},away:{id:2}},goals:{home:0,away:0}};
  assert.equal(isFirstHalfCandidate(apiFootballObservation(raw,new Date().toISOString())),true);
  assert.equal(isFirstHalfCandidate(observation('0')),false);
});

test('dataset skip reasons distinguish score, period, identity and stale observations',()=>{
  const {candidateSkipReason}=require('../../src/services/training/features.ts');
  assert.equal(candidateSkipReason(observation('17','')), 'UNKNOWN_SCORE');
  assert.equal(candidateSkipReason(observation('17','1 - 0')), 'ALREADY_SCORED');
  assert.equal(candidateSkipReason({...observation(),period:'SECOND_HALF'}), 'INVALID_PERIOD');
  assert.equal(candidateSkipReason({...observation(),providerFixtureId:''}), 'MISSING_FIXTURE_ID');
  assert.equal(candidateSkipReason({...observation(),minute:null}), 'INVALID_MINUTE');
  assert.equal(candidateSkipReason({...observation(),observedAt:'invalid'}), 'STALE_OBSERVATION');
});

test('dataset health is informational and distinguishes empty, incomplete and healthy data',()=>{
  const {datasetHealth}=require('../../src/services/training/monitoring.ts');
  const coverage={SOT:{coveragePercent:100},corners:{coveragePercent:100}};
  const diagnostics={captured:20,qualityRejected:0};
  assert.equal(datasetHealth(0,0,coverage,diagnostics).status,'EMPTY');
  assert.equal(datasetHealth(10,6,coverage,diagnostics).status,'WARNING');
  assert.equal(datasetHealth(10,0,{...coverage,SOT:{coveragePercent:40}},diagnostics).status,'WARNING');
  assert.equal(datasetHealth(10,0,coverage,{captured:1,qualityRejected:20}).status,'WARNING');
  assert.equal(datasetHealth(10,0,coverage,diagnostics).status,'HEALTHY');
});

test('identical dataset skips are suppressed until the fixture state changes',()=>{
  const {datasetEvent,datasetDiagnostics}=require('../../src/services/training/telemetry.ts');
  const original=console.info, logs=[];
  console.info=x=>logs.push(JSON.parse(x));
  try {
    datasetEvent('DATASET_SKIPPED','log-test','UNKNOWN_SCORE',1,true);
    datasetEvent('DATASET_SKIPPED','log-test','UNKNOWN_SCORE',1,true);
    datasetEvent('DATASET_SKIPPED','log-test','INVALID_PERIOD',1,true);
    assert.equal(logs.length,2);
    assert.ok(datasetDiagnostics().qualityRejected>=2);
  } finally {console.info=original;}
});

test('explicit FIRST_HALF status confirms period without inventing a clock',()=>{
  const e=resolveMatchPeriodEvidence({event_key:'123',event_status:'FIRST_HALF'},now.toISOString());
  assert.equal(e.period,'FIRST_HALF');assert.equal(e.confidence,'CONFIRMED');assert.equal(e.normalizedMinute,null);
});
test('explicit SECOND_HALF status confirms the second half',()=>{
  const e=resolveMatchPeriodEvidence({event_key:'123',event_status:'SECOND_HALF'},now.toISOString());
  assert.equal(e.period,'SECOND_HALF');assert.equal(e.confidence,'CONFIRMED');
});
test('actual AllSports Half Time status confirms HT independently of live flag',()=>{
  const e=resolveMatchPeriodEvidence({event_key:'1871453',event_status:'Half Time',event_live:'1'},now.toISOString());
  assert.equal(e.period,'HALFTIME');assert.equal(e.confidence,'CONFIRMED');
});
test('17 alone cannot establish first-half period',()=>{
  const e=resolveMatchPeriodEvidence({event_key:'123',event_status:'17'},now.toISOString());
  assert.equal(e.normalizedMinute,17);assert.equal(e.period,'UNKNOWN');assert.equal(e.confidence,'UNKNOWN');
});
test('live flag, fresh 0-0 and missing HT do not positively prove FIRST_HALF',()=>{
  const e=resolveMatchPeriodEvidence({event_key:'123',event_status:'17',event_live:'1',event_final_result:'0 - 0',event_halftime_result:''},new Date().toISOString());
  assert.equal(e.period,'UNKNOWN');assert.equal(e.reason,'INSUFFICIENT_FIRST_HALF_EVIDENCE');
});
test('ambiguous 45 and added-time values never imply FIRST_HALF',()=>{
  for(const event_status of ['45','45+','45+2']) {
    const e=resolveMatchPeriodEvidence({event_key:'123',event_status,event_live:'1',event_final_result:'0 - 0'},now.toISOString());
    assert.equal(e.period,'UNKNOWN');assert.equal(e.normalizedMinute,45);
  }
});
test('confirmed period with unknown score does not capture; explicit 0-0 does',()=>{
  const raw={event_key:'123',event_status:'1H 17',event_live:'1'};
  assert.equal(isFirstHalfCandidate(allSportsObservation(raw,new Date().toISOString())),false);
  assert.equal(isFirstHalfCandidate(allSportsObservation({...raw,event_final_result:'0 - 0'},new Date().toISOString())),true);
});
test('API-Football 1H remains explicit and independent of AllSports evidence',()=>{
  const raw={fixture:{id:123,status:{short:'1H',elapsed:17}},teams:{home:{id:1},away:{id:2}},goals:{home:0,away:0}};
  const o=apiFootballObservation(raw,new Date().toISOString());
  assert.equal(o.period,'FIRST_HALF');assert.equal(o.periodEvidence.confidence,'CONFIRMED');assert.equal(isFirstHalfCandidate(o),true);
});
test('real post-HT signals support SECOND_HALF derivation; missing or stale evidence does not',()=>{
  const raw={event_key:'1870298',event_status:'52',event_live:'1',event_halftime_result:'0 - 1',event_final_result:'1 - 1'};
  const e=resolveMatchPeriodEvidence(raw,now.toISOString(),now);
  assert.equal(e.period,'SECOND_HALF');assert.equal(e.confidence,'DERIVED_HIGH');
  for(const patch of [{event_live:'0'},{event_halftime_result:''},{event_final_result:''},{event_status:'90+'},{event_final_result:'0 - 0'},{event_ft_result:'1 - 1'}])
    assert.equal(resolveMatchPeriodEvidence({...raw,...patch},now.toISOString(),now).confidence,'UNKNOWN');
  assert.equal(resolveMatchPeriodEvidence(raw,new Date(now-240000).toISOString(),now).confidence,'UNKNOWN');
  assert.equal(resolveMatchPeriodEvidence({...raw,event_status:'Finished'},now.toISOString()).period,'FINISHED');
});
test('period contradictions are rejected and skip telemetry carries sanitized evidence without spam',()=>{
  assert.equal(resolveMatchPeriodEvidence({event_key:'123',event_status:'1H 52'},now.toISOString()).period,'UNKNOWN');
  assert.equal(resolveMatchPeriodEvidence({event_key:'123',event_status:'1H 17',event_halftime_result:'0 - 0'},now.toISOString()).period,'FIRST_HALF');
  const {datasetEvent}=require('../../src/services/training/telemetry.ts');
  const evidence=resolveMatchPeriodEvidence({event_key:'123',event_status:'17'},now.toISOString());
  const original=console.info,logs=[];console.info=x=>logs.push(JSON.parse(x));
  try {
    datasetEvent('DATASET_SKIPPED','period-log-test','INVALID_PERIOD',1,true,evidence);
    datasetEvent('DATASET_SKIPPED','period-log-test','INVALID_PERIOD',1,true,evidence);
    assert.equal(logs.length,1);assert.equal(logs[0].periodEvidence.rawEventStatus,'17');
    assert.equal(logs[0].periodEvidence.provider,'AllSportsApi');assert.equal(logs[0].periodEvidence.periodConfidence,'UNKNOWN');
  } finally {console.info=original;}
});

test('capture requires confirmed period evidence, not a manually assigned period',()=>{
  const o=observation();
  assert.equal(isFirstHalfCandidate({...o,periodEvidence:undefined}),false);
  assert.equal(isFirstHalfCandidate({...o,periodEvidence:{...o.periodEvidence,confidence:'DERIVED_HIGH'}}),false);
  const raw=allSportsObservation({event_key:'123',event_status:'17',event_final_result:'0 - 0'},new Date().toISOString());
  assert.equal(raw.period,'UNKNOWN');assert.equal(isFirstHalfCandidate(raw),false);
  assert.equal(isFirstHalfCandidate({...raw,period:'FIRST_HALF'}),false);
});
