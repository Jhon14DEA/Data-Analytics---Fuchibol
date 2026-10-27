import type { MatchAnalysisContext, TeamLiveSnapshotDelta } from '@/types/domain';
import type { LiveHistoricalContext } from '@/services/historical/liveContext';

// Independent informational policy. Never consumed by betting/radar decision gates.
export const PRESSURE_POLICY = Object.freeze({ sot: 6, shots: 12, xg: 1.2, bigChances: 2, box: 8, corners: 4, dangerous: 30, recentCoverage: 75, earlyMinute: 35, historyMaxAgeDays: 180 });
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const pair = (a: unknown,b: unknown) => number(a) === null || number(b) === null ? null : (a as number)+(b as number);
const atLeast = (v: number|null,n:number) => v!==null&&v>=n;
type Level='PRESSURE_HIGH'|'PRESSURE_MEDIUM'|'PRESSURE_LOW'|'INSUFFICIENT_DATA';
function usable(w:TeamLiveSnapshotDelta|undefined){return !!w&&w.isComplete&&w.coveragePercentage>=PRESSURE_POLICY.recentCoverage&&(w.dataState==='VALID_DATA'||w.dataState==='OBSERVED_ZERO');}
function recentView(w:TeamLiveSnapshotDelta|undefined){return {usable:usable(w),sot:number(w?.shotsOnTarget),shots:number(w?.shots),xg:number(w?.xg),coverage:number(w?.coveragePercentage)};}

export function detectHighGoalPressure(context:MatchAnalysisContext,history?:LiveHistoricalContext){
 const m=context.match,h=m.stats.home,a=m.stats.away,minute=number(m.minute);
 const totalGoals=pair(m.score.home,m.score.away);
 const live={shots:pair(h.shots,a.shots),sot:pair(h.shotsOnTarget,a.shotsOnTarget),xg:pair(h.xg,a.xg),bigChances:pair(h.bigChances,a.bigChances),box:pair(h.shotsInsideBox,a.shotsInsideBox),corners:pair(h.corners,a.corners),dangerous:pair(h.dangerousAttacks,a.dangerousAttacks),redCards:pair(h.redCards,a.redCards)};
 const reasons:string[]=[],blockers:string[]=[];
 const recent={five:recentView(context.liveMomentum?.recent.five),ten:recentView(context.liveMomentum?.recent.ten),fifteen:recentView(context.liveMomentum?.recent.fifteen)};
 // Prefer the shortest adequately covered window; never add overlapping windows.
 const window=[context.liveMomentum?.recent.five,context.liveMomentum?.recent.ten,context.liveMomentum?.recent.fifteen].find(w=>usable(w)&&number(w?.shotsOnTarget)!==null&&number(w?.shots)!==null);
 const recentHigh=!!window&&atLeast(number(window.shotsOnTarget),window.minutes===5?2:window.minutes===10?3:4)&&
   (atLeast(number(window.shots),window.minutes===5?3:window.minutes===10?5:7)||atLeast(number(window.xg),window.minutes===5?.3:window.minutes===10?.5:.7));
 const recentLow=!!window&&window.shotsOnTarget===0&&window.shots!==null&&window.shots<=1;
 if(recentHigh)reasons.push('RECENT_PRESSURE_HIGH');
 if(recentLow)blockers.push('LOW_RECENT_ACTIVITY');
 if(!window)blockers.push('RECENT_ACTIVITY_MISSING');
 const signals:[string,boolean][]=[['SOT_VOLUME_HIGH',atLeast(live.sot,PRESSURE_POLICY.sot)],['SHOT_VOLUME_HIGH',atLeast(live.shots,PRESSURE_POLICY.shots)],['XG_HIGH',atLeast(live.xg,PRESSURE_POLICY.xg)],['BIG_CHANCES_HIGH',atLeast(live.bigChances,PRESSURE_POLICY.bigChances)],['BOX_ACTIVITY_HIGH',atLeast(live.box,PRESSURE_POLICY.box)],['CORNERS_HIGH',atLeast(live.corners,PRESSURE_POLICY.corners)],['DANGEROUS_ATTACKS_HIGH',atLeast(live.dangerous,PRESSURE_POLICY.dangerous)]];
 reasons.push(...signals.filter(([,yes])=>yes).map(([key])=>key));
 const quality=atLeast(live.xg,1.2)||atLeast(live.bigChances,2)||atLeast(live.box,8);
 const accumulatedStrong=atLeast(live.sot,6)&&quality;
 const profiles=history?.status==='AVAILABLE'?[...history.home.filter(p=>p.venue==='HOME'),...history.away.filter(p=>p.venue==='AWAY')]:[];
 const cutoff=Date.parse(m.kickoffAt??'');
 const fresh=(p:typeof profiles[number])=>Number.isFinite(cutoff)&&p.newestFixtureDate!==null&&Date.parse(p.newestFixtureDate)<cutoff&&cutoff-Date.parse(p.newestFixtureDate)<=PRESSURE_POLICY.historyMaxAgeDays*86400000;
 const strong=(venue:'HOME'|'AWAY')=>{
  const ps=profiles.filter(p=>p.venue===venue&&fresh(p)&&p.sampleSize>=p.window);
  return ps.length>=2&&ps.filter(p=>atLeast(p.features.scoredRate,.7)&&atLeast(p.features.avgGoalsFor,1.4)&&atLeast(p.features.avgShotsOnTarget,4)).length>=2;
 };
 const historicalStrength=profiles.length?{support:strong('HOME')&&strong('AWAY')?'BOTH_STRONG':'NOT_CONFIRMED',profiles:profiles.map(p=>({venue:p.venue,window:p.window,sampleSize:p.sampleSize,newestFixtureDate:p.newestFixtureDate,coverage:p.coverage,features:p.features,fresh:fresh(p),
  // Supporting context only; never substitutes for observed LIVE activity.
  supportingSignals:[
   atLeast(p.features.concededRate,.7)&&atLeast(p.features.avgGoalsAgainst,1.2)?'CONCEDING_REGULARLY':null,
   atLeast(p.features.over05HtRate,.7)&&atLeast(p.features.over15HtRate,.4)?'FIRST_HALF_GOAL_HISTORY':null,
   atLeast(p.features.over05FtRate,.9)&&atLeast(p.features.over15FtRate,.75)&&atLeast(p.features.over25FtRate,.6)?'FULL_TIME_GOAL_HISTORY':null,
   atLeast(p.features.bttsRate,.6)?'BTTS_HISTORY':null,
   atLeast(p.features.avgShots,12)&&atLeast(p.features.avgCorners,5)?'HISTORICAL_ATTACK_VOLUME':null,
   atLeast(p.features.scoringStreak,3)?'SCORING_STREAK':null
  ].filter((v):v is string=>v!==null)
 }))}:null;
 if(!historicalStrength)blockers.push('HISTORICAL_CONTEXT_MISSING');
 else if(!profiles.some(fresh))blockers.push('HISTORICAL_CONTEXT_STALE');
 if(historicalStrength?.support==='BOTH_STRONG')reasons.push('BOTH_TEAMS_OFFENSIVELY_STRONG');
 const losingSide=totalGoals===null?null:m.score.home<m.score.away?'home':m.score.away<m.score.home?'away':null;
 const losingWindow=losingSide&&window?window[losingSide]:null;
 const losingPressing=!!losingWindow&&atLeast(number(losingWindow.shotsOnTarget),window!.minutes===5?2:3)&&atLeast(number(losingWindow.shots),3);
 if(losingPressing)reasons.push('LOSING_TEAM_PRESSING');
 if(atLeast(number(h.redCards),1)||atLeast(number(a.redCards),1))blockers.push('RED_CARD_DISTORTION');
 const events=m.events.filter(e=>minute!==null&&e.minute<=minute&&e.minute>=minute-3&&(e.type==='var'||e.type==='penalty')).map(e=>({type:e.type,minute:e.minute}));
 if(events.length)blockers.push('RECENT_VAR_OR_PENALTY_VERIFY');
 const dataQuality=Math.round(Object.values(live).filter(v=>v!==null).length/Object.keys(live).length*100);
 const sufficient=minute!==null&&totalGoals!==null&&live.sot!==null&&[live.shots,live.xg,live.bigChances,live.box].filter(v=>v!==null).length>=2;
 if(!sufficient||dataQuality<50)blockers.push('LOW_DATA_QUALITY');
 if(context.dataFreshness?.liveDataStale)blockers.push('STALE_LIVE_DATA');
 if(context.liveMomentum?.notes.some(n=>n.includes('DATA_WARNING')))blockers.push('INCONSISTENT_LIVE_DATA');
 let level:Level='INSUFFICIENT_DATA';
 if(m.status==='LIVE'&&!m.demo&&sufficient&&!blockers.includes('STALE_LIVE_DATA')&&!blockers.includes('INCONSISTENT_LIVE_DATA')){
  const high=!recentLow&&((accumulatedStrong&&(recentHigh||minute!<=35&&!window))||(recentHigh&&losingPressing));
  level=high?'PRESSURE_HIGH':!recentLow&&(atLeast(live.sot,4)||recentHigh)?'PRESSURE_MEDIUM':'PRESSURE_LOW';
 }
 const explosion=level==='PRESSURE_HIGH'&&recentHigh&&minute!==null&&minute<=35&&totalGoals!==null&&totalGoals>=2&&!events.length;
 if(explosion)reasons.push('EARLY_GOALS_WITH_SUSTAINED_PRESSURE');
 // Confidence is evidence strength, NOT probability of a goal.
 const confidence=level==='INSUFFICIENT_DATA'?null:Math.max(0,Math.min(100,Math.round(dataQuality*.6+(recentHigh?20:window?10:0)+(historicalStrength?.support==='BOTH_STRONG'?15:0)-(blockers.includes('RED_CARD_DISTORTION')?15:0)-(events.length?15:0))));
 const markets:string[]=[];
 if(level==='PRESSURE_HIGH'||level==='PRESSURE_MEDIUM'){
  if(minute!==null&&minute<40&&totalGoals!==null)for(const line of [.5,1.5])if(line>totalGoals)markets.push(`O${line} 1T (confirmar periodo)`);
  if(minute!==null&&minute<85&&totalGoals!==null){for(const line of [.5,1.5,2.5,3.5,4.5])if(line>totalGoals&&line<=Math.max(2.5,totalGoals+1.5))markets.push(`O${line} FT`);markets.push('Siguiente gol');}
 }
 return {detector:'HIGH_GOAL_PRESSURE' as const,informationalOnly:true as const,level,derivedState:explosion?'MATCH_EXPLOSION' as const:null,confidence,dataQuality,live,recent,historicalStrength,reasons,blockers,losingSide,events,trend:context.liveMomentum?.matchTrendState??null,markets};
}
export type HighGoalPressure=ReturnType<typeof detectHighGoalPressure>;
