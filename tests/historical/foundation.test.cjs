const {test}=require('node:test'),assert=require('node:assert/strict');
const {batch}=require('./fixtures.cjs');
const {HISTORICAL_SCOPE,scopeBinding,classifyCompetition}=require('../../src/services/historical/scope.ts');
const {historicalMetrics,seasonKey,normalizeApiFootballFixture}=require('../../src/services/historical/normalize.ts');
const {resolveHistoricalMarket,DEFAULT_MARKETS}=require('../../src/services/historical/outcomes.ts');
const {previewBatch,runHistoricalBatch}=require('../../src/services/historical/worker.ts');
const {fixtureIssue}=require('../../src/services/historical/validation.ts');
const {exactIdentityMatch,resolveMapping}=require('../../src/services/historical/mapping.ts');
for(const [patch,want]of [[{gender:'male',ageCategory:'senior',reserve:false},'MEN_SENIOR'],[{gender:'female'},'WOMEN'],[{ageCategory:'U21'},'YOUTH'],[{reserve:true},'RESERVE'],[{name:'Unknown',gender:null,ageCategory:null},'UNKNOWN']])test('classification '+want,()=>{
 assert.equal(classifyCompetition({id:'test',name:'Test competition',country:'England',...patch}).classification,want);
});
test('structured metadata takes priority over a curated male-senior ID fallback',()=>{
 const b=batch(),binding=scopeBinding(b.provider,b.competition);assert.equal(classifyCompetition({...b.competition,gender:'female'},binding).classification,'WOMEN');
 assert.equal(classifyCompetition({...b.competition,ageCategory:'U20'},binding).classification,'YOUTH');
 assert.equal(classifyCompetition({...b.competition,name:'Premier League Women'},binding).classification,'WOMEN');
});
test('names alone cannot admit a league; bound provider ID plus country and exact name can',()=>{
 const b=batch();assert.equal(scopeBinding('AllSportsApi',b.competition),null);assert.equal(scopeBinding(b.provider,{...b.competition,id:'999'}),null);
 assert.equal(scopeBinding(b.provider,{...b.competition,country:'Other'}),null);assert.equal(scopeBinding(b.provider,{...b.competition,name:'Premier League U21'}),null);
 const c={id:'39',name:'Premier League',country:'England'};assert.equal(classifyCompetition(c).classification,'UNKNOWN');assert.equal(classifyCompetition(c,scopeBinding(b.provider,c)).classification,'MEN_SENIOR');
});
test('scope contains exactly the requested 12 leagues and unverified IDs are blocked',()=>{
 assert.equal(new Set(HISTORICAL_SCOPE.map(x=>x.key)).size,12);assert.equal(HISTORICAL_SCOPE.length,17);assert.equal(HISTORICAL_SCOPE.filter(x=>x.id===null).length,2);
 assert.equal(scopeBinding('API-Football',{id:'2',name:'UEFA Champions League',country:'World'}),null);
});
for(const patch of [{gender:'female'},{ageCategory:'U17'},{reserve:true},{gender:'unknown'}])test('non-senior batch excluded '+JSON.stringify(patch),()=>{
 const b=batch();b.competition={...b.competition,...patch};assert.throws(()=>previewBatch(b),/NOT_MEN_SENIOR/);
});
test('seasons preserve split years and tournament phases as distinct strings',()=>{
 assert.deepEqual(['2026','2026/27','Apertura 2026','Clausura 2026'].map(seasonKey),['2026','2026/27','Apertura 2026','Clausura 2026']);assert.throws(()=>seasonKey(2026));
});
test('N/D, missing and malformed values remain NULL while confirmed zero survives',()=>{
 const m=historicalMetrics({goals:0,shots:'N/D',shotsOnTarget:undefined,xg:'',possession:'55.5%',corners:false});
 assert.equal(m.goals,0);assert.equal(m.shots,null);assert.equal(m.shotsOnTarget,null);assert.equal(m.xg,null);assert.equal(m.possession,55.5);assert.equal(m.corners,null);
});
test('API raw adapter isolates HT/FT stats and only derives second-half goals from explicit regulation scores',()=>{
 const raw={fixture:{id:12,date:'2026-01-01T12:00:00Z',status:{short:'FT'}},league:{id:39,season:2026},teams:{home:{id:1,name:'H'},away:{id:2,name:'A'}},score:{halftime:{home:0,away:0},fulltime:{home:2,away:1}}};
 const f=normalizeApiFootballFixture(raw,'2026/27',[{team:{id:1},statistics:[{type:'Shots on goal',value:5}]}]);
 assert.equal(f.periods.find(p=>p.period==='FIRST_HALF').home.shotsOnTarget,null);assert.equal(f.periods.find(p=>p.period==='FULL_TIME').home.shotsOnTarget,5);
 assert.equal(f.periods.find(p=>p.period==='SECOND_HALF').home.goals,2);assert.equal(f.periods.find(p=>p.period==='SECOND_HALF').home.shotsOnTarget,null);
 assert.equal(normalizeApiFootballFixture({...raw,fixture:{...raw.fixture,status:{short:'AET'}}},'2026'),null);
});
test('goals outcomes retain FIRST_HALF and FULL_TIME and settle their separate lines',()=>{
 const periods=batch().fixtures[0].periods;
 assert.equal(resolveHistoricalMarket(DEFAULT_MARKETS[0],periods).status,'LOSS');
 assert.equal(resolveHistoricalMarket(DEFAULT_MARKETS[3],periods).status,'WIN');
 assert.equal(resolveHistoricalMarket(DEFAULT_MARKETS[4],periods).status,'LOSS');
});
test('integer lines push, quarter lines stay UNKNOWN and explicit void is distinct',()=>{
 const s={...DEFAULT_MARKETS[2],line:2},p=batch().fixtures[0].periods;
 assert.equal(resolveHistoricalMarket(s,p).status,'PUSH');assert.equal(resolveHistoricalMarket({...s,line:2.25},p).status,'UNKNOWN');assert.equal(resolveHistoricalMarket({...s,voided:true},p).status,'VOID');
});
test('BTTS and team overs are resolved without picks or recommendations',()=>{
 const p=batch().fixtures[0].periods;for(const s of DEFAULT_MARKETS.slice(5))assert.equal(resolveHistoricalMarket(s,p).status,'WIN');
});
test('corners and explicit card counting rules preserve missing coverage',()=>{
 const p=batch().fixtures[0].periods,s={...DEFAULT_MARKETS[2],market:'CORNERS',line:5};assert.equal(resolveHistoricalMarket(s,p).status,'PUSH');
 assert.equal(resolveHistoricalMarket({...s,market:'CARDS',line:2.5,rules:'YELLOW_PLUS_RED'},p).status,'WIN');
 assert.equal(resolveHistoricalMarket({...s,market:'CARDS',rules:'UNSPECIFIED'},p).status,'UNKNOWN');
 assert.equal(resolveHistoricalMarket({...s,period:'FIRST_HALF'},p).status,'UNKNOWN');
});
test('dry-run performs zero DB access, requests or state mutation',async()=>{
 const b=batch(),before=structuredClone(b),db=new Proxy({},{get(){throw Error('DB_USED')}}),old=globalThis.fetch;globalThis.fetch=()=>{throw Error('HTTP_USED')};
 try{assert.equal((await runHistoricalBatch(db,b)).requests,0);assert.deepEqual(b,before);}finally{globalThis.fetch=old;}
});
test('synthetic demonstration files cannot be written by the worker',async()=>{
 await assert.rejects(()=>runHistoricalBatch(new Proxy({},{get(){throw Error('DB_USED')}}),{...batch(),synthetic:true},{dryRun:false}),/MOCK_WRITE_FORBIDDEN/);
});
test('duplicate input is deduplicated and conflicting duplicates fail closed',()=>{
 const b=batch();b.fixtures.push(structuredClone(b.fixtures[0]));assert.equal(previewBatch(b).uniqueFixtures,1);b.fixtures[1].home.name='Other';assert.throws(()=>previewBatch(b),/CONFLICTING_DUPLICATE/);
});
test('oversized batches, future receipts and cross-scope fixtures are rejected',()=>{
 const b=batch();assert.throws(()=>previewBatch({...b,receivedAt:new Date(Date.now()+60000).toISOString()}),/CLOCK/);
 assert.throws(()=>previewBatch({...b,fixtures:Array(51).fill(b.fixtures[0])}),/LIMIT/);
 assert.equal(fixtureIssue({...b.fixtures[0],competitionId:'71'},b),'WRONG_SCOPE');
 assert.equal(fixtureIssue({...b.fixtures[0],status:'LIVE'},b),'NOT_FINISHED');
});
test('interval periods are supported explicitly without synthesizing them from FT totals',()=>{
 const b=batch(),f=b.fixtures[0];f.periods.push({period:'MIN_31_45_PLUS',home:historicalMetrics({goals:0}),away:historicalMetrics({goals:0}),source:'EXPLICIT_PROVIDER_INTERVAL'});assert.equal(fixtureIssue(f,b),null);
});
test('exact fixture matching includes competition, orientation and bounded kickoff',()=>{
 const a={provider:'AllSportsApi',id:'1',name:'',competitionKey:'premier-league',home:'Home',away:'Away',kickoff:'2026-01-01T12:00:00Z'},b={...a,provider:'API-Football',id:'2',kickoff:'2026-01-01T12:05:00Z'};
 assert.equal(exactIdentityMatch('FIXTURE',a,b),true);assert.equal(exactIdentityMatch('FIXTURE',a,{...b,kickoff:'2026-01-01T12:05:01Z'}),false);assert.equal(exactIdentityMatch('FIXTURE',a,{...b,competitionKey:'other'}),false);assert.equal(exactIdentityMatch('FIXTURE',a,{...b,home:'Away',away:'Home'}),false);
});
test('ambiguous mapping is NO MATCH; persisted IDs disambiguate only consistent identities',async()=>{
 const a={provider:'AllSportsApi',id:'1',name:'Team',competitionKey:'scope'},b={...a,provider:'API-Football',id:'2'},c={...b,id:'3'};
 const db={providerEntityMapping:{findMany:async()=>[]}};assert.equal(await resolveMapping(db,'TEAM',a,'API-Football',[b,c]),null);
 db.providerEntityMapping.findMany=async()=>[{leftProvider:'API-Football',leftExternalId:'2',rightProvider:'AllSportsApi',rightExternalId:'1'}];
 assert.equal((await resolveMapping(db,'TEAM',a,'API-Football',[b,c])).id,'2');assert.equal(await resolveMapping(db,'TEAM',a,'API-Football',[{...b,name:'Wrong'}]),null);
});
test('historical graph has no LIVE decisions, processor or budget imports',()=>{
 const fs=require('fs'),path=require('path');const dir=path.join(__dirname,'../../src/services/historical');
 for(const f of fs.readdirSync(dir)){const source=fs.readFileSync(path.join(dir,f),'utf8');const imports=source.match(/(?:from|require\()\s*['"][^'"]+/g)||[];assert.equal(imports.some(s=>/matchAnalyzer|liveGoalRadar|footballPersistence|hybrid\/|liveMarketSnapshots|opportunityRadar/.test(s)),false,f);}
});
