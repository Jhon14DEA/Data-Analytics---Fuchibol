const {test}=require('node:test'),assert=require('node:assert/strict');
const {FootballDataCsvProvider,footballDataSeason}=require('../../src/services/historical/footballDataCsv.ts');
const {initializeEplBackfill,runEplSeason,expectedFootballDataFixtures}=require('../../src/services/historical/eplBackfill.ts');
test('competition identities and absent fields remain isolated',()=>{
 const ids=[];
 for(const [code,country]of [['E0','England'],['SP1','Spain'],['I1','Italy'],['F1','France']]){
  const p=new FootballDataCsvProvider(`Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\n${code},19/08/00,A,B,1,0\n`,code,'0001');
  assert.equal(p.pages[0].competition.id,code);assert.equal(p.pages[0].competition.country,country);
  assert.equal(p.fixtures[0].periods[1].home.shots,null);assert.equal(p.fixtures[0].historicalKickoffAt,null);
  ids.push(p.fixtures[0].id);assert.ok(p.fixtures[0].home.id.startsWith(country+':'));
 }
 assert.equal(new Set(ids).size,4);
 assert.throws(()=>new FootballDataCsvProvider('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nSP1,19/08/00,A,B,1,0\n','I1','0001'),/WRONG_COMPETITION/);
 for(const code of ['D2','__proto__','../SP1'])assert.throws(()=>footballDataSeason(code,'2425'));
});
test('season validation accounts for format changes and curtailed France season',()=>{
 for(const code of ['E0','SP1'])assert.equal(expectedFootballDataFixtures(code,'0001'),380);
 assert.equal(expectedFootballDataFixtures('I1','0304'),306);assert.equal(expectedFootballDataFixtures('I1','0405'),380);
 assert.equal(expectedFootballDataFixtures('F1','0102'),306);assert.equal(expectedFootballDataFixtures('F1','0203'),380);
 assert.equal(expectedFootballDataFixtures('F1','1920'),279);assert.equal(expectedFootballDataFixtures('F1','2324'),306);
});
test('checkpoint creation is scoped to competition for all 25 seasons',async()=>{
 for(const competition of ['SP1','I1','F1']){
  let count=0;
  const db={league:{upsert:async q=>{assert.equal(q.create.externalId,competition);return{id:competition}}},season:{upsert:async q=>{assert.equal(q.create.leagueId,competition);return{id:q.create.providerSeasonId}}},historicalIngestionState:{upsert:async q=>{assert.equal(q.create.leagueId,competition);assert.equal(q.create.backfillMetadata.status,'PENDING');count++;}}};
  await initializeEplBackfill(db,competition);assert.equal(count,25);
 }
});
test('cross-competition source is rejected before worker persistence',async()=>{
 const p=new FootballDataCsvProvider('Date,HomeTeam,AwayTeam,FTHG,FTAG\n19/08/00,A,B,1,0\n','SP1','0001');
 const db={historicalIngestionState:{findFirstOrThrow:async q=>{assert.equal(q.where.league.externalId,'I1');return{id:'s',seasonId:'s',status:'READY'}},update:async()=>{}},fixture:{findMany:async()=>[],count:async()=>0},teamMatchStats:{aggregate:async()=>({_count:{_all:0}})},teamPeriodStats:{count:async()=>0},historicalMarketOutcome:{count:async()=>0},historicalOddsQuote:{count:async()=>0}};
 const result=await runEplSeason(db,'0001',async()=>p,'I1');assert.equal(result.status,'FAILED');assert.equal(result.error,'CSV_WRONG_SEASON');
});
