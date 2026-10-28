const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const {authorized, createAiHandler} = require('../src/services/ai/http.ts');
const {presentFixture, persistedRecent, compactContext, createAiReader} = require('../src/services/ai/reader.ts');
const {unavailableHistoricalContext} = require('../src/services/historical/liveContext.ts');
const {aiOpenApi} = require('../src/services/ai/openapi.ts');
const previous = process.env.FUT_AI_API_KEY;
process.env.FUT_AI_API_KEY = 'test-key-not-a-real-secret';
after(() => {if(previous === undefined) delete process.env.FUT_AI_API_KEY; else process.env.FUT_AI_API_KEY=previous;});
const now = new Date('2026-10-27T12:30:00Z');
function snapshot(minute, offsets={}) {
  const row={id:`s${minute}`,fixtureId:'fixture1',minute,timestamp:new Date(now.getTime()-(30-minute)*60000),homeScore:0,awayScore:0};
  for(const p of ['home','away']) for(const k of ['Shots','ShotsOffTarget','ShotsOnTarget','BigChances','ShotsInsideBox','Xg','Corners','Possession','YellowCards','RedCards','Attacks','DangerousAttacks']) row[p+k]=null;
  return {...row,...offsets};
}
function fixture(overrides={}) {
  return {id:'fixture1',provider:'AllSportsApi',externalId:'123',status:'LIVE',minute:30,homeScore:0,awayScore:0,
    kickoff:new Date('2026-10-27T12:00:00Z'),providerUpdatedAt:now,updatedAt:now,staleReason:null,
    homeTeamId:'h',awayTeamId:'a',homeTeam:{name:'Home',externalId:'h'},awayTeam:{name:'Away',externalId:'a'},league:{name:'League'},
    teamStats:[],liveSnapshots:[snapshot(30)],events:[],lineups:[],...overrides};
}
const history=unavailableHistoricalContext('NO_MAPPING');
const req=(token='test-key-not-a-real-secret',query='')=>new Request(`http://local/api/ai/live${query}`,{headers:token===null?{}:{authorization:`Bearer ${token}`}});
test('auth rejects absent, invalid and disabled keys; accepts case-insensitive Bearer',()=>{
  assert.equal(authorized(req(null)),false); assert.equal(authorized(req('wrong')),false);
  assert.equal(authorized(req(),''),false); assert.equal(authorized(req()),true);
  assert.equal(authorized(new Request('http://local',{headers:{authorization:'bearer test-key-not-a-real-secret'}})),true);
});
test('all four operations reject unauthenticated calls before loading DB',async()=>{
  const handler=createAiHandler(async()=>{throw new Error('DB should not load');});
  for(const kind of ['live','fixture','analysis-context','openapi']) {
    const r=await handler(req(null),kind,'fixture1'); assert.equal(r.status,401);
    assert.match(r.headers.get('cache-control'),/no-store/); assert.equal(r.headers.get('www-authenticate'),'Bearer');
  }
});
test('schema is authenticated and needs no database',async()=>{
  const r=await createAiHandler(async()=>{throw Error('DB');})(req(),'openapi');
  assert.equal(r.status,200); assert.equal((await r.json()).openapi,'3.0.3');
});
test('bad pagination/id rejected before DB access',async()=>{
  const handler=createAiHandler(async()=>{throw Error('should not load');});
  for(const query of ['?limit=0','?limit=51','?limit=1.5','?cursor=','?cursor=%27']) assert.equal((await handler(req(undefined,query),'live')).status,400);
  assert.equal((await handler(req(),'fixture','../x')).status,400);
});
test('unknown fixture 404; database failures sanitized',async()=>{
  assert.equal((await createAiHandler(async()=>({fixture:async()=>null}))(req(),'fixture','unknown')).status,404);
  const r=await createAiHandler(async()=>{throw Error('postgresql://secret API_KEY=hidden');})(req(),'live');
  assert.equal(r.status,503); assert.doesNotMatch(await r.text(),/secret|postgresql|hidden/);
});
test('non-GET requests cannot execute reads',async()=>{
  const r=await createAiHandler(async()=>{throw Error('DB');})(new Request('http://local',{method:'POST',headers:{authorization:'Bearer test-key-not-a-real-secret'}}),'live');
  assert.equal(r.status,405);
});
test('NULL metrics and missing arrays remain unavailable, not zero',()=>{
  const p=presentFixture(fixture(),history,now);
  for(const k of ['xg','bigChances','shotsInsideBox','shots','shotsOnTarget','dangerousAttacks']) assert.equal(p.teamStats.home[k],null);
  assert.equal(p.recent.five,null); assert.equal(p.events,null); assert.equal(p.lineups.home,null);
  assert.equal(p.MATCH_EXPLOSION,null);
});
test('observed zero and decimal values preserved',()=>{
  const p=presentFixture(fixture({liveSnapshots:[snapshot(30,{homeShots:0,homeXg:{toString:()=> '0.45'}})]}),history,now);
  assert.equal(p.teamStats.home.shots,0);assert.equal(p.teamStats.home.xg,.45);
});
test('current NULL does not fall back to an older team statistic',()=>{
  const p=presentFixture(fixture({teamStats:[{teamId:'h',shots:9,updatedAt:now}]}),history,now);
  assert.equal(p.teamStats.home.shots,null);
});
test('lineup unknown number and event unknown minute remain null',()=>{
  const p=presentFixture(fixture({lineups:[{teamId:'h',player:{name:'P'},starter:true,number:null,position:null}],events:[{eventType:'goal',minute:null,teamId:'h',playerName:null,detail:null}]}),history,now);
  assert.equal(p.lineups.home[0].number,null);assert.equal(p.events[0].minute,null);
});
test('stale fixture retains persisted status but no active pressure signal',()=>{
  const p=presentFixture(fixture({providerUpdatedAt:new Date(now-181000)}),history,now);
  assert.equal(p.fixture.status,'LIVE');assert.equal(p.dataQuality.stale,true);assert.equal(p.HIGH_GOAL_PRESSURE,null);assert.equal(p.MATCH_EXPLOSION,null);
});
test('unaligned and non-LIVE fixtures have no active pressure signal',()=>{
  assert.equal(presentFixture(fixture({minute:31}),history,now).HIGH_GOAL_PRESSURE,null);
  assert.equal(presentFixture(fixture({status:'HALFTIME'}),history,now).HIGH_GOAL_PRESSURE,null);
});
test('recent window requires exact persisted boundaries and bounded gaps',()=>{
  assert.equal(persistedRecent([snapshot(30)],5),null);
  assert.equal(persistedRecent([snapshot(30),snapshot(24)],5),null);
  assert.equal(persistedRecent([snapshot(30),snapshot(20)],10),null);
  const result=persistedRecent([snapshot(30,{homeShots:5,awayShots:0}),snapshot(25,{homeShots:3,awayShots:0})],5);
  assert.equal(result.shots,2);assert.equal(result.away.shots,0);assert.equal(result.xg,null);assert.equal(result.substitutions,null);
});
test('half-time wall-clock gap invalidates recent window',()=>{
  assert.equal(persistedRecent([snapshot(30),snapshot(25,{timestamp:new Date(now-1200000)})],5),null);
});
test('counter correction/reset invalidates window instead of inventing zero',()=>{
  assert.equal(persistedRecent([snapshot(30,{homeShots:2}),snapshot(25,{homeShots:5})],5),null);
});
test('future observation cannot be presented as fresh LIVE',()=>{
  assert.equal(presentFixture(fixture({providerUpdatedAt:new Date(now.getTime()+60000)}),history,now).dataQuality.stale,true);
});
test('pressure and explosion reuse existing informational detector',()=>{
  const rows=[30,25,20,15].map(m=>snapshot(m,{homeScore:1,awayScore:1,homeShots:m/5+4,awayShots:m/5+4,homeShotsOnTarget:m/5,awayShotsOnTarget:m/5,homeXg:m/20,awayXg:m/20,homeBigChances:2,awayBigChances:2,homeShotsInsideBox:8,awayShotsInsideBox:8,homeCorners:4,awayCorners:4,homeDangerousAttacks:30,awayDangerousAttacks:30,homeRedCards:0,awayRedCards:0}));
  const p=presentFixture(fixture({homeScore:1,awayScore:1,liveSnapshots:rows}),history,now);
  assert.equal(p.HIGH_GOAL_PRESSURE.level,'PRESSURE_HIGH');assert.equal(p.MATCH_EXPLOSION,true);
  assert.equal('markets' in p.HIGH_GOAL_PRESSURE,false);
});
test('compact context omits large lists and raw/private fields',()=>{
  const p=presentFixture(fixture({DATABASE_URL:'PRIVATE',raw:{apiKey:'PRIVATE'}}),history,now);
  const c=compactContext(p);assert.equal(c.informationalOnly,true);assert.equal(c.live.teamStats.home.xg,null);
  assert.doesNotMatch(JSON.stringify(c),/PRIVATE|DATABASE_URL|apiKey|BET_SCORE|ENTER_NOW/);
});
test('reader uses only injected find reads; provider network forbidden',async()=>{
  const reads=[];
  const db={fixture:{findUnique:async args=>{reads.push(args);return fixture();},findMany:async args=>{reads.push(args);return [fixture()];}},
    providerEntityMapping:{findMany:async()=>[]},team:{findMany:async()=>[]}};
  const reader=createAiReader(db,()=>now);
  const detail=await reader.fixture('fixture1'); assert.equal(detail.historicalContext.status,'N/D');
  const list=await reader.live(20);assert.equal(list.items.length,1);assert.equal(list.nextCursor,null);
  assert.equal(reads[0].where.id,'fixture1');assert.equal(reads[1].where.status,'LIVE');assert.equal(reads[1].take,21);
});
test('live reader omits stale records and exposes continuation',async()=>{
  const db={fixture:{findMany:async()=>[fixture({id:'a',providerUpdatedAt:new Date(now-999000)}),fixture({id:'b'})]},providerEntityMapping:{findMany:async()=>[]},team:{findMany:async()=>[]}};
  const p=await createAiReader(db,()=>now).live(1);assert.deepEqual(p.items,[]);assert.equal(p.nextCursor,'a');
});
test('historical reader provides 5/10/20 with explicit missing coverage, using only stored mappings',async()=>{
  const before=new Date('2026-10-26T00:00:00Z');let queries=0;
  const db={fixture:{findUnique:async()=>fixture(),findMany:async()=>{queries++;return [];}},
    providerEntityMapping:{findMany:async()=>['h','a'].map(id=>({kind:'TEAM',leftProvider:'AllSportsApi',leftExternalId:id,rightProvider:'FOOTBALL_DATA',rightExternalId:`fd-${id}`,method:'VERIFIED_PROVIDER_ID',createdAt:before}))},
    team:{findMany:async()=>['h','a'].map(id=>({id:`db-${id}`,externalId:`fd-${id}`}))}};
  const p=await createAiReader(db,()=>now).fixture('fixture1');
  assert.equal(queries,4);assert.deepEqual(p.historicalContext.home.filter(p=>p.venue==='HOME').map(p=>p.window),[5,10,20]);
  assert.equal(p.historicalContext.home[0].features.avgGoalsFor,null);
  assert.equal(compactContext(p).history.home.length,3);
});
test('authorized fixture and compact HTTP responses preserve contracts',async()=>{
  const p=presentFixture(fixture(),history,now);const handler=createAiHandler(async()=>({fixture:async()=>p}));
  const full=await handler(req(),'fixture','fixture1');assert.equal(full.status,200);assert.equal((await full.json()).fixtureId,'fixture1');
  const compact=await handler(req(),'analysis-context','fixture1');assert.equal(compact.status,200);assert.equal((await compact.json()).informationalOnly,true);
});
test('OpenAPI has four unique GET operation IDs, Bearer security, resolvable schema refs',()=>{
  assert.equal(Object.keys(aiOpenApi.paths).length,4);const ids=[];
  for(const item of Object.values(aiOpenApi.paths)){assert.deepEqual(Object.keys(item),['get']);ids.push(item.get.operationId);}
  assert.equal(new Set(ids).size,4);assert.equal(aiOpenApi.components.securitySchemes.bearerAuth.scheme,'bearer');
  assert.deepEqual(aiOpenApi.security,[{bearerAuth:[]}]);
  const walk=v=>{if(!v||typeof v!=='object')return;if(v.$ref)assert.ok(aiOpenApi.components.schemas[v.$ref.split('/').at(-1)]);Object.values(v).forEach(walk);};walk(aiOpenApi);
});
test('Next route adapters require auth including OpenAPI',async()=>{
  for(const file of ['live','openapi.json','fixture/[fixtureId]','fixture/[fixtureId]/analysis-context']){
    const route=require(`../src/app/api/ai/${file}/route.ts`);
    const r=await route.GET(req(null),{params:Promise.resolve({fixtureId:'fixture1'})});assert.equal(r.status,401);
  }
});
