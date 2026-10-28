const {test} = require('node:test');
const assert = require('node:assert/strict');
const {persistAllSportsLiveList} = require('../src/services/persistence/liveListPersistence.ts');
const {rememberTrainingReceipt} = require('../src/services/training/observation.ts');
const {createAiReader} = require('../src/services/ai/reader.ts');

function input(at=new Date(), changes={}) {
  const raw={event_key:'pipeline-test',event_live:'1',event_status:'30',event_final_result:'1 - 0',...changes};
  rememberTrainingReceipt(raw, at.toISOString());
  return {raw,summary:{id:'allsports-pipeline-test',source:'allsports',status:'LIVE',minute:30,
    homeTeam:'Pipeline Home',awayTeam:'Pipeline Away',competition:'Test League',
    homeTeamExternalId:'ph',awayTeamExternalId:'pa',leagueExternalId:'pl',
    kickoffAt:'2026-10-28T12:00:00',score:{home:1,away:0}}};
}
function database() {
  let row=null;const snapshots=[];
  const db={
    fixture:{findUnique:async()=>row,upsert:async({create,update})=>row=row?{...row,...update}:{id:'internal-fixture',...create},
      findMany:async({where})=>row&&row.status===where.status&&row.providerUpdatedAt>=where.providerUpdatedAt.gte?[{
        ...row,homeTeam:{name:'Pipeline Home',externalId:'ph'},awayTeam:{name:'Pipeline Away',externalId:'pa'},
        league:{name:'Test League'},teamStats:[],events:[],lineups:[],liveSnapshots:[...snapshots].reverse()
      }]:[]},
    team:{upsert:async({create})=>({id:create.externalId,...create})},
    league:{upsert:async({create})=>({id:create.externalId,...create})},
    liveSnapshot:{create:async({data})=>{snapshots.push({id:`s${snapshots.length}`,...data});return data;}},
    providerEntityMapping:{findMany:async()=>[]},
    $transaction:async cb=>cb(db)
  };return {db,snapshots,get row(){return row;}};
}
test('received numeric LIVE clock persists and becomes visible through the actual AI reader',async()=>{
  const now=new Date(),state=database(), item=input(now);
  assert.deepEqual(await persistAllSportsLiveList([item],state.db,now),{persisted:1,failed:0});
  const result=await createAiReader(state.db,()=>now).live(10);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].fixtureId,'internal-fixture');
  assert.deepEqual(result.items[0].score,{home:1,away:0});
  assert.equal(result.items[0].dataQuality.stale,false);
  assert.equal(state.row.kickoff.toISOString(),'2026-10-28T17:00:00.000Z');
});
test('missing metrics remain NULL while explicit zero stays zero',async()=>{
  const now=new Date(),s=database();
  await persistAllSportsLiveList([input(now,{statistics:[{type:'Shots on target',home:'0',away:'2'}]})],s.db,now);
  assert.equal(s.snapshots[0].homeShotsOnTarget,0);
  assert.equal(s.snapshots[0].awayShotsOnTarget,2);
  for(const k of ['Shots','Xg','BigChances','ShotsInsideBox','DangerousAttacks','Corners'])assert.equal(s.snapshots[0]['home'+k],null);
});
test('missing score is skipped, confirmed 0-0 is persisted',async()=>{
  const now=new Date(),s=database();
  for(const value of [undefined,'','-','N/D'])await persistAllSportsLiveList([input(now,{event_final_result:value})],s.db,now);
  assert.equal(s.row,null);
  await persistAllSportsLiveList([input(now,{event_final_result:'0 - 0'})],s.db,now);
  assert.equal(s.row.homeScore,0);assert.equal(s.row.awayScore,0);
});
test('cached receipt is idempotent and cannot keep AI data fresh',async()=>{
  const now=new Date(),s=database(),item=input(now);
  await persistAllSportsLiveList([item],s.db,now);
  await persistAllSportsLiveList([item],s.db,new Date(+now+120000));
  assert.equal(s.snapshots.length,1);assert.equal(+s.row.providerUpdatedAt,+now);
  const later=new Date(+now+181000);
  await persistAllSportsLiveList([item],s.db,later);
  assert.equal((await createAiReader(s.db,()=>later).live(10)).items.length,0);
});
test('new receipt refreshes an unchanged scoreboard with a new observed snapshot',async()=>{
  const now=new Date(),s=database();
  await persistAllSportsLiveList([input(now)],s.db,now);
  const later=new Date(+now+120000);
  await persistAllSportsLiveList([input(later)],s.db,later);
  assert.equal(s.snapshots.length,2);assert.equal(+s.snapshots[1].timestamp,+later);
});
test('terminal state and newer persisted observations cannot be overwritten',async()=>{
  const now=new Date(),s=database();await persistAllSportsLiveList([input(now)],s.db,now);
  await persistAllSportsLiveList([input(new Date(+now-1000))],s.db,now);
  assert.equal(s.snapshots.length,1);
  s.row.status='FINISHED';
  await persistAllSportsLiveList([input(new Date(+now+1000))],s.db,new Date(+now+1000));
  assert.equal(s.row.status,'FINISHED');assert.equal(s.snapshots.length,1);
});
test('missing receipt, identity, invalid kickoff, future and stale observations do not write',async()=>{
  const now=new Date(),s=database();
  const missing=input(now);missing.raw={...missing.raw};
  const noId=input(now);noId.summary.homeTeamExternalId=null;
  const badDate=input(now);badDate.summary.kickoffAt=undefined;
  const upcoming=input(now);upcoming.summary.status='UPCOMING';
  await persistAllSportsLiveList([missing,noId,badDate,upcoming,input(new Date(+now+1)),input(new Date(+now-180001))],s.db,now);
  assert.equal(s.row,null);
});
test('halftime is persisted as HALFTIME and excluded from LIVE list',async()=>{
  const now=new Date(),s=database();await persistAllSportsLiveList([input(now,{event_status:'Half Time'})],s.db,now);
  assert.equal(s.row.status,'HALFTIME');assert.equal((await createAiReader(s.db,()=>now).live(10)).items.length,0);
});
test('persistence failure is sanitized and does not fail the received dashboard response',async()=>{
  const now=new Date(),original=console.warn;let warning='';console.warn=text=>warning=text;
  try{
    const result=await persistAllSportsLiveList([input(now)],{$transaction:async()=>{throw Error('DATABASE_URL=secret');}},now);
    assert.deepEqual(result,{persisted:0,failed:1});assert.doesNotMatch(warning,/secret|DATABASE_URL/);
  }finally{console.warn=original;}
});
test('dashboard provider list reuses exactly Fixtures + Livescore; cached list adds no request/write',async()=>{
  const prismaModule=require('../src/lib/prisma.ts');
  const training=require('../src/services/training/liveMarketSnapshots.ts');
  const originalDb=prismaModule.prisma, originalResolve=training.resolveObservedMarketResults;
  const oldKey=process.env.ALLSPORTS_API_KEY;
  const s=database(),calls=[];
  try {
    prismaModule.prisma=s.db;training.resolveObservedMarketResults=async()=>{};
    process.env.ALLSPORTS_API_KEY='synthetic-test-key';
    const {AllSportsApiProvider}=require('../src/providers/football/allSportsApi.ts');
    const provider=new AllSportsApiProvider();
    const raw={...input().raw,event_date:'2026-10-28',event_time:'12:00',home_team_key:'ph',away_team_key:'pa',
      league_key:'pl',league_name:'Premier League Test',event_home_team:'Pipeline Home',event_away_team:'Pipeline Away'};
    provider.request=async method=>{calls.push(method);const result=method==='Livescore'?[raw]:[];rememberTrainingReceipt(result);return result;};
    const dashboard=await provider.listMatches();
    assert.equal(dashboard[0].id,'allsports-pipeline-test');
    assert.equal(dashboard[0].status,'LIVE');
    assert.equal((await createAiReader(s.db).live(10)).items[0].teams.home,dashboard[0].homeTeam);
    await provider.listMatches();
    assert.deepEqual(calls,['Fixtures','Livescore']);assert.equal(s.snapshots.length,1);
    await provider.listAllMatchesToday();
    assert.deepEqual(calls,['Fixtures','Livescore','Fixtures','Livescore']);
  } finally {
    prismaModule.prisma=originalDb;training.resolveObservedMarketResults=originalResolve;
    if(oldKey===undefined)delete process.env.ALLSPORTS_API_KEY;else process.env.ALLSPORTS_API_KEY=oldKey;
  }
});
