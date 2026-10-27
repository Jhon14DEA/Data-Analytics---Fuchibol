const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Prisma}=require('@prisma/client');
const {sample}=require('./hybrid-fixtures.cjs');
const {hybridObservation}=require('../../src/services/training/hybrid/policy.ts');
const {buildSnapshotFeatures,candidateSkipReason}=require('../../src/services/training/features.ts');
const {SNAPSHOT_FIELDS,pointInTimeFeatures,pointInTimeIssue}=require('../../src/services/training/pointInTime.ts');
const {parseGoalTotal,timestampIssue}=require('../../src/services/training/oddsIntegrity.ts');
const {selectFirstHalfOdds,rememberTrainingReceipt,alignedApiFootballObservation}=require('../../src/services/training/observation.ts');
function fixture(){
 const at=new Date(Date.now()-2000),s=sample(at);
 const o=hybridObservation(s.identity,s.observation,s.certificate,true);
 return {...s,o,row:buildSnapshotFeatures('pit-test',o,[])};
}

test('every Prisma snapshot field has exactly one explicit classification',()=>{
 const names=Prisma.dmmf.datamodel.models.find(m=>m.name==='LiveMarketSnapshot').fields.map(f=>f.name).sort();
 const declared=Object.values(SNAPSHOT_FIELDS).flat().sort();assert.deepEqual(declared,names);assert.equal(new Set(declared).size,declared.length);
});
test('certificate received before or exactly at capture is usable',()=>{
 const s=fixture();assert.ok(s.o);assert.ok(pointInTimeFeatures(s.row));
 assert.ok(hybridObservation(s.identity,{...s.observation,observedAt:new Date(Date.now()-1000).toISOString()},s.certificate,true));
});
test('certificate one millisecond after capture cannot authorize historic features',()=>{
 const s=fixture(),before=structuredClone(s.observation);
 const c={...s.certificate,observedAt:new Date(Date.parse(s.observation.observedAt)+1).toISOString()};
 assert.equal(hybridObservation(s.identity,s.observation,c,true),null);assert.deepEqual(s.observation,before);
 assert.equal(buildSnapshotFeatures('pit-test',{...s.o,hybridEvidence:{...s.o.hybridEvidence,observedAt:c.observedAt}},[]),null);
});
test('late evidence is usable only with a later observation, without rewriting the old payload',()=>{
 const s=fixture(),old=structuredClone(s.row),at=new Date(Date.now()-1000).toISOString();
 const c={...s.certificate,observedAt:at};
 assert.equal(hybridObservation(s.identity,s.observation,c,true),null);
 assert.ok(hybridObservation(s.identity,{...s.observation,observedAt:at},c,true));assert.deepEqual(s.row,old);
});
test('labels, resolution times, joined fixtures and unknown columns never enter features',()=>{
 const {row}=fixture(),before=pointInTimeFeatures(row);
 const after={...row,goalBeforeHt:true,goalBeforeFt:true,finalHomeScore:5,finalAwayScore:2,htResolvedAt:new Date(),ftResolvedAt:new Date(),resultResolvedAt:new Date(),match:{homeScore:5},futureLeak:99};
 assert.deepEqual(pointInTimeFeatures(after),before);
 for(const key of [...SNAPSHOT_FIELDS.LABEL_FUTURE,'match','futureLeak'])assert.equal(key in before,false);
 assert.equal(Object.isFrozen(before),true);
});
test('legacy snapshots are retained for audit but excluded from verified projection',()=>{
 const {row}=fixture();assert.equal(pointInTimeIssue({...row,dataQualityDetails:{version:1}}),'UNVERIFIED_LEGACY_SNAPSHOT');
});
test('retroactive feature mutation is detected; labels can change without invalidating the seal',()=>{
 const {row}=fixture();assert.equal(pointInTimeIssue({...row,totalSot:900}),'FEATURE_PAYLOAD_CHANGED');
 assert.equal(pointInTimeIssue({...row,goalBeforeHt:true}),null);
 assert.equal(pointInTimeFeatures({...row,totalSot:900}),null);
});
test('changing capturedAt or evidence clocks invalidates the temporal seal',()=>{
 const {row}=fixture();assert.equal(pointInTimeIssue({...row,capturedAt:new Date()}),'CAPTURE_TIME_CHANGED');
 const changed=structuredClone(row);changed.dataQualityDetails.pointInTime.periodAvailableAt=new Date().toISOString();
 assert.equal(pointInTimeIssue(changed),'EVIDENCE_AFTER_CAPTURE');
});
test('a sealed payload cannot be transferred to another fixture or stats provider',()=>{
 const {row}=fixture();assert.equal(pointInTimeFeatures({...row,matchId:'another-fixture'}),null);
 assert.equal(pointInTimeFeatures({...row,providerFixtureId:'900'}),null);assert.equal(pointInTimeFeatures({...row,statsProvider:'API_FOOTBALL'}),null);
});
test('N/D remains NULL and confirmed zero remains zero through projection',()=>{
 const features=pointInTimeFeatures(fixture().row);assert.equal(features.totalXg,null);assert.equal(features.homeSot,0);assert.equal(features.totalBigChances,null);
});
test('separately fetched statistics retain both local receipt clocks',()=>{
 const {raw}=fixture(),stats=[{team:{id:1},statistics:[{type:'Shots on goal',value:2}]}];
 const now=new Date(Date.now()-1000).toISOString(),earlier=new Date(Date.now()-10000).toISOString();
 rememberTrainingReceipt([raw],earlier);rememberTrainingReceipt(stats,now);
 const o=alignedApiFootballObservation(raw,stats);assert.equal(o.observedAt,now);assert.deepEqual(o.receipts,{fixture:earlier,stats:now});
 assert.ok(buildSnapshotFeatures('api',o,[]));
 assert.equal(candidateSkipReason({...o,observedAt:earlier}),'EVIDENCE_AFTER_CAPTURE');
});
test('future observations and malformed certificate timestamps fail closed',()=>{
 const s=fixture();assert.equal(candidateSkipReason({...s.o,observedAt:new Date(Date.now()+10000).toISOString()}),'STALE_OBSERVATION');
 assert.equal(hybridObservation(s.identity,s.observation,{...s.certificate,observedAt:'invalid'},true),null);
});
test('provider timestamp later than receipt is detected with zero skew tolerance',()=>{
 assert.equal(timestampIssue('2026-10-13T12:00:01Z','2026-10-13T12:00:00Z','2026-10-13T12:00:02Z'),'PROVIDER_TIMESTAMP_AFTER_RECEIPT');
 assert.equal(timestampIssue('invalid','invalid','invalid'),'INVALID_TIMESTAMP');
});
test('quote timestamp alone cannot establish receipt before capture',()=>{
 const at=new Date(Date.now()-2000).toISOString(),q={market:'Total goles 1T',selection:'Over 0.5 1T',price:1.8,bookmaker:'Test',quotedAt:at};
 assert.equal(selectFirstHalfOdds([q],at),null);
 assert.equal(selectFirstHalfOdds([q],at,new Date().toISOString()),null);
 assert.equal(selectFirstHalfOdds([q],at,at).price,1.8);
});
test('late odds are NULL and cannot mutate the input observation or its stored features',()=>{
 const {o}=fixture(),odds={price:1.8,bookmaker:'Test',quotedAt:o.observedAt,receivedAt:new Date().toISOString()};
 const input={...o,odds},before=structuredClone(input),row=buildSnapshotFeatures('pit',input,[]);
 assert.equal(row.marketOdds,null);assert.equal(row.oddsProvider,null);assert.equal(row.oddsQuotedAt,null);assert.deepEqual(input,before);
 assert.ok(pointInTimeFeatures(row));
});
test('available odds preserve their provider and receipt timestamps',()=>{
 const {o}=fixture(),row=buildSnapshotFeatures('pit',{...o,odds:{price:1.8,bookmaker:'Test',quotedAt:o.observedAt,receivedAt:o.observedAt}},[]);
 assert.equal(pointInTimeFeatures(row).marketOdds,1.8);assert.equal(row.dataQualityDetails.pointInTime.oddsReceivedAt,o.observedAt);
 assert.equal(pointInTimeIssue({...row,oddsQuotedAt:new Date()}),'UNSAFE_ODDS');
});
for(const line of [0.5,1.5,2.5])test(`Over ${line}: selection line never comes from the price or 1H ordinal`,()=>{
 const q=parseGoalTotal('Goals Over/Under (1st Half)',`Over ${line}`,2.75);
 assert.equal(q.line,line);assert.equal(q.price,2.75);assert.equal(q.market,'TOTAL_GOALS');assert.equal(q.period,'FIRST_HALF');assert.equal(q.selection,'OVER');
});
test('HT/FT markets stay distinct and ambiguous period is rejected',()=>{
 assert.equal(parseGoalTotal('Total goals FT','Over 2.5',1.8).period,'FULL_TIME');
 assert.equal(parseGoalTotal('Total goals 1H','Over 2.5',1.8).period,'FIRST_HALF');
 assert.equal(parseGoalTotal('Total goals','Over 2.5',1.8),null);
 assert.equal(parseGoalTotal('Total goals 1H FT','Over 2.5',1.8),null);
});
test('integer push and Asian quarter/split lines are identified without settling bets',()=>{
 assert.equal(parseGoalTotal('Asian Total goals FT','Over 2',1.8).settlement,'INTEGER_PUSH');
 assert.equal(parseGoalTotal('Asian Total goals FT','Over 2.25',1.8).settlement,'ASIAN_SPLIT');
 assert.equal(parseGoalTotal('Asian Total goals FT','Over 2/2.5',1.8).line,2.25);
 assert.equal(parseGoalTotal('Asian Total goals FT','Over 2/3',1.8),null);
});
test('non-goal markets, unsupported selections and ordinal numbers never become a total line',()=>{
 for(const [market,selection]of [['1x2 (1st Half)','1'],['3-Way Handicap','Home'],['Asian Handicap (1st Half)','Home'],['Team goals 1H','Over 0.5'],['Total goals 2nd Half','Over 0.5'],['Total goals 1H','Over 0.5/1'],['Corners 1H','Over 2.5']]) {
  const at=new Date().toISOString();assert.equal(selectFirstHalfOdds([{market,selection,price:1.8,quotedAt:at,bookmaker:'Test'}],at,at),null);
 }
});
test('pure integrity functions have no HTTP, budget or decision side effects',()=>{
 const old=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('HTTP forbidden');};
 try{const s=fixture(),decisions={BET_SCORE:51,entry:'NO_ENTRY',alert:false};const match={...s.o,...decisions};
  buildSnapshotFeatures('pit',match,[]);pointInTimeFeatures(s.row);assert.deepEqual({BET_SCORE:match.BET_SCORE,entry:match.entry,alert:match.alert},decisions);assert.equal(requests,0);
 }finally{globalThis.fetch=old;}
});

test('AllSports keeps display odds and the same existing requests while excluding later dataset odds',async()=>{
 const {AllSportsApiProvider}=require('../../src/providers/football/allSportsApi.ts');
 const provider=new AllSportsApiProvider(),at=new Date(Date.now()-2000).toISOString();
 const raw={event_key:'777',event_date:'2026-10-13',event_time:'12:00',event_live:'1',event_status:'17',event_final_result:'0 - 0',event_home_team:'Home',event_away_team:'Away',league_name:'Test'};
 const live={'777':[{odd_name:'Match Goals (1st Half)',odd_type:'Over',odd_participant_handicap:'0.5',odd_value:'1.8',odd_last_updated:at}]};
 rememberTrainingReceipt([raw],at);rememberTrainingReceipt(live,new Date().toISOString());
 const requests=[];provider.request=async met=>{requests.push(met);return met==='OddsLive'?live:{};};
 const detail=await provider.mapDetail(raw);
 assert.deepEqual(requests,['Odds','OddsLive']);assert.equal(detail.trainingObservation.odds,null);
 assert.equal(detail.odds.some(q=>q.price===1.8&&q.selection==='Over 0.5 1T'),true);
});
