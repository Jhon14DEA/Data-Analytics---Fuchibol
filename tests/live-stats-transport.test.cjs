const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mapStats}=require('../src/providers/football/allSportsApi.ts');
const {liveSnapshotCreateData,mapFixtureRecord}=require('../src/services/persistence/footballPersistence.ts');
const {evaluateLiveGoalRadar}=require('../src/services/analysis/liveGoalRadar.ts');
const {analyzeMatchContext}=require('../src/services/analysis/matchAnalyzer.ts');
function context(stats){return {match:{id:'test',status:'LIVE',minute:28,score:{home:0,away:0},homeTeam:'Home',awayTeam:'Away',competition:'Test',stats,lineups:{home:[],away:[]},playerStats:[],events:[]},recentHome:[],recentAway:[],h2h:[]};}
const raw=[{type:'Big Chances',home:'1',away:'0'},{type:'Shots Inside Box',home:'3',away:'2'}];
test('principal normalizer transports present counts including explicit zero',()=>{
 const s=mapStats(raw);assert.equal(s.home.bigChances,1);assert.equal(s.away.bigChances,0);assert.equal(s.home.shotsInsideBox,3);assert.equal(s.away.shotsInsideBox,2);
});
test('missing and N/D stay NULL, missed chances are not total big chances',()=>{
 for(const rows of [[],[{type:'Big Chances Missed',home:'2',away:'1'}],[{type:'Big Chances',home:'N/D',away:''}]]){
 const s=mapStats(rows);assert.equal(s.home.bigChances,null);assert.equal(s.away.bigChances,null);assert.equal(s.home.shotsInsideBox,null);
 }
});
test('snapshot write payload preserves present values and legacy absence',()=>{
 const present=liveSnapshotCreateData('fixture','hash',context(mapStats(raw)).match);
 assert.equal(present.homeBigChances,1);assert.equal(present.awayBigChances,0);assert.equal(present.awayShotsInsideBox,2);
 const old=context(mapStats([])).match;delete old.stats.home.bigChances;
 assert.equal(liveSnapshotCreateData('fixture','hash',old).homeBigChances,null);
});
test('stored snapshot read reaches radar without changing any scoring or decision output',()=>{
 const base={provider:'AllSportsApi',externalId:'1',league:{externalId:'1',name:'Test'},homeTeam:{externalId:'h',name:'Home'},awayTeam:{externalId:'a',name:'Away'},homeTeamId:'h',awayTeamId:'a',status:'LIVE',minute:28,homeScore:0,awayScore:0,kickoff:new Date(),teamStats:[],lineups:[],playerStats:[],events:[],oddsSnapshots:[],liveSnapshots:[]};
 const data=liveSnapshotCreateData('fixture','hash',context(mapStats(raw)).match);
 const stored=mapFixtureRecord({...base,liveSnapshots:[data]});
 const c=context(stored.stats);const after=evaluateLiveGoalRadar(c);const before=evaluateLiveGoalRadar(context(mapStats([])));
 assert.equal(after[0].accumulated.bigChances,1);assert.equal(after[0].accumulated.shotsInsideBox,5);
 for(let i=0;i<after.length;i++){
   const strip=x=>{const {accumulated,ndFields,...rest}=x;return rest;};
   assert.deepEqual(strip(after[i]),strip(before[i]));
   assert.equal(after[i].windows.ten.bigChancesNew,null);
   assert.ok(!after[i].ndFields.includes('bigChances'));
 }
 assert.equal(mapFixtureRecord(base).stats.home.bigChances,null);
 assert.equal(mapFixtureRecord({...base,liveSnapshots:[{...data,minute:25}]}).stats.home.bigChances,null);
});
test('partial side coverage does not produce a combined total',()=>{
 const s=mapStats([{type:'Big Chances',home:'1',away:'N/D'}]);
 assert.equal(evaluateLiveGoalRadar(context(s))[0].accumulated.bigChances,null);
});
test('betting engine outputs identical markets and ENTRY decisions with informational counts',()=>{
 const a=context(mapStats(raw));a.match.odds=[];a.match.analysis=[];a.match.alerts=[];a.match.demo=false;
 const b=structuredClone(a);
 for(const side of ['home','away']){delete a.match.stats[side].bigChances;delete a.match.stats[side].shotsInsideBox;}
 const before=analyzeMatchContext(a),after=analyzeMatchContext(b);
 assert.ok(before.allMarkets.length>0);
 assert.deepEqual(after.allMarkets,before.allMarkets);
 assert.equal(after.opportunityScore,before.opportunityScore);
});
test('PostgreSQL roundtrip preserves nullable transport and rolls back test snapshot', {skip:process.env.LIVE_STATS_DB_TEST!=='1'},async()=>{
 require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();const rollback=new Error('ROLLBACK_TRANSPORT_TEST');
 try{
  const fixture=await db.fixture.findFirst({select:{id:true}});assert.ok(fixture);
  await assert.rejects(db.$transaction(async tx=>{
   const data=liveSnapshotCreateData(fixture.id,'transport-test-'+Date.now(),context(mapStats(raw)).match);
   const created=await tx.liveSnapshot.create({data});
   const stored=await tx.liveSnapshot.findUniqueOrThrow({where:{id:created.id}});
   assert.equal(stored.homeBigChances,1);assert.equal(stored.awayBigChances,0);assert.equal(stored.homeShotsInsideBox,3);assert.equal(stored.awayShotsInsideBox,2);
   const absent=await tx.liveSnapshot.create({data:liveSnapshotCreateData(fixture.id,'transport-null-'+Date.now(),context(mapStats([])).match)});
   assert.equal(absent.homeBigChances,null);assert.equal(absent.awayShotsInsideBox,null);
   throw rollback;
  }),e=>e===rollback);
 }finally{await db.$disconnect();}
});
