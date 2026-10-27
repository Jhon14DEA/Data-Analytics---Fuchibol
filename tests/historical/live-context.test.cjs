const {test}=require('node:test'),assert=require('node:assert/strict');
const {mappedHistoricalTeam,createLiveHistoricalContextReader,historicalComparison}=require('../../src/services/historical/liveContext.ts');
const {calculateTeamHistoricalProfile}=require('../../src/services/historical/teamProfile.ts');
const cutoff=new Date('2025-02-01'),observed=new Date('2025-01-01');
const match={id:'live',source:'allsports',homeTeamExternalId:'1',awayTeamExternalId:'2',homeTeam:'A',awayTeam:'B',competition:'League',status:'LIVE',minute:20,score:{home:0,away:0},kickoffAt:cutoff.toISOString()};
const maps=['1','2'].map(id=>({kind:'TEAM',leftProvider:'AllSportsApi',leftExternalId:id,rightProvider:'FOOTBALL_DATA',rightExternalId:'historical-'+id,method:'VERIFIED_PROVIDER_ID',createdAt:observed}));
test('mapping uses exact provider IDs, both directions, rejects ambiguity and future maps',()=>{
 assert.equal(mappedHistoricalTeam('AllSportsApi','1',maps,cutoff),'historical-1');
 const reverse={...maps[0],leftProvider:'FOOTBALL_DATA',leftExternalId:'historical-1',rightProvider:'AllSportsApi',rightExternalId:'1'};
 assert.equal(mappedHistoricalTeam('AllSportsApi','1',[reverse],cutoff),'historical-1');
 assert.equal(mappedHistoricalTeam('AllSportsApi','1',[...maps,{...maps[0],rightExternalId:'other'}],cutoff),null);
 assert.equal(mappedHistoricalTeam('AllSportsApi','1',[{...maps[0],createdAt:cutoff}],cutoff),null);
});
test('no mapping returns N/D and never reads fixtures or calls HTTP',async()=>{
 const read=createLiveHistoricalContextReader({providerEntityMapping:{findMany:async()=>[]},team:{findMany:()=>{throw Error('unexpected')}},fixture:{findMany:()=>{throw Error('unexpected')}}});
 const p=await read(match);assert.equal(p.status,'N/D');assert.equal(p.comparison.OVER05_FT,null);
});
test('mapped context yields 12 profiles from four bounded reads without mutating decisions',async()=>{
 const candidate=Object.freeze({BET_SCORE:8,entry:'NO_ENTRY',decision:'NO_ALERT',threshold:7});
 const input=Object.freeze({...match,candidate});const before=JSON.stringify(input);let reads=0;
 const db={providerEntityMapping:{findMany:async()=>maps},team:{findMany:async()=>maps.map((m,i)=>({id:'t'+i,externalId:m.rightExternalId}))},fixture:{findMany:async q=>{reads++;assert.equal(q.take,20);assert.equal(q.where.AND[1].kickoff.lt.toISOString(),match.kickoffAt);return[];}}};
 const p=await createLiveHistoricalContextReader(db)(input);assert.equal(reads,4);assert.equal(p.home.length,6);assert.equal(p.away.length,6);assert.equal(p.home[0].features.avgCorners,null);assert.equal(JSON.stringify(input),before);assert.strictEqual(input.candidate,candidate);
});
test('failures and demo cannot affect radar decision fields',async()=>{
 const read=createLiveHistoricalContextReader({providerEntityMapping:{findMany:async()=>{throw Error('DB DOWN')}},team:{},fixture:{}});
 assert.equal((await read(match)).reason,'HISTORICAL_READ_FAILED');assert.equal((await read({...match,source:'demo'})).reason,'NOT_REAL_LIVE');
});
test('informational comparisons require observed sample and explicit market coverage',()=>{
 const p=calculateTeamHistoricalProfile('team',cutoff,{window:10},[]);
 assert.equal(historicalComparison(p,p,'OVER05_1H'),null);
 const high={...p,sampleSize:10,features:{...p.features,over05HtRate:0.8,over05FtRate:0.9}},low={...high,features:{...high.features,over05HtRate:0.2,over05FtRate:0.1}};
 assert.equal(historicalComparison(high,high,'OVER05_1H'),'HISTÓRICO APOYA');assert.equal(historicalComparison(low,low,'OVER05_FT'),'HISTÓRICO CONTRADICE');assert.equal(historicalComparison(high,low,'OVER05_FT'),'HISTÓRICO NEUTRO');
 assert.equal(historicalComparison({...high,features:{...high.features,over05HtRate:null}},high,'OVER05_1H'),null);
});
