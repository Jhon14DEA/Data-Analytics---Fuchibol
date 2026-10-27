const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyFixtureTeamAnchor:verify,selectHistoricalBridge:bridge,mappingConflict,preserveFixtureAnchoredTeams}=require('../../src/services/historical/fixtureAnchoredTeams.ts');
const raw={fixture:{id:123,date:'2026-10-12T18:45:00+00:00',timestamp:1791830700},teams:{home:{id:503,name:'Torino'},away:{id:494,name:'Udinese'}},league:{id:135,name:'Serie A',country:'Italy'}};
const source={provider:'AllSportsApi',externalId:'1',kickoff:new Date(raw.fixture.date),kickoffPrecision:'EXACT',homeTeam:{externalId:'11',name:' Torino ',country:null},awayTeam:{externalId:'12',name:'Udinese',country:null},league:{name:'Serie A',country:null}};
test('confirmed oriented names, league, country and UTC match',()=>assert.equal(verify(source,'123',raw),true));
test('swapped sides, wrong league, naive time, timestamp contradiction or wrong IDs reject',()=>{
 for(const r of [{...raw,teams:{home:raw.teams.away,away:raw.teams.home}},{...raw,league:{...raw.league,name:'Serie B'}},{...raw,fixture:{...raw.fixture,date:'2026-10-12T18:45:00'}},{...raw,fixture:{...raw.fixture,timestamp:1}},{...raw,fixture:{...raw.fixture,id:999}},{...raw,teams:{...raw.teams,away:raw.teams.home}}])assert.equal(verify(source,'123',r),false);
 assert.equal(verify({...source,kickoff:new Date('2026-10-12T13:45:00Z')},'123',raw),false);
});
test('country-constrained exact/explicit alias bridges and ambiguities never guess',()=>{
 const teams=[{externalId:'x',name:'Torino',country:'Italy'}];assert.equal(bridge({name:'Torino',country:'Italy'},teams).status,'MAPPED');assert.equal(bridge({name:'Torino',country:'Brazil'},teams).status,'NO_MATCH');assert.equal(bridge({name:'Torino',country:'Italy'},[...teams,{...teams[0],externalId:'y'}]).status,'AMBIGUOUS');
 assert.equal(bridge({name:'Inter Milan',country:'Italy'},[{externalId:'inter',name:'Inter',country:'Italy'}]).alias,true);
 assert.equal(bridge({name:'Torino FC',country:'Italy'},teams).status,'NO_MATCH');
});
test('mapping conflicts fenced in either orientation',()=>{const a={provider:'AllSportsApi',id:'1'},b={provider:'API-Football',id:'2'};assert.equal(mappingConflict(a,b,[{kind:'TEAM',leftProvider:b.provider,leftExternalId:b.id,rightProvider:a.provider,rightExternalId:'other'}]),true);});
test('persistent anchors create six mappings then reuse without duplicate teams',async()=>{
 const links=[],teams=[];const historical=[{externalId:'Italy:torino',name:'Torino',country:'Italy'},{externalId:'Italy:udinese',name:'Udinese',country:'Italy'}];
 const tx={$executeRaw:async()=>0,fixture:{findUnique:async()=>source},hybridScout:{findUnique:async()=>({apiFootballFixtureId:'123',allSportsFixtureId:'1',identity:{home:'Torino',away:'Udinese',league:'Serie A'}}),count:async()=>0},providerEntityMapping:{findMany:async q=>q.where.kind==='TEAM'?[...links]:[],create:async({data})=>{const r={...data,id:String(links.length)};links.push(r);return r;}},team:{findMany:async()=>historical,findUnique:async({where})=>teams.find(t=>t.externalId===where.provider_externalId.externalId),create:async({data})=>{teams.push(data);return data;}}};
 const db={$transaction:async fn=>fn(tx)};const a=await preserveFixtureAnchoredTeams(db,'fixture',raw,'2026-10-12T20:00:00Z');assert.equal(a.allSportsApiCreated,2);assert.equal(a.apiFootballDataCreated,2);assert.equal(a.allSportsFootballDataCreated,2);
 const b=await preserveFixtureAnchoredTeams(db,'fixture',raw,'2026-10-12T20:00:00Z');assert.equal(b.reused,6);assert.equal(links.length,6);assert.equal(teams.length,2);
});
