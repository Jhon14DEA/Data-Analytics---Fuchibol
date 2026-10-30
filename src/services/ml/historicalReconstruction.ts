// OFFLINE ONLY. Do not import from an application route, provider or operational reader.
import type { Source, SourceRow } from './foundation';
import { chronologicalSplit, type Split } from './foundation';

export const HISTORICAL_POLICY = 'HISTORICAL_EVENT_TIME_RECONSTRUCTION';
export const OPERATIONAL_POLICY = 'OPERATIONAL_POINT_IN_TIME';
export const RECONSTRUCTION_VERSION = 'HISTORICAL_ML_RECONSTRUCTION_V1';
export const PREMATCH_LABELS = ['homeGoal','awayGoal','over05','over15','over25','over35','btts','goalsFT','goals1H','secondHalfGoals'];
export const HALFTIME_LABELS = ['goal2H_1plus','goal2H_2plus','goal2H_3plus','goals2H'];
const count = (n: unknown): number | null => typeof n==='number'&&Number.isInteger(n)&&n>=0?n:null;
const day = (v: string) => Date.parse(v.slice(0,10)+'T00:00:00.000Z');
const avg = (v: (number|null)[]) => v.length&&v.every(x=>x!==null)?v.reduce<number>((a,b)=>a+b!,0)/v.length:null;
const rate = (v: (number|null)[], predicate: (x:number)=>boolean) => avg(v.map(x=>x===null?null:Number(predicate(x))));
const sum = (a:number|null,b:number|null) => a===null||b===null?null:a+b;
type HistoricalGame = {fixture:SourceRow;htHome:SourceRow|null;htAway:SourceRow|null;ftHome:SourceRow;ftAway:SourceRow};

/** No imported/received timestamps here. Only archived event chronology.
 * No final whistle timestamp exists, so V1 excludes the target calendar day AND
 * the preceding calendar day; it does not pretend kickoff+90 is a known FT time.
 */
export function priorGame(previous: SourceRow,target: SourceRow) {
  return previous.id!==target.id && previous.status==='FINISHED' && Date.parse(previous.kickoff)<Date.parse(target.kickoff)
    && day(previous.kickoff)+2*86400000<=day(target.kickoff);
}

function profile(games: HistoricalGame[],teamId:string,window:5|10|20) {
  const selected=games.slice(-window).reverse();
  const own=(g:HistoricalGame,period:'ft'|'ht')=>g.fixture.homeTeamId===teamId?g[`${period}Home`]:g[`${period}Away`];
  const opponent=(g:HistoricalGame,period:'ft'|'ht')=>g.fixture.homeTeamId===teamId?g[`${period}Away`]:g[`${period}Home`];
  const gf=selected.map(g=>count(own(g,'ft')?.goals)),ga=selected.map(g=>count(opponent(g,'ft')?.goals));
  const total=gf.map((v,i)=>sum(v,ga[i]));
  const ht=selected.map(g=>sum(count(own(g,'ht')?.goals),count(opponent(g,'ht')?.goals)));
  const streak=(values:(number|null)[],predicate:(x:number)=>boolean)=>{
    if(!values.length)return {value:null,censored:null};let n=0;
    for(const v of values){if(v===null)return {value:null,censored:null};if(!predicate(v))return {value:n,censored:0};n++;}
    return {value:n,censored:1};
  };
  const scored=streak(gf,x=>x>0),conceded=streak(ga,x=>x>0),clean=streak(ga,x=>x===0);
  const metric=(key:string)=>avg(selected.map(g=>count(own(g,'ft')?.[key])));
  return {sampleSize:selected.length,avgGoalsFor:avg(gf),avgGoalsAgainst:avg(ga),scoredRate:rate(gf,x=>x>0),
    concededRate:rate(ga,x=>x>0),cleanSheetRate:rate(ga,x=>x===0),bttsRate:avg(gf.map((v,i)=>v===null||ga[i]===null?null:Number(v>0&&ga[i]!>0))),
    over05FtRate:rate(total,x=>x>0.5),over15FtRate:rate(total,x=>x>1.5),over25FtRate:rate(total,x=>x>2.5),
    over05HtRate:rate(ht,x=>x>0.5),over15HtRate:rate(ht,x=>x>1.5),avgShots:metric('shots'),avgSot:metric('shotsOnTarget'),
    avgCorners:metric('corners'),avgYellowCards:metric('yellowCards'),avgRedCards:metric('redCards'),
    avgCards:avg(selected.map(g=>sum(count(own(g,'ft')?.yellowCards),count(own(g,'ft')?.redCards)))),
    scoringStreak:scored.value,scoringStreakCensored:scored.censored,concedingStreak:conceded.value,
    concedingStreakCensored:conceded.censored,cleanSheetStreak:clean.value,cleanSheetStreakCensored:clean.censored};
}

export function reconstructionInput(source:Source) {
  const byFixture=new Map<string,SourceRow[]>();
  for(const s of source.periodStats){const list=byFixture.get(s.fixtureId)??[];list.push(s);byFixture.set(s.fixtureId,list);}
  const games:HistoricalGame[]=[],excluded:SourceRow[]=[],identities=new Map<string,SourceRow[]>();
  // One authoritative archive; never union providers by fuzzy team names.
  for(const f of source.fixtures.filter(f=>f.provider==='FOOTBALL_DATA'&&f.status==='FINISHED')) {
    const key=[f.leagueId,String(f.kickoff).slice(0,10),f.homeTeamId,f.awayTeamId].join('|');
    const group=identities.get(key)??[];group.push(f);identities.set(key,group);
  }
  for(const group of identities.values()) {
    if(group.length!==1){for(const f of group)excluded.push({fixtureId:f.id,reason:'DUPLICATE_CANONICAL_IDENTITY'});continue;}
    const f=group[0],stats=byFixture.get(f.id)??[];
    const get=(period:string,teamId:string)=>{const hits=stats.filter(s=>s.provider===f.provider&&s.period===period&&s.teamId===teamId);return hits.length===1?hits[0]:null;};
    const ftHome=get('FULL_TIME',f.homeTeamId),ftAway=get('FULL_TIME',f.awayTeamId),htHome=get('FIRST_HALF',f.homeTeamId),htAway=get('FIRST_HALF',f.awayTeamId);
    if(!Number.isFinite(Date.parse(f.kickoff))||!['EXACT','DATE'].includes(f.kickoffPrecision)||!ftHome||!ftAway||count(ftHome.goals)===null||count(ftAway.goals)===null){excluded.push({fixtureId:f.id,reason:'INVALID_FINAL_SCORE_OR_DATE'});continue;}
    const validHt=count(htHome?.goals)!==null&&count(htAway?.goals)!==null&&htHome!.goals<=ftHome.goals&&htAway!.goals<=ftAway.goals;
    games.push({fixture:f,ftHome,ftAway,htHome:validHt?htHome:null,htAway:validHt?htAway:null});
  }
  games.sort((a,b)=>Date.parse(a.fixture.kickoff)-Date.parse(b.fixture.kickoff)||a.fixture.id.localeCompare(b.fixture.id));
  return {games,excluded};
}

export function* reconstruct(source:Source,boundaries:Split) {
  const {games}=reconstructionInput(source),history=new Map<string,HistoricalGame[]>();
  const seasons=new Map(source.seasons.map(s=>[s.id,s.key])),leagues=new Map(source.leagues.map(l=>[l.id,l.name]));
  for(const g of games) {
    const f=g.fixture,features:SourceRow={league:leagues.get(f.leagueId)??f.leagueId,season:seasons.get(f.seasonId)??null};
    const provenance:SourceRow={priorFixtureIds:[],latestPriorKickoff:null};
    for(const [side,teamId,venue]of [['home',f.homeTeamId,'HOME'],['away',f.awayTeamId,'AWAY']]) {
      const previous=(history.get(teamId)??[]).filter(p=>priorGame(p.fixture,f));
      const byVenue=previous.filter(p=>venue==='HOME'?p.fixture.homeTeamId===teamId:p.fixture.awayTeamId===teamId);
      for(const window of [5,10,20] as const)for(const [key,value]of Object.entries(profile(byVenue,teamId,window)))features[`${side}_${venue}_${window}_${key}`]=value;
      // Date-level gap remains calculable when one or both kickoff times are absent.
      const mostRecent=(history.get(teamId)??[]).at(-1)?.fixture;
      const last=mostRecent&&priorGame(mostRecent,f)?mostRecent:undefined;
      features[`${side}_daysSincePreviousMatch`]=last?(day(f.kickoff)-day(last.kickoff))/86400000:null;
      features[`${side}_daysSincePreviousMatchExact`]=last&&f.kickoffPrecision==='EXACT'&&last.kickoffPrecision==='EXACT'
        ?(Date.parse(f.kickoff)-Date.parse(last.kickoff))/86400000:null;
      provenance.priorFixtureIds.push(...byVenue.slice(-20).map(p=>p.fixture.id),...(last?[last.id]:[]));
      if(last&&(!provenance.latestPriorKickoff||last.kickoff>provenance.latestPriorKickoff))provenance.latestPriorKickoff=last.kickoff;
    }
    provenance.priorFixtureIds=[...new Set(provenance.priorFixtureIds)].sort();
    const ft=g.ftHome.goals+g.ftAway.goals,hh=count(g.htHome?.goals),ha=count(g.htAway?.goals);
    const validHt=hh!==null&&ha!==null&&hh<=g.ftHome.goals&&ha<=g.ftAway.goals;
    const ht=validHt?hh!+ha!:null,second=ht===null?null:ft-ht;
    const ready=features.home_HOME_5_sampleSize>=5&&features.away_AWAY_5_sampleSize>=5;
    const metadata={fixtureId:f.id,kickoff:f.kickoff,leagueId:f.leagueId,season:features.season,split:chronologicalSplit(f.kickoff,boundaries),
      temporalPolicy:HISTORICAL_POLICY,provenance,eligible:ready,reason:ready?null:'WARMUP_FEWER_THAN_5_HOME_OR_AWAY_MATCHES'};
    yield {dataset:'PREMATCH_GOALS_V1',metadata,features,labels:{homeGoal:Number(g.ftHome.goals>0),awayGoal:Number(g.ftAway.goals>0),
      over05:Number(ft>0.5),over15:Number(ft>1.5),over25:Number(ft>2.5),over35:Number(ft>3.5),btts:Number(g.ftHome.goals>0&&g.ftAway.goals>0),
      goalsFT:ft,goals1H:ht,secondHalfGoals:second}};
    const halftimeFeatures:SourceRow={...features,htScoreHome:hh,htScoreAway:ha,htGoals:ht};
    for(const [side,stat]of [['Home',g.htHome],['Away',g.htAway]] as const)for(const metric of ['shots','shotsOnTarget','corners','yellowCards','redCards','xg'])
      halftimeFeatures[`ht${side}_${metric}`]=stat?.[metric]==null?null:Number(stat[metric]);
    yield {dataset:'HALFTIME_SECOND_HALF_V1',metadata:{...metadata,eligible:ready&&validHt,reason:!validHt?'UNKNOWN_OR_INCONSISTENT_HT_SCORE':metadata.reason},features:halftimeFeatures,
      labels:{goal2H_1plus:second===null?null:Number(second>=1),goal2H_2plus:second===null?null:Number(second>=2),goal2H_3plus:second===null?null:Number(second>=3),goals2H:second}};
    for(const id of [f.homeTeamId,f.awayTeamId]){const list=history.get(id)??[];list.push(g);history.set(id,list);}
  }
}
