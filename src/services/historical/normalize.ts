import type { HistoricalPeriod } from '@prisma/client';
import { knownNumber } from '../training/observation';
import { METRICS, type Metrics, type HistoricalFixture, type PeriodStats } from './types';
export function historicalMetrics(values: Partial<Record<keyof Metrics, unknown>>): Metrics {
  return Object.fromEntries(METRICS.map(k=>{
    const raw=k==='possession'&&typeof values[k]==='string'?(values[k] as string).replace(/%$/,''):values[k];
    const n=knownNumber(raw,!['xg','possession'].includes(k));return[k,k==='possession'&&n!==null&&n>100?null:n];
  })) as Metrics;
}
export function seasonKey(value: unknown): string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw Error('INVALID_SEASON_KEY');
  return value.normalize('NFKC').trim(); // No kickoff-year inference, no collapse of Apertura/Clausura.
}
type ApiRaw = {fixture:{id:number;date:string;status:{short:string}};league:{id:number;season:number|string};teams:{home:{id:number;name:string};away:{id:number;name:string}};score:{halftime?:{home:unknown;away:unknown};fulltime?:{home:unknown;away:unknown}}};
type ApiStats = {team:{id:number};statistics:{type:string;value:unknown}[]}[];
// Pure adapter for already supplied API-Football payloads. No HTTP or web persistence hooks.
export function normalizeApiFootballFixture(raw: ApiRaw, season: string, statistics: ApiStats=[]): HistoricalFixture | null {
  if(raw.fixture.status.short!=='FT')return null; // AET/PEN cannot be silently treated as regulation FT.
  const periods:PeriodStats[]=[];
  const aliases: Record<string,keyof Metrics>={'total shots':'shots','shots on goal':'shotsOnTarget','expected_goals':'xg','corner kicks':'corners','yellow cards':'yellowCards','red cards':'redCards','fouls':'fouls','ball possession':'possession','dangerous attacks':'dangerousAttacks'};
  for(const [period,score]of [['FIRST_HALF',raw.score.halftime],['FULL_TIME',raw.score.fulltime]] as const){
    const side=(s:'home'|'away')=>{
      const values:Partial<Record<keyof Metrics,unknown>>={goals:score?.[s]};
      if(period==='FULL_TIME')for(const stat of statistics.find(x=>x.team.id===raw.teams[s].id)?.statistics??[]) {const key=aliases[stat.type.toLowerCase()];if(key)values[key]=stat.value;}
      return historicalMetrics(values);
    };
    periods.push({period,home:side('home'),away:side('away'),source:'API_EXPLICIT_SCORE_AND_FULL_TIME_STATISTICS'});
  }
  const [ht,ft]=periods;
  const second=(s:'home'|'away')=>historicalMetrics({goals:ht[s].goals!==null&&ft[s].goals!==null&&ft[s].goals!>=ht[s].goals!?ft[s].goals!-ht[s].goals!:null});
  periods.push({period:'SECOND_HALF',home:second('home'),away:second('away'),source:'REGULATION_FT_MINUS_EXPLICIT_HT_GOALS_ONLY'});
  return{id:String(raw.fixture.id),competitionId:String(raw.league.id),seasonKey:seasonKey(season),kickoff:raw.fixture.date,status:'FINISHED',home:{id:String(raw.teams.home.id),name:raw.teams.home.name},away:{id:String(raw.teams.away.id),name:raw.teams.away.name},periods};
}
export const PERIODS: HistoricalPeriod[]=['FIRST_HALF','SECOND_HALF','FULL_TIME','MIN_0_15','MIN_16_30','MIN_31_45_PLUS','MIN_46_60','MIN_61_75','MIN_76_90_PLUS'];
