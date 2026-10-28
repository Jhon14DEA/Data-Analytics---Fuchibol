// Run only against a disposable database whose name begins ai_pipeline_test_.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PrismaClient} = require('@prisma/client');
const {persistAllSportsLiveList} = require('../src/services/persistence/liveListPersistence.ts');
const {rememberTrainingReceipt} = require('../src/services/training/observation.ts');
const {createAiReader} = require('../src/services/ai/reader.ts');
const {createAiHandler} = require('../src/services/ai/http.ts');

test('PostgreSQL integration: received LIVE -> atomic fixture/snapshot -> authenticated AI endpoint',async()=>{
  const url=process.env.TEST_AI_PIPELINE_DATABASE_URL;
  assert.ok(url && /^\/ai_pipeline_test_[a-z0-9_]+$/.test(new URL(url).pathname),'Disposable database required');
  const db=new PrismaClient({datasources:{db:{url}}});
  const oldKey=process.env.FUT_AI_API_KEY;
  try {
    const now=new Date(),raw={event_key:'synthetic-integration',event_live:'1',event_status:'30',event_final_result:'1 - 0',
      statistics:[{type:'Shots on target',home:'3',away:'0'}]};
    rememberTrainingReceipt(raw,now.toISOString());
    const summary={id:'allsports-synthetic-integration',source:'allsports',status:'LIVE',minute:30,score:{home:1,away:0},
      competition:'Synthetic integration league',leagueExternalId:'test-league',homeTeam:'Synthetic Home',awayTeam:'Synthetic Away',
      homeTeamExternalId:'test-home',awayTeamExternalId:'test-away',kickoffAt:'2026-10-28T12:00:00'};
    assert.deepEqual(await persistAllSportsLiveList([{raw,summary}],db,now),{persisted:1,failed:0});
    const reader=createAiReader(db,()=>now);
    process.env.FUT_AI_API_KEY='integration-only';
    const response=await createAiHandler(async()=>reader)(new Request('http://local/api/ai/live',{headers:{authorization:'Bearer integration-only'}}),'live');
    assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.items.length,1);
    const item=body.items[0];assert.equal(item.teams.home,summary.homeTeam);assert.equal(item.minute,30);
    assert.equal(item.dataQuality.snapshotAligned,true);assert.equal(item.dataQuality.stale,false);
    const detail=await reader.fixture(item.fixtureId);
    assert.equal(detail.teamStats.home.xg,null);assert.equal(detail.teamStats.away.shotsOnTarget,0);
    await persistAllSportsLiveList([{raw,summary}],db,now);
    assert.equal(await db.liveSnapshot.count(),1);
    // A failed snapshot insert must roll back the fixture update as well.
    const later=new Date(+now+1000);rememberTrainingReceipt(raw,later.toISOString());raw.event_final_result='2 - 0';
    const failing={$transaction:cb=>db.$transaction(tx=>cb({...tx,liveSnapshot:{create:async()=>{throw Error('injected failure');}}}))};
    assert.equal((await persistAllSportsLiveList([{raw,summary}],failing,later)).failed,1);
    assert.equal((await db.fixture.findUnique({where:{id:item.fixtureId}})).homeScore,1);
    assert.equal(await db.liveSnapshot.count(),1);
    console.log('Synthetic integration example:',JSON.stringify({fixtureId:item.fixtureId,teams:item.teams,minute:item.minute,score:item.score,stale:item.dataQuality.stale}));
  }finally{
    await db.$disconnect();
    if(oldKey===undefined)delete process.env.FUT_AI_API_KEY;else process.env.FUT_AI_API_KEY=oldKey;
  }
});
