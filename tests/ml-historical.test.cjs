const {test}=require('node:test');const assert=require('node:assert/strict');
const {reconstruct,reconstructionInput,priorGame}=require('../src/services/ml/historicalReconstruction.ts');
const {calculateTeamHistoricalProfile}=require('../src/services/historical/teamProfile.ts');
const bounds={validationStart:'2023-07-01T00:00:00Z',testStart:'2024-07-01T00:00:00Z'};
function source(){
  const fixtures=Array.from({length:8},(_,i)=>({id:'f'+i,provider:'FOOTBALL_DATA',homeTeamId:'h',awayTeamId:'a',leagueId:'l',seasonId:'s',status:'FINISHED',
    kickoff:new Date(Date.UTC(2022,0,1+i*4,12)).toISOString(),kickoffPrecision:'EXACT',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'}));
  const periodStats=fixtures.flatMap(f=>['FULL_TIME','FIRST_HALF'].flatMap(period=>['h','a'].map(teamId=>({fixtureId:f.id,teamId,provider:'FOOTBALL_DATA',period,
    goals:period==='FULL_TIME'?(teamId==='h'?2:1):(teamId==='h'?1:0),shots:period==='FULL_TIME'?12:null,shotsOnTarget:period==='FULL_TIME'?4:null,
    corners:period==='FULL_TIME'?6:null,yellowCards:period==='FULL_TIME'?2:null,redCards:period==='FULL_TIME'?0:null,xg:null,receivedAt:'2026-10-01T00:00:00Z'}))));
  return {fixtures,periodStats,leagues:[{id:'l',name:'League'}],seasons:[{id:'s',key:'2021/22'}],teamStats:[],snapshots:[],marketSnapshots:[],odds:[]};
}
const target=s=>[...reconstruct(s,bounds)].find(r=>r.dataset==='PREMATCH_GOALS_V1'&&r.metadata.fixtureId==='f7');
test('offline reconstruction admits old results imported later with at least five prior venue matches',()=>{
  const row=target(source());assert.equal(row.metadata.eligible,true);assert.equal(row.features.home_HOME_5_avgGoalsFor,2);
  assert.equal(row.features.away_AWAY_5_avgGoalsAgainst,2);assert.equal(row.features.home_HOME_20_sampleSize,7);
  assert.equal(row.features.home_HOME_5_avgCards,2);assert.equal(row.features.home_HOME_5_cleanSheetRate,0);
  assert.equal(row.features.home_HOME_5_scoringStreak,5);assert.equal(row.features.home_HOME_5_scoringStreakCensored,1);
  assert.equal(row.features.home_daysSincePreviousMatch,4);
});
test('operational historical builder still rejects late imports',()=>{
  const s=source(),rows=s.fixtures.slice(0,7).map(f=>({...f,kickoff:new Date(f.kickoff),createdAt:new Date(f.createdAt),updatedAt:new Date(f.updatedAt),teamStats:[],periodStats:[]}));
  const p=calculateTeamHistoricalProfile('h',new Date(s.fixtures[7].kickoff),{window:5,venue:'HOME'},rows);assert.equal(p.sampleSize,0);
});
test('target FT mutation changes labels but not prematch features',()=>{
  const s=source(),before=target(s);s.periodStats.filter(p=>p.fixtureId==='f7'&&p.period==='FULL_TIME').forEach(p=>{p.goals=7;p.shots=100;});
  const after=target(s);assert.deepEqual(after.features,before.features);assert.notDeepEqual(after.labels,before.labels);
  for(const key of Object.keys(after.labels))assert.equal(Object.hasOwn(after.features,key),false);
});
test('later fixture mutations do not change earlier features',()=>{
  const s=source();const a=[...reconstruct(s,bounds)].filter(r=>r.metadata.fixtureId==='f5');
  s.periodStats.filter(p=>p.fixtureId==='f7').forEach(p=>p.goals=20);
  assert.deepEqual([...reconstruct(s,bounds)].filter(r=>r.metadata.fixtureId==='f5'),a);
});
test('same-day and previous-day games excluded; no synthetic final whistle',()=>{
  const f={id:'a',kickoff:'2022-01-01T23:00:00Z',status:'FINISHED'};
  assert.equal(priorGame(f,{id:'b',kickoff:'2022-01-02T00:00:00Z'}),false);
  assert.equal(priorGame(f,{id:'b',kickoff:'2022-01-03T12:00:00Z'}),true);
  assert.equal(priorGame(f,{...f}),false);
});
test('warmup is excluded without inventing five or twenty observations',()=>{
  const row=[...reconstruct(source(),bounds)][0];assert.equal(row.metadata.eligible,false);
  assert.equal(row.features.home_HOME_5_avgGoalsFor,null);assert.equal(row.features.home_HOME_20_sampleSize,0);
});
test('missing prior metric stays NULL instead of zero or replacing the match',()=>{
  const s=source();s.periodStats.find(p=>p.fixtureId==='f6'&&p.period==='FULL_TIME'&&p.teamId==='h').shots=null;
  assert.equal(target(s).features.home_HOME_5_avgShots,null);assert.equal(target(s).features.home_HOME_5_sampleSize,5);
});
test('HT current-fixture stats come exclusively from FIRST_HALF',()=>{
  const s=source();s.periodStats.find(p=>p.fixtureId==='f7'&&p.period==='FIRST_HALF'&&p.teamId==='h').shots=3;
  s.periodStats.find(p=>p.fixtureId==='f7'&&p.period==='FULL_TIME'&&p.teamId==='h').shots=999;
  const row=[...reconstruct(s,bounds)].find(r=>r.dataset==='HALFTIME_SECOND_HALF_V1'&&r.metadata.fixtureId==='f7');
  assert.equal(row.features.htHome_shots,3);assert.equal(row.features.htAway_shots,null);assert.equal(row.features.htGoals,1);
  assert.deepEqual(row.labels,{goal2H_1plus:1,goal2H_2plus:1,goal2H_3plus:0,goals2H:2});
});
test('unknown or inconsistent HT is not replaced with zero or FT',()=>{
  for(const goals of [null,10]) {
    const s=source();s.periodStats.find(p=>p.fixtureId==='f7'&&p.period==='FIRST_HALF'&&p.teamId==='h').goals=goals;
    assert.equal(target(s).labels.goals1H,null);
    const ht=[...reconstruct(s,bounds)].find(r=>r.dataset==='HALFTIME_SECOND_HALF_V1'&&r.metadata.fixtureId==='f7');assert.equal(ht.metadata.eligible,false);assert.equal(ht.labels.goals2H,null);
  }
});
test('canonical duplicates excluded, never split independently',()=>{
  const s=source();s.fixtures.push({...s.fixtures[7],id:'duplicate'});
  assert.equal(reconstructionInput(s).excluded.length,2);assert.equal(target(s),undefined);
});
test('DATE precision yields day gap but not exact fractional elapsed time',()=>{
  const s=source();s.fixtures[7].kickoffPrecision='DATE';const row=target(s);
  assert.equal(row.features.home_daysSincePreviousMatch,4);assert.equal(row.features.home_daysSincePreviousMatchExact,null);
});
test('partitions deterministic, ordered, fixture-shared across both datasets',()=>{
  const s=source();s.fixtures[7].kickoff='2024-07-01T12:00:00Z';
  const rows=[...reconstruct(s,bounds)],a=rows.filter(r=>r.metadata.fixtureId==='f7');assert.equal(a.length,2);assert.ok(a.every(r=>r.metadata.split==='test'));
  assert.deepEqual(rows,[...reconstruct({...s,fixtures:[...s.fixtures].reverse()},bounds)]);
});
