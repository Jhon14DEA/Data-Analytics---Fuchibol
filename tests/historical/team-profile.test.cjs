const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculateTeamHistoricalProfile:calc,createTeamHistoricalProfileBuilder}=require('../../src/services/historical/teamProfile.ts');
const before=new Date('2025-02-01T12:00:00Z'),observed=new Date('2025-01-01');
function row(i,home=true,gf=2,ga=1){const f={id:String(i).padStart(3,'0'),provider:'FOOTBALL_DATA',leagueId:'league',homeTeamId:home?'team':'opp',awayTeamId:home?'opp':'team',kickoff:new Date(Date.UTC(2025,0,i+1)),kickoffPrecision:'EXACT',status:'FINISHED',createdAt:observed,updatedAt:observed,teamStats:[],periodStats:[]};
 for(const period of ['FULL_TIME','FIRST_HALF'])for(const [teamId,goals]of [['team',gf],['opp',ga]])f.periodStats.push({teamId,provider:f.provider,period,goals:period==='FIRST_HALF'?Math.min(goals,1):goals,shots:10,shotsOnTarget:4,corners:6,yellowCards:2,redCards:0,fouls:12,receivedAt:observed});return f;}
const profile=(rows,options={window:5})=>calc('team',before,options,rows);
test('latest N sorted, deterministic, deduplicated and bounded',()=>{
 const rows=Array.from({length:25},(_,i)=>row(i));
 for(const window of [5,10,20]){const p=profile(rows,{window});assert.equal(p.sampleSize,window);assert.equal(p.fixtureIds[0],'024');assert.deepEqual(profile([...rows].reverse(),{window}),p);assert.deepEqual(profile([...rows,rows[0]],{window}),p);}
});
test('home away and competition filter precede window',()=>{
 const rows=Array.from({length:10},(_,i)=>row(i,i%2===0));
 assert.deepEqual(profile(rows,{window:5,venue:'HOME'}).fixtureIds,['008','006','004','002','000']);
 assert.deepEqual(profile(rows,{window:5,venue:'AWAY'}).fixtureIds,['009','007','005','003','001']);
 assert.equal(profile(rows,{window:5,competitionId:'other'}).sampleSize,0);
});
test('FT HT outcomes, rates and stats use explicit period values',()=>{
 const p=profile([row(1,true,2,1),row(2,true,0,0),row(3,true,0,2)]),f=p.features;
 assert.deepEqual([f.wins,f.draws,f.losses],[1,1,1]);assert.equal(f.goalsFor,2);assert.equal(f.goalsAgainst,3);assert.equal(f.avgGoalsFor,2/3);
 assert.equal(f.bttsRate,1/3);assert.equal(f.over25FtRate,1/3);assert.equal(f.over15HtRate,1/3);assert.equal(f.over05HtRate,2/3);
 assert.equal(f.cleanSheetRate,1/3);assert.equal(f.avgCorners,6);assert.equal(f.avgYellowCards,2);assert.equal(f.avgRedCards,0);assert.equal(f.avgFouls,12);
 assert.equal(p.coverage.ft.ratio,1);assert.equal(p.oldestFixtureDate,row(1).kickoff.toISOString());
});
test('missing coverage stays NULL, zero denominator never produces rates',()=>{
 const a=row(1);a.periodStats.find(s=>s.teamId==='team'&&s.period==='FULL_TIME').shots=null;a.periodStats=a.periodStats.filter(s=>s.period!=='FIRST_HALF');
 const p=profile([a,row(2)]);assert.equal(p.features.avgShots,null);assert.equal(p.coverage.shots.ratio,0.5);assert.equal(p.features.over05HtRate,null);
 const empty=profile([]);assert.equal(empty.features.bttsRate,null);assert.equal(empty.features.goalsFor,null);assert.equal(empty.coverage.ft.ratio,null);assert.equal(empty.oldestFixtureDate,null);
});
test('current, future, later observations and uncertain same-day fixtures excluded',()=>{
 const equal=row(2),future=row(3),late=row(4),date=row(5);equal.kickoff=before;future.kickoff=new Date(before.getTime()+1);late.updatedAt=new Date(before.getTime()+1);date.kickoffPrecision='DATE';date.kickoff=new Date('2025-02-01');
 const p=profile([row(1),equal,future,late,date]);assert.deepEqual(p.fixtureIds,['001']);
 const lateStats=row(6);lateStats.periodStats.forEach(s=>s.receivedAt=before);assert.equal(profile([lateStats]).features.goalsFor,null);
});
test('streaks break at zero, unknown prevents inference, window cap is marked',()=>{
 assert.equal(profile([row(1,true,0,0),row(2),row(3)]).features.scoringStreak,2);
 const p=profile([row(1),row(2)]);assert.equal(p.features.concedingStreak,2);assert.equal(p.streakCensored.conceding,true);
 const unknown=row(2);unknown.periodStats.find(s=>s.teamId==='team'&&s.period==='FULL_TIME').goals=null;assert.equal(profile([row(1),unknown]).features.scoringStreak,null);
});
test('reader issues one bounded findMany with strict timestamp and venue predicates',async()=>{
 let calls=0;const build=createTeamHistoricalProfileBuilder({fixture:{findMany:async q=>{calls++;assert.equal(q.take,20);assert.deepEqual(q.orderBy,[{kickoff:'desc'},{id:'asc'}]);assert.equal(q.where.AND[0].homeTeamId,'team');assert.equal(q.where.AND[1].kickoff.lt,before);assert.equal(q.where.AND[1].leagueId,'league');return[row(1)];}}});
 assert.equal((await build('team',before,{window:20,venue:'HOME',competitionId:'league'})).sampleSize,1);assert.equal(calls,1);
 await assert.rejects(build('team',before,{window:100}),/INVALID_PROFILE/);
});
test('foreign provenance cannot supply HT and malformed N/D never becomes zero',()=>{
 const f=row(1);f.periodStats.filter(s=>s.period==='FIRST_HALF').forEach(s=>s.provider='OTHER');
 f.periodStats.find(s=>s.teamId==='team'&&s.period==='FULL_TIME').corners='N/D';
 const p=profile([f]);assert.equal(p.features.over05HtRate,null);assert.equal(p.features.avgCorners,null);assert.equal(p.coverage.corners.available,0);
});
test('fallback FT requires observed timestamps and never reads default fixture score',()=>{
 const f=row(1);f.periodStats=[];f.homeScore=0;f.awayScore=0;
 assert.equal(profile([f]).features.goalsFor,null);
 f.teamStats=[{teamId:'team',goals:3,shots:0,shotsOnTarget:0,corners:0,yellowCards:0,redCards:0,fouls:0,createdAt:observed,updatedAt:observed}];
 assert.equal(profile([f]).features.goalsFor,3);assert.equal(profile([f]).features.avgShots,0);
 f.teamStats[0].updatedAt=before;assert.equal(profile([f]).features.goalsFor,null);
});
