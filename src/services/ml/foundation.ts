import { createHash } from 'node:crypto';
import { pointInTimeIssue } from '../training/pointInTime';
import { calculateTeamHistoricalProfile } from '../historical/teamProfile';

// Offline export contract. No provider, application reader, ingestion or decision imports.
export const VERSION = 'ML_DATASET_FOUNDATION_V1';
export type SourceRow = Record<string, any>;
export type Source = Record<string, SourceRow[]>;
export const LIVE_LABELS = ['goalNext5','goalNext10','goalNext15','goalsRemaining1H','goalsRemainingFT',
  'twoPlusGoalsRemainingFT','cornersNext5','cornersNext10','cornersNext15','cardsNext10','cardsNext15','shotsOnTargetNext10'] as const;
export const MARKETS = {
  GOAL_NEXT_10: ['goalNext10'], GOAL_NEXT_15: ['goalNext15'], GOALS_2H: ['onePlusGoals2H','twoPlusGoals2H','threePlusGoals2H'],
  CORNERS_NEXT_10: ['cornersNext10'], CARDS_NEXT_15: ['cardsNext15'], SOT_NEXT_10: ['shotsOnTargetNext10']
} as const;
export const ms = (v: unknown): number => v instanceof Date ? +v : typeof v === 'string' ? Date.parse(v) : NaN;
export const number = (v: unknown): number | null => v === null || v === undefined || (typeof v === 'string'&&v.trim()==='') || typeof v === 'boolean'
  ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const sum = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
const iso = (t: number) => new Date(t).toISOString();
const index = (rows: SourceRow[], key: string) => {
  const result = new Map<string, SourceRow[]>();
  for (const row of rows) { const id = String(row[key]); result.set(id, [...(result.get(id) ?? []), row]); }
  return result;
};
const emptyLabels = () => Object.fromEntries(LIVE_LABELS.map(k => [k, null]));
export type Point = { id: string; fixtureId: string; at: string; observedAt: string; minute: number | null;
  period: string | null; features: SourceRow; provenance: string };

function features(row: SourceRow, market = false) {
  const result: SourceRow = {};
  for (const [name, suffix] of Object.entries({score:'Score',shots:'Shots',sot:market?'Sot':'ShotsOnTarget',xg:'Xg',
    bigChances:'BigChances',shotsInsideBox:'ShotsInsideBox',corners:'Corners',yellowCards:'YellowCards',redCards:'RedCards'})) {
    for (const side of ['home','away']) result[`${name}${side === 'home' ? 'Home' : 'Away'}`] = number(row[side+suffix]);
  }
  for (const side of ['Home','Away']) result[`cards${side}`] = sum(result[`yellowCards${side}`],result[`redCards${side}`]);
  return result;
}

/** Legacy snapshots have no receipt/score proof. They are audited, never silently certified. */
export function certifiedPoints(source: Source) {
  const points: Point[] = [], rejected: SourceRow[] = [];
  const fixtures = new Map(source.fixtures.map(f => [f.id,f]));
  const linked = new Set<string>();
  for (const row of source.marketSnapshots) {
    const issue = pointInTimeIssue(row);
    if (issue || !fixtures.has(row.matchId)) {
      rejected.push({table:'LiveMarketSnapshot',id:row.id,fixtureId:row.matchId,reason:issue ?? 'MISSING_FIXTURE'}); continue;
    }
    linked.add(row.liveSnapshotId);
    points.push({id:row.id,fixtureId:row.matchId,at:iso(ms(row.capturedAt)),observedAt:iso(ms(row.capturedAt)),
      minute:number(row.minute),period:row.marketPeriod,features:features(row,true),provenance:'SEALED_MARKET_SNAPSHOT_V1'});
  }
  for (const row of source.snapshots) {
    if (linked.has(row.id)) continue;
    const f=fixtures.get(row.fixtureId), received=ms(row.timestamp), created=ms(row.createdAt);
    // Recognizes only the new writer's receipt-based identity. The older detail
    // writer hashes a time bucket and may turn missing score into 0-0.
    const expected=f && Number.isFinite(received) ? createHash('sha256').update(`live-list:${f.externalId}:${iso(received)}`).digest('hex') : null;
    if (!f || f.provider!=='AllSportsApi' || !Number.isFinite(created) || created<received || created-received>180000 || row.sourceHash!==expected) {
      rejected.push({table:'LiveSnapshot',id:row.id,fixtureId:row.fixtureId,reason:'NO_VERIFIABLE_RECEIPT_AND_SCORE_PROVENANCE'});continue;
    }
    points.push({id:row.id,fixtureId:row.fixtureId,at:iso(created),observedAt:iso(received),minute:number(row.minute),
      period:null,features:features(row),provenance:'RECEIPT_HASH_LIVE_LIST_V1'});
  }
  return {points:points.sort((a,b)=>ms(a.at)-ms(b.at)||a.id.localeCompare(b.id)),rejected};
}

/** Exact endpoints, same confirmed period, bounded gaps. No interpolated clocks/added time. */
export function windowDelta(start: Point, end: Point, all: Point[], metric: string): number | null {
  if (!start.period || start.period!==end.period || !['FIRST_HALF','SECOND_HALF'].includes(start.period)
    || start.minute===null || end.minute===null || end.minute<=start.minute || ms(end.at)<=ms(start.at)
    || start.fixtureId!==end.fixtureId || end.minute>=(start.period==='FIRST_HALF'?45:90)
    || Math.abs((ms(end.at)-ms(start.at))-(end.minute-start.minute)*60000)>120000) return null;
  const segment=all.filter(p=>p.fixtureId===start.fixtureId&&ms(p.at)>=ms(start.at)&&ms(p.at)<=ms(end.at))
    .sort((a,b)=>ms(a.at)-ms(b.at)||a.id.localeCompare(b.id));
  if (segment.length<2) return null;
  for(let i=0;i<segment.length;i++) {
    const p=segment[i];
    if(p.period!==start.period || p.minute===null) return null;
    for(const side of ['Home','Away']) if(number(p.features[metric+side])===null) return null;
    if(i) {
      const previous=segment[i-1];
      if(p.minute<previous.minute! || p.minute-previous.minute!>3 || ms(p.at)-ms(previous.at)>180000) return null;
      for(const side of ['Home','Away']) if(p.features[metric+side]<previous.features[metric+side]) return null;
    }
  }
  return end.features[metric+'Home']+end.features[metric+'Away']-start.features[metric+'Home']-start.features[metric+'Away'];
}

function periodPair(f: SourceRow, stats: SourceRow[], period: string, metric: string) {
  const get=(team: string)=>stats.filter(s=>s.fixtureId===f.id&&s.teamId===team&&s.provider===f.provider&&s.period===period);
  const home=get(f.homeTeamId),away=get(f.awayTeamId);
  if(home.length!==1||away.length!==1) return null;
  const h=number(home[0][metric]),a=number(away[0][metric]);
  const available=Math.max(ms(home[0].receivedAt),ms(away[0].receivedAt));
  return h===null||a===null||!Number.isFinite(available)?null:{home:h,away:a,total:h+a,availableAt:iso(available)};
}

export function futureLabels(point: Point, all: Point[], fixture: SourceRow, stats: SourceRow[]) {
  const labels: SourceRow=emptyLabels(), availableAt: SourceRow=emptyLabels();
  for(const [metric,horizons,prefix] of [['score',[5,10,15],'goalNext'],['corners',[5,10,15],'cornersNext'],
    ['cards',[10,15],'cardsNext'],['sot',[10],'shotsOnTargetNext']] as const) {
    for(const horizon of horizons) {
      const endpoint=point.minute===null?undefined:all.find(p=>p.fixtureId===point.fixtureId&&p.minute===point.minute!+horizon&&ms(p.at)>ms(point.at));
      const value=endpoint?windowDelta(point,endpoint,all,metric):null;
      if(value!==null) {labels[prefix+horizon]=metric==='score'?Number(value>0):value;availableAt[prefix+horizon]=endpoint!.at;}
    }
  }
  for(const [period,label] of [['FIRST_HALF','goalsRemaining1H'],['FULL_TIME','goalsRemainingFT']]) {
    if(period==='FIRST_HALF'&&point.period!=='FIRST_HALF')continue;
    if(period==='FULL_TIME'&&fixture.status!=='FINISHED')continue;
    const final=periodPair(fixture,stats,period,'goals');
    const h=number(point.features.scoreHome),a=number(point.features.scoreAway);
    if(final&&ms(final.availableAt)>ms(point.at)&&h!==null&&a!==null&&final.home>=h&&final.away>=a) {
      labels[label]=final.total-h-a;availableAt[label]=final.availableAt;
    }
  }
  if(labels.goalsRemainingFT!==null) {
    labels.twoPlusGoalsRemainingFT=Number(labels.goalsRemainingFT>=2);availableAt.twoPlusGoalsRemainingFT=availableAt.goalsRemainingFT;
  }
  return {labels,availableAt};
}

export function oddsAt(rows: SourceRow[], cutoff: string) {
  const eligible=rows.filter(q=>Number.isFinite(ms(q.quotedAt??q.timestamp))&&Number.isFinite(ms(q.receivedAt))
    && ms(q.quotedAt??q.timestamp)<=ms(q.receivedAt)&&ms(q.receivedAt)<=ms(cutoff)
    && (!q.createdAt||ms(q.createdAt)<=ms(cutoff))&&number(q.price??q.odds)!>1);
  return eligible.length?eligible.sort((a,b)=>ms(a.receivedAt)-ms(b.receivedAt)||a.id.localeCompare(b.id)).map(q=>({
    sourceId:q.id,market:q.market,selection:q.selection,line:q.line==null?null:Number.isFinite(Number(q.line))?Number(q.line):null,price:number(q.price??q.odds),
    bookmakerId:q.bookmakerId,quotedAt:q.quotedAt??q.timestamp,receivedAt:q.receivedAt})):null;
}

export type Split = {validationStart: string;testStart: string};
export function chronologicalSplit(kickoff: string, boundaries: Split) {
  const t=ms(kickoff),v=ms(boundaries.validationStart),e=ms(boundaries.testStart);
  if(!Number.isFinite(t)||!Number.isFinite(v)||!Number.isFinite(e)||v>=e)throw Error('INVALID_SPLIT_BOUNDARIES');
  return t<v?'train':t<e?'validation':'test';
}

export function buildDatasets(source: Source, boundaries: Split) {
  const certified=certifiedPoints(source), pointsByFixture=index(certified.points as SourceRow[],'fixtureId');
  const statsByFixture=index(source.periodStats,'fixtureId'), teamStats=index(source.teamStats,'fixtureId');
  const oddsByFixture=index(source.odds,'fixtureId');
  const byTeam=new Map<string,SourceRow[]>();
  for(const f of source.fixtures) {
    const row={...f,kickoff:new Date(f.kickoff),createdAt:new Date(f.createdAt),updatedAt:new Date(f.updatedAt),
      teamStats:(teamStats.get(f.id)??[]).map(s=>({...s,createdAt:new Date(s.createdAt),updatedAt:new Date(s.updatedAt)})),
      periodStats:(statsByFixture.get(f.id)??[]).map(s=>({...s,receivedAt:new Date(s.receivedAt)}))};
    for(const id of [f.homeTeamId,f.awayTeamId]) {const list=byTeam.get(id)??[];list.push(row);byTeam.set(id,list);}
  }
  const history=(f: SourceRow,at: string)=>Object.fromEntries([['home',f.homeTeamId,'HOME'],['away',f.awayTeamId,'AWAY']].map(([side,id,venue])=>[
    side,Object.fromEntries(([5,10,20] as const).map(window=>[window,calculateTeamHistoricalProfile(id,new Date(at),
      {window,venue:venue as 'HOME'|'AWAY'},(byTeam.get(id)??[]) as any)]))]));
  const datasets: Record<string,SourceRow[]>={live_minute_dataset:[],prematch_goal_dataset:[],halftime_second_half_goal_dataset:[],prematch_corner_dataset:[],prematch_card_dataset:[]};
  const candidates: SourceRow[]=[],excluded: SourceRow[]=[...certified.rejected];
  const append=(dataset: string,f: SourceRow,at: string,feat: SourceRow,labels: SourceRow,labelAvailableAt: SourceRow,sourceId: string)=>{
    // Labels describe the future. An impossible chronology must not become a zero.
    for(const key of Object.keys(labels)) if(!Number.isFinite(ms(labelAvailableAt[key]))||ms(labelAvailableAt[key])<=ms(at)) {
      labels[key]=null;labelAvailableAt[key]=null;
    }
    const split=chronologicalSplit(f.kickoff,boundaries),upper=split==='train'?boundaries.validationStart:split==='validation'?boundaries.testStart:null;
    const usableLabels=Object.keys(labels).filter(k=>labels[k]!==null&&Number.isFinite(ms(labelAvailableAt[k]))&&(!upper||ms(labelAvailableAt[k])<ms(upper)));
    datasets[dataset].push({rowId:`${dataset}:${sourceId}`,fixtureId:f.id,provider:f.provider,leagueId:f.leagueId,seasonId:f.seasonId,
      kickoff:f.kickoff,capturedAt:at,split,sourceId,features:feat,labels,labelAvailableAt,usableLabels,
      trainingEligible:usableLabels.length>0,eligibilityReason:usableLabels.length?'LABEL_AVAILABLE_WITHIN_SPLIT':'NO_LABEL_AVAILABLE_WITHIN_SPLIT'});
  };
  for(const f of [...source.fixtures].sort((a,b)=>ms(a.kickoff)-ms(b.kickoff)||a.id.localeCompare(b.id))) {
    const stats=statsByFixture.get(f.id)??[],points=(pointsByFixture.get(f.id)??[]) as Point[];
    const ft=periodPair(f,stats,'FULL_TIME','goals'),ht=periodPair(f,stats,'FIRST_HALF','goals');
    const corners=periodPair(f,stats,'FULL_TIME','corners'),yellow=periodPair(f,stats,'FULL_TIME','yellowCards'),red=periodPair(f,stats,'FULL_TIME','redCards');
    const goals2H=ft&&ht&&ft.home>=ht.home&&ft.away>=ht.away?ft.total-ht.total:null;
    const targets={prematch_goal_dataset:ft?.total??null,halftime_second_half_goal_dataset:goals2H,
      prematch_corner_dataset:corners?.total??null,prematch_card_dataset:yellow&&red?yellow.total+red.total:null};
    if(f.status==='FINISHED')candidates.push({fixtureId:f.id,provider:f.provider,leagueId:f.leagueId,seasonId:f.seasonId,kickoff:f.kickoff,
      split:chronologicalSplit(f.kickoff,boundaries),...targets,reason:'OUTCOMES_ONLY_NOT_CERTIFIED_FEATURE_ROWS'});
    for(const p of points) {
      const recent: SourceRow={};
      for(const horizon of [5,10,15]) {
        const prior=p.minute===null?undefined:[...points].reverse().find(q=>q.minute===p.minute!-horizon&&ms(q.at)<ms(p.at));
        recent[`recent${horizon}`]=prior?Object.fromEntries(['score','shots','sot','xg','corners','cards'].map(metric=>[metric,windowDelta(prior,p,points.filter(q=>ms(q.at)<=ms(p.at)),metric)])):null;
      }
      const outcome=futureLabels(p,points,f,stats);
      append('live_minute_dataset',f,p.at,{minute:p.minute,period:p.period,...p.features,...recent,historical:history(f,p.at),
        odds:oddsAt(oddsByFixture.get(f.id)??[],p.at),playerFeatures:null},outcome.labels,outcome.availableAt,p.id);
    }
    // Do not backdate imported identities or history to kickoff.
    const cutoff=f.kickoffPrecision==='DATE'?String(f.kickoff).slice(0,10)+'T00:00:00.000Z':f.kickoff;
    if(['EXACT','DATE'].includes(f.kickoffPrecision)&&ms(f.createdAt)<ms(cutoff)) {
      const feat={minute:null,historical:history(f,cutoff),odds:oddsAt(oddsByFixture.get(f.id)??[],cutoff),playerFeatures:null};
      const known=f.status==='FINISHED';
      append('prematch_goal_dataset',f,cutoff,feat,{goalsFT:known?ft?.total??null:null},{goalsFT:ft?.availableAt??null},f.id);
      append('prematch_corner_dataset',f,cutoff,feat,{cornersFT:known?corners?.total??null:null},{cornersFT:corners?.availableAt??null},f.id);
      append('prematch_card_dataset',f,cutoff,feat,{cardsFT:known&&yellow&&red?yellow.total+red.total:null},
        {cardsFT:yellow&&red?iso(Math.max(ms(yellow.availableAt),ms(red.availableAt))):null},f.id);
    } else excluded.push({table:'Fixture',id:f.id,fixtureId:f.id,reason:'PREMATCH_IDENTITY_NOT_OBSERVED_BEFORE_KICKOFF'});
    // HT requires a separately observed HT state, never kickoff + 45 or an FT archive row.
    for(const p of (source.halftimeObservations??[]).filter(x=>x.fixtureId===f.id)) {
      if(p.period!=='HALFTIME'||!Number.isFinite(ms(p.availableAt))||ms(p.availableAt)>ms(p.capturedAt)
        ||!Number.isFinite(ms(p.capturedAt))||p.provenance!=='OBSERVED_HALFTIME_STATE_V1')continue;
      const labels: SourceRow={onePlusGoals2H:null,twoPlusGoals2H:null,threePlusGoals2H:null},available: SourceRow={...labels};
      const home=number(p.homeScore),away=number(p.awayScore);
      if(ft&&ms(ft.availableAt)>ms(p.capturedAt)&&home!==null&&away!==null&&ft.home>=home&&ft.away>=away) {
        for(const [label,n] of [['onePlusGoals2H',1],['twoPlusGoals2H',2],['threePlusGoals2H',3]] as const) {
          labels[label]=Number(ft.total-home-away>=n);available[label]=ft.availableAt;
        }
      }
      append('halftime_second_half_goal_dataset',f,p.capturedAt,{minute:p.minute??null,scoreHome:home,scoreAway:away,
        historical:history(f,p.capturedAt),odds:oddsAt(oddsByFixture.get(f.id)??[],p.capturedAt),playerFeatures:null},labels,available,p.id);
    }
  }
  return {version:VERSION,boundaries,datasets,candidates,excluded};
}
