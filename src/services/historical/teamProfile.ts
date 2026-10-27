import type { PrismaClient } from '@prisma/client';

export type ProfileOptions={window:5|10|20;venue?:'ALL'|'HOME'|'AWAY';competitionId?:string};
type Stats={teamId:string;goals:number|null;shots:number|null;shotsOnTarget:number|null;corners:number|null;yellowCards:number|null;redCards:number|null;fouls:number|null};
export type ProfileFixture={id:string;provider:string;leagueId:string;homeTeamId:string;awayTeamId:string;kickoff:Date;kickoffPrecision:string;status:string;createdAt:Date;updatedAt:Date;
 teamStats:(Stats&{createdAt:Date;updatedAt:Date})[];
 periodStats:(Stats&{provider:string;period:string;receivedAt:Date})[]};
const count=(v:unknown):number|null=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
function parameters(teamId:string,before:Date,options:ProfileOptions){
 if(!teamId||!Number.isFinite(before.getTime())||![5,10,20].includes(options.window)||!['ALL','HOME','AWAY'].includes(options.venue??'ALL'))throw Error('INVALID_PROFILE_OPTIONS');
}
/** Pure aggregation. Averages/rates require complete coverage of the selected sample. */
export function calculateTeamHistoricalProfile(teamId:string,before:Date,options:ProfileOptions,rows:ProfileFixture[]){
 parameters(teamId,before,options);const venue=options.venue??'ALL',cutoff=before.getTime(),day=Date.parse(before.toISOString().slice(0,10)+'T00:00:00Z');
 const eligible=rows.filter(f=>f.status==='FINISHED'&&f.kickoff.getTime()<cutoff&&f.createdAt.getTime()<cutoff&&f.updatedAt.getTime()<cutoff
  &&(f.kickoffPrecision==='EXACT'||f.kickoffPrecision==='DATE'&&f.kickoff.getTime()<day)
  &&(venue==='HOME'?f.homeTeamId===teamId:venue==='AWAY'?f.awayTeamId===teamId:f.homeTeamId===teamId||f.awayTeamId===teamId)
  &&(!options.competitionId||f.leagueId===options.competitionId));
 const fixtures=[...new Map(eligible.map(f=>[f.id,f])).values()].sort((a,b)=>b.kickoff.getTime()-a.kickoff.getTime()||a.id.localeCompare(b.id)).slice(0,options.window);
 const stats=(f:ProfileFixture,id:string,period:string)=>{
  const p=f.periodStats.filter(s=>s.teamId===id&&s.provider===f.provider&&s.period===period&&s.receivedAt.getTime()<cutoff);
  if(p.length===1)return p[0];if(p.length>1||period!=='FULL_TIME')return null;
  const s=f.teamStats.filter(s=>s.teamId===id&&s.createdAt.getTime()<cutoff&&s.updatedAt.getTime()<cutoff);return s.length===1?s[0]:null;
 };
 const data=fixtures.map(f=>{const opponent=f.homeTeamId===teamId?f.awayTeamId:f.homeTeamId;return{ft:stats(f,teamId,'FULL_TIME'),against:stats(f,opponent,'FULL_TIME'),ht:stats(f,teamId,'FIRST_HALF'),htAgainst:stats(f,opponent,'FIRST_HALF')};});
 const n=data.length,coverage:Record<string,{available:number;missing:number;ratio:number|null}>={};
 const record=(key:string,values:(number|null)[])=>{const known=values.filter((v):v is number=>v!==null);coverage[key]={available:known.length,missing:n-known.length,ratio:n?known.length/n:null};return n>0&&known.length===n?known:null;};
 const gf=data.map(r=>count(r.ft?.goals)),ga=data.map(r=>count(r.against?.goals));
 const pair=(a:number|null,b:number|null,fn:(a:number,b:number)=>number)=>a===null||b===null?null:fn(a,b);
 const ft=record('ft',gf.map((v,i)=>pair(v,ga[i],(a,b)=>a+b)));
 const ht=record('ht',data.map(r=>pair(count(r.ht?.goals),count(r.htAgainst?.goals),(a,b)=>a+b)));
 const own=record('goalsFor',gf),opp=record('goalsAgainst',ga);
 const sum=(v:number[]|null)=>v?v.reduce((a,b)=>a+b,0):null;
 const avg=(v:number[]|null)=>v?sum(v)!/v.length:null;
 const rate=(v:number[]|null,fn:(n:number)=>boolean)=>v?v.filter(fn).length/v.length:null;
 const outcomes=ft?gf.map((v,i)=>Math.sign(v!-ga[i]!)):null;
 const metric=(key:keyof Omit<Stats,'teamId'|'goals'>)=>avg(record(key,data.map(r=>count(r.ft?.[key]))));
 const streak=(values:(number|null)[])=>{if(!values.length)return{value:null,censored:false};let value=0;for(const v of values){if(v===null)return{value:null,censored:false};if(v===0)return{value,censored:false};value++;}return{value,censored:true};};
 const scoring=streak(gf),conceding=streak(ga);
 const features={matches:n,wins:outcomes?outcomes.filter(x=>x>0).length:null,draws:outcomes?outcomes.filter(x=>x===0).length:null,losses:outcomes?outcomes.filter(x=>x<0).length:null,
  goalsFor:sum(own),goalsAgainst:sum(opp),avgGoalsFor:avg(own),avgGoalsAgainst:avg(opp),scoredRate:rate(own,x=>x>0),concededRate:rate(opp,x=>x>0),cleanSheetRate:rate(opp,x=>x===0),
  bttsRate:ft?gf.filter((v,i)=>v!>0&&ga[i]!>0).length/n:null,over05FtRate:rate(ft,x=>x>0.5),over15FtRate:rate(ft,x=>x>1.5),over25FtRate:rate(ft,x=>x>2.5),over05HtRate:rate(ht,x=>x>0.5),over15HtRate:rate(ht,x=>x>1.5),
  avgShots:metric('shots'),avgShotsOnTarget:metric('shotsOnTarget'),avgCorners:metric('corners'),avgYellowCards:metric('yellowCards'),avgRedCards:metric('redCards'),avgFouls:metric('fouls'),scoringStreak:scoring.value,concedingStreak:conceding.value};
 return{teamId,before:before.toISOString(),window:options.window,venue,competitionId:options.competitionId??null,sampleSize:n,coverage,oldestFixtureDate:fixtures.at(-1)?.kickoff.toISOString()??null,newestFixtureDate:fixtures[0]?.kickoff.toISOString()??null,fixtureIds:fixtures.map(f=>f.id),features,streakCensored:{scoring:scoring.censored,conceding:conceding.censored},availabilityPolicy:'OBSERVED_BEFORE_CUTOFF',minimumCoverage:1};
}
/** Bounded DB reader. Injection permits tests without a database or network. */
async function readTeamHistoricalFixtures(db:Pick<PrismaClient,'fixture'>,teamId:string,before:Date,options:ProfileOptions){
  parameters(teamId,before,options);const venue=options.venue??'ALL';
  const team=venue==='HOME'?{homeTeamId:teamId}:venue==='AWAY'?{awayTeamId:teamId}:{OR:[{homeTeamId:teamId},{awayTeamId:teamId}]};
  const metrics={teamId:true,goals:true,shots:true,shotsOnTarget:true,corners:true,yellowCards:true,redCards:true,fouls:true} as const;
  const rows=await db.fixture.findMany({where:{AND:[team,{status:'FINISHED',kickoff:{lt:before},createdAt:{lt:before},updatedAt:{lt:before},...(options.competitionId?{leagueId:options.competitionId}:{})},
   {OR:[{kickoffPrecision:'EXACT'},{kickoffPrecision:'DATE',kickoff:{lt:new Date(before.toISOString().slice(0,10)+'T00:00:00Z')}}]}]},orderBy:[{kickoff:'desc'},{id:'asc'}],take:options.window,
   select:{id:true,provider:true,leagueId:true,homeTeamId:true,awayTeamId:true,kickoff:true,kickoffPrecision:true,status:true,createdAt:true,updatedAt:true,
    teamStats:{select:{...metrics,createdAt:true,updatedAt:true}},periodStats:{where:{period:{in:['FIRST_HALF','FULL_TIME']},receivedAt:{lt:before}},select:{...metrics,provider:true,period:true,receivedAt:true}}}});
  return rows;
}
export function createTeamHistoricalProfileBuilder(db:Pick<PrismaClient,'fixture'>){
 return async(teamId:string,before:Date,options:ProfileOptions)=>calculateTeamHistoricalProfile(teamId,before,options,await readTeamHistoricalFixtures(db,teamId,before,options));
}
export function createTeamHistoricalProfileSetBuilder(db:Pick<PrismaClient,'fixture'>){
 return async(teamId:string,before:Date,venue:NonNullable<ProfileOptions['venue']>)=>{
  const rows=await readTeamHistoricalFixtures(db,teamId,before,{window:20,venue});
  return ([5,10,20] as const).map(window=>calculateTeamHistoricalProfile(teamId,before,{window,venue},rows));
 };
}
export async function buildTeamHistoricalProfile(teamId:string,before:Date,options:ProfileOptions){
 const {prisma}=await import('../../lib/prisma');return createTeamHistoricalProfileBuilder(prisma)(teamId,before,options);
}
