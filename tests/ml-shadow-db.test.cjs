const {test}=require('node:test');const assert=require('node:assert/strict');const {PrismaClient}=require('@prisma/client');
const {collectAllSportsShadow,shadowIssue}=require('../src/services/ml/shadowCollector.ts');
const {rememberTrainingReceipt}=require('../src/services/training/observation.ts');
test('PostgreSQL shadow integration: durable receipt, idempotence, separate future labels and unchanged fixture',async()=>{
  const url=process.env.TEST_ML_SHADOW_DATABASE_URL;
  assert.ok(url&&/^\/ml_shadow_test_[a-z0-9_]+$/.test(new URL(url).pathname),'Disposable test database required');
  const db=new PrismaClient({datasources:{db:{url}}});
  try {
    const league=await db.league.create({data:{provider:'AllSportsApi',externalId:'test',name:'Synthetic'}});
    const home=await db.team.create({data:{provider:'AllSportsApi',externalId:'h',name:'Synthetic Home'}}),away=await db.team.create({data:{provider:'AllSportsApi',externalId:'a',name:'Synthetic Away'}});
    const before=await db.fixture.create({data:{provider:'AllSportsApi',externalId:'123',leagueId:league.id,homeTeamId:home.id,awayTeamId:away.id,kickoff:new Date(),status:'LIVE',minute:20,homeScore:0,awayScore:0}});
    const now=new Date(),raw={event_key:'123',event_live:'1',event_status:'First Half: 20',event_final_result:'0 - 0'};rememberTrainingReceipt(raw,now.toISOString());
    assert.deepEqual(await collectAllSportsShadow([raw],db,now),{captured:1,labels:0,failed:0});
    assert.deepEqual(await collectAllSportsShadow([raw],db,now),{captured:0,labels:0,failed:0});
    const snapshot=await db.mlShadowSnapshot.findFirst();assert.equal(shadowIssue(snapshot),null);assert.equal(snapshot.stats.home.xg,null);assert.equal(+snapshot.receivedAt,+now);
    const later=new Date(+now+1000),ft={event_key:'123',event_live:'0',event_status:'Finished',event_final_result:'2 - 1',event_halftime_result:'1 - 0'};rememberTrainingReceipt(ft,later.toISOString());
    assert.equal((await collectAllSportsShadow([ft],db,later)).labels,3);
    const outcomes=await db.mlShadowOutcome.findMany();assert.equal(outcomes.find(o=>o.label==='goalsRemainingFT').value,3);
    assert.equal(outcomes.find(o=>o.label==='goalsRemaining1H').value,1);
    assert.deepEqual(await db.mlShadowSnapshot.findFirst(),snapshot);
    assert.deepEqual(await db.fixture.findUnique({where:{id:before.id}}),before);
    assert.equal(await db.liveSnapshot.count(),0);assert.equal(await db.liveMarketSnapshot.count(),0);
    assert.equal((await collectAllSportsShadow([ft],db,later)).labels,0);
  }finally{await db.$disconnect();}
});
