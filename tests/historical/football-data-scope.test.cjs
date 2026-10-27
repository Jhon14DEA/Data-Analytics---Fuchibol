const {test}=require('node:test'),assert=require('node:assert/strict');
const {FootballDataCsvProvider}=require('../../src/services/historical/footballDataCsv.ts');
const {scopeBinding}=require('../../src/services/historical/scope.ts');
const {validateBatch}=require('../../src/services/historical/validation.ts');
for(const code of ['E0','SP1','I1','F1','D1'])test(`${code} provider metadata passes the existing worker allowlist`,()=>{
 const provider=new FootballDataCsvProvider(`Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\n${code},19/08/00,A,B,1,0\n`,code,'0001');
 const page=provider.pages[0];assert.equal(validateBatch(page).binding.id,code);
 assert.equal(scopeBinding('FOOTBALL_DATA',{...page.competition,country:'Other'}),null);
 assert.equal(scopeBinding('FOOTBALL_DATA',{...page.competition,id:'UNKNOWN'}),null);
 assert.equal(scopeBinding('AllSportsApi',page.competition),null);
});
