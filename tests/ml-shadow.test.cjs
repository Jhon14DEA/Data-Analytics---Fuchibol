const {test}=require('node:test');const assert=require('node:assert/strict');
const {buildShadow,shadowOutcomes,collectAllSportsShadow,shadowIssue}=require('../src/services/ml/shadowCollector.ts');
const {rememberTrainingReceipt}=require('../src/services/training/observation.ts');
function raw(at=new Date(),extra={}){const r={event_key:'123',event_status:'First Half: 20',event_live:'1',event_final_result:'0 - 0',...extra};rememberTrainingReceipt(r,at.toISOString());return r;}
test('collector retains NULL, all available stats and explicit zero with receipt proof',()=>{
  const now=new Date(),r=raw(now,{statistics:[{type:'Shots on target',home:'0',away:'2'},{type:'Possession',home:'52%',away:'48%'},{type:'Custom metric',home:'7',away:null}]});
  const row=buildShadow(r,'fixture',[],now);assert.equal(row.homeScore,0);assert.equal(row.stats.home.sot,0);assert.equal(row.stats.home.xg,null);
  assert.equal(row.stats.home.possession,52);assert.equal(row.stats.availableProviderStatistics.length,3);
  assert.equal(row.dataQuality.temporalPolicy,'OPERATIONAL_POINT_IN_TIME');assert.equal(+row.capturedAt,+now);assert.equal(row.recent.recent5,null);
  assert.equal(row.labels,undefined);assert.equal(row.finalHomeScore,undefined);
});
test('missing score/receipt, stale and future receipts never certify',()=>{
  const now=new Date();for(const r of [raw(now,{event_final_result:''}),{...raw(now)},raw(new Date(+now-180001)),raw(new Date(+now+1))])assert.equal(buildShadow(r,'f',[],now),null);
});
test('numeric live clock does not invent FIRST_HALF or added time',()=>{
  const now=new Date(),row=buildShadow(raw(now,{event_status:'25'}),'f',[],now);
  assert.equal(row.period,'UNKNOWN');assert.equal(row.dataQuality.shortWindowPeriodConfirmed,false);assert.equal(row.dataQuality.stoppageTime,null);
});
test('persisted feature hash verifies, but score or receipt tampering fails closed',()=>{
  const now=new Date(),row=buildShadow(raw(now),'f',[],now);assert.equal(shadowIssue(row),null);
  assert.equal(shadowIssue({...row,homeScore:4}),'FEATURE_PAYLOAD_CHANGED');
  assert.equal(shadowIssue({...row,receivedAt:new Date(+now+1)}),'EVIDENCE_AFTER_CAPTURE');
});
test('future snapshot cannot contaminate recent windows',()=>{
  const now=new Date(),future=buildShadow(raw(new Date(+now+60000),{event_status:'First Half: 21'}),'f',[],new Date(+now+60000));
  const row=buildShadow(raw(now),'f',[{id:'future',...future}],now);assert.equal(row.recent.recent5,null);
});
test('explicit HT and FT resolve separate labels without changing captured features',()=>{
  const now=new Date(),start={id:'s',...buildShadow(raw(now),'f',[],now)},before=JSON.stringify(start);
  const ht=raw(new Date(+now+60000),{event_status:'Half Time',event_final_result:'1 - 0',event_halftime_result:'1 - 0'});
  const a=shadowOutcomes([start],ht);assert.equal(a.find(o=>o.label==='goalsRemaining1H').value,1);assert.equal(a.some(o=>o.label==='goalsRemainingFT'),false);
  const ft=raw(new Date(+now+120000),{event_status:'Finished',event_live:'0',event_final_result:'2 - 1',event_halftime_result:'1 - 0'});
  const b=shadowOutcomes([start],ft);assert.equal(b.find(o=>o.label==='goalsRemainingFT').value,3);assert.equal(b.find(o=>o.label==='twoPlusGoalsRemainingFT').value,1);
  assert.equal(JSON.stringify(start),before);assert.equal(b.some(o=>o.label==='goalNext10'),false);
});
test('exact continuous observed window can resolve next5; missing coverage cannot',()=>{
  const now=new Date(),rows=[];
  for(let i=0;i<=5;i++){const at=new Date(+now+i*60000);rows.push({id:'s'+i,...buildShadow(raw(at,{event_status:`First Half: ${20+i}`,event_final_result:i===5?'1 - 0':'0 - 0'}),'f',rows,at)});}
  const end=raw(new Date(+now+5*60000),{event_status:'First Half: 25',event_final_result:'1 - 0'});
  assert.equal(shadowOutcomes(rows,end).find(o=>o.snapshotId==='s0'&&o.label==='goalNext5').value,1);
  assert.equal(shadowOutcomes([rows[0],rows[5]],end).some(o=>o.label==='goalNext5'),false);
});
test('AET score cannot settle regular FT remaining-goals label',()=>{
  const now=new Date(),start={id:'s',...buildShadow(raw(now),'f',[],now)};
  assert.equal(shadowOutcomes([start],raw(new Date(+now+1000),{event_status:'AET',event_ft_result:'4 - 1'})).some(o=>o.label==='goalsRemainingFT'),false);
});
test('future labels are batched into one DB write per fixture',async()=>{
  const now=new Date(),snapshot={id:'s',...buildShadow(raw(now),'f',[],now)},later=new Date(+now+1000);let writes=0;
  const db={fixture:{findMany:async()=>[{id:'f',externalId:'123',status:'FINISHED'}]},mlShadowSnapshot:{findMany:async()=>[snapshot]},
    mlShadowOutcome:{createMany:async({data})=>{writes++;assert.equal(data.length,3);return{count:data.length};}}};
  const result=await collectAllSportsShadow([raw(later,{event_status:'Finished',event_live:'0',event_final_result:'2 - 1',event_halftime_result:'1 - 0'})],db,later);
  assert.equal(writes,1);assert.equal(result.labels,3);
});
test('DB outage is isolated and sanitized, without provider fallback',async()=>{
  const now=new Date(),original=console.warn;let logged='';console.warn=x=>logged=x;
  try{const result=await collectAllSportsShadow([raw(now)],{fixture:{findMany:async()=>{throw Error('postgresql://SECRET');}}},now);assert.equal(result.failed,1);assert.doesNotMatch(logged,/SECRET|postgresql/);}finally{console.warn=original;}
});
test('disable switch performs no database calls',async()=>{
  const prev=process.env.ML_SHADOW_ENABLED;process.env.ML_SHADOW_ENABLED='false';
  try{assert.deepEqual(await collectAllSportsShadow([raw()],{}),{captured:0,labels:0,failed:0});}finally{if(prev===undefined)delete process.env.ML_SHADOW_ENABLED;else process.env.ML_SHADOW_ENABLED=prev;}
});
test('existing AllSports dashboard response reaches shadow without additional provider requests',async()=>{
  const prismaModule=require('../src/lib/prisma.ts'),training=require('../src/services/training/liveMarketSnapshots.ts'),persistence=require('../src/services/persistence/liveListPersistence.ts');
  const oldDb=prismaModule.prisma,oldResolve=training.resolveObservedMarketResults,oldPersist=persistence.persistAllSportsLiveList,oldKey=process.env.ALLSPORTS_API_KEY;
  const requests=[],saved=[];
  try {
    process.env.ALLSPORTS_API_KEY='synthetic-shadow-test';training.resolveObservedMarketResults=async()=>{};persistence.persistAllSportsLiveList=async()=>({persisted:0,failed:0});
    prismaModule.prisma={fixture:{findMany:async()=>[{id:'f',externalId:'123',status:'LIVE'}]},
      mlShadowSnapshot:{findMany:async()=>[...saved],createMany:async({data})=>{saved.push({id:'shadow',...data});return{count:1};},findUniqueOrThrow:async()=>saved[0]},
      mlShadowOutcome:{createMany:async()=>{throw Error('No future label expected');}}};
    const {AllSportsApiProvider}=require('../src/providers/football/allSportsApi.ts');const provider=new AllSportsApiProvider();
    const payload={...raw(),event_date:'2026-10-30',event_time:'12:00',home_team_key:'h',away_team_key:'a',league_key:'l',league_name:'Premier League Test',event_home_team:'Synthetic Home',event_away_team:'Synthetic Away'};
    provider.request=async method=>{requests.push(method);const result=method==='Livescore'?[payload]:[];rememberTrainingReceipt(result);return result;};
    const matches=await provider.listMatches();await provider.listMatches();
    assert.equal(matches[0].homeTeam,'Synthetic Home');assert.deepEqual(requests,['Fixtures','Livescore']);assert.equal(saved.length,1);assert.equal(shadowIssue(saved[0]),null);
  }finally{
    prismaModule.prisma=oldDb;training.resolveObservedMarketResults=oldResolve;persistence.persistAllSportsLiveList=oldPersist;
    if(oldKey===undefined)delete process.env.ALLSPORTS_API_KEY;else process.env.ALLSPORTS_API_KEY=oldKey;
  }
});
