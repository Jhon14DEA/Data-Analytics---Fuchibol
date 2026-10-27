import { classifyCompetition, scopeBinding, HISTORICAL_SCOPE, type ScopeBinding } from './scope';
import { METRICS, type HistoricalBatch, type HistoricalFixture } from './types';
import { PERIODS, seasonKey } from './normalize';
export function validateBatch(b:HistoricalBatch,bindings:readonly ScopeBinding[]=HISTORICAL_SCOPE,now=new Date()) {
  if(!b||!['API-Football','AllSportsApi','FOOTBALL_DATA'].includes(b.provider)||!b.competition||!b.season)throw Error('INVALID_BATCH');
  const binding=scopeBinding(b.provider,b.competition,bindings);if(!binding)throw Error('COMPETITION_NOT_ALLOWLISTED');
  const classification=classifyCompetition(b.competition,binding);if(classification.classification!=='MEN_SENIOR')throw Error('NOT_MEN_SENIOR');
  const key=seasonKey(b.season.key);if(key!==b.season.key||!b.season.label?.trim())throw Error('INVALID_SEASON_KEY');
  if(b.season.startsAt&&!Number.isFinite(Date.parse(b.season.startsAt))||b.season.endsAt&&!Number.isFinite(Date.parse(b.season.endsAt))||b.season.startsAt&&b.season.endsAt&&Date.parse(b.season.startsAt)>Date.parse(b.season.endsAt))throw Error('INVALID_SEASON_DATES');
  const from=Date.parse(b.rangeFrom),to=Date.parse(b.rangeTo),received=Date.parse(b.receivedAt);
  const maxDays=b.provider==='FOOTBALL_DATA'?366:7;
  if(![from,to,received].every(Number.isFinite)||to<from||to-from>maxDays*86400000||to>now.getTime()||received>now.getTime()||received<to)throw Error('INVALID_BATCH_CLOCK');
  if(!Array.isArray(b.fixtures)||b.fixtures.length>50)throw Error('BATCH_LIMIT_EXCEEDED');
  if(b.cursor!==null&&typeof b.cursor!=='string'||b.nextCursor!==null&&(typeof b.nextCursor!=='string'||b.nextCursor===b.cursor))throw Error('INVALID_CURSOR');
  return{binding,classification};
}
export function fixtureIssue(f:HistoricalFixture,b:HistoricalBatch):string|null {
  if(!f||!f.id||f.status!=='FINISHED')return 'NOT_FINISHED';
  if(f.competitionId!==b.competition.id||f.seasonKey!==b.season.key)return 'WRONG_SCOPE';
  const kickoff=Date.parse(f.kickoff);if(!Number.isFinite(kickoff)||kickoff<Date.parse(b.rangeFrom)||kickoff>Date.parse(b.rangeTo))return 'KICKOFF_OUTSIDE_RANGE';
  if(!f.home?.id||!f.away?.id||f.home.id===f.away.id||!f.home.name?.trim()||!f.away.name?.trim())return 'INVALID_TEAM_IDENTITY';
  if(!Array.isArray(f.periods)||new Set(f.periods.map(p=>p.period)).size!==f.periods.length)return 'AMBIGUOUS_PERIOD';
  for(const p of f.periods) {
    if(!PERIODS.includes(p.period)||!p.source)return 'UNSUPPORTED_PERIOD';
    for(const side of ['home','away'] as const)for(const m of METRICS){const n=p[side]?.[m];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||(!['xg','possession'].includes(m)&&!Number.isInteger(n))||m==='possession'&&n>100))return 'INVALID_METRIC';}
  }
  const ft=f.periods.find(p=>p.period==='FULL_TIME');if(!ft||ft.home.goals===null||ft.away.goals===null)return 'UNKNOWN_FINAL_SCORE';
  const ht=f.periods.find(p=>p.period==='FIRST_HALF');
  if(ht&&(['home','away'] as const).some(s=>ht[s].goals!==null&&ht[s].goals!>ft[s].goals!))return 'INCONSISTENT_PERIOD_SCORE';
  if((f.events?.length??0)>500||(f.players?.length??0)>100||(f.odds?.length??0)>500||(f.markets?.length??0)>100)return 'DETAIL_LIMIT_EXCEEDED';
  if(f.markets?.some(s=>!['TOTAL_GOALS','BTTS','TEAM_GOALS','CORNERS','CARDS'].includes(s.market)||!PERIODS.includes(s.period)||!['OVER','UNDER','YES','NO'].includes(s.selection)||!['HOME','AWAY','BOTH'].includes(s.side)||typeof s.rules!=='string'||s.line!==null&&(typeof s.line!=='number'||!Number.isFinite(s.line)||s.line<0||s.line>9999)))return 'INVALID_MARKET_SPEC';
  return null;
}
