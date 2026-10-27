const {test}=require('node:test'),assert=require('node:assert/strict');
const {FootballDataCsvProvider}=require('../../src/services/historical/footballDataCsv.ts');
const {EPL_SEASONS,expectedFootballDataFixtures}=require('../../src/services/historical/eplBackfill.ts');
test('D1 uses the documented public URL and 306 fixtures for each supported season',async()=>{
 for(const season of EPL_SEASONS)assert.equal(expectedFootballDataFixtures('D1',season),306);
 let calls=0;
 const p=await FootballDataCsvProvider.download('D1','2425',async(url)=>{
  calls++;assert.equal(url,'https://football-data.co.uk/mmz4281/2425/D1.csv');
  return new Response('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nD1,19/08/2024,A,B,1,0\n');
 });
 assert.equal(calls,1);assert.equal(p.pages[0].competition.country,'Germany');assert.equal(p.pages[0].competition.name,'Bundesliga');
});
