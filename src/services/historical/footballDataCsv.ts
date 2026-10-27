import { createHash } from 'node:crypto';
import { historicalMetrics } from './normalize';
import type { HistoricalBatch, HistoricalFixture, Metrics } from './types';
import type { HistoricalProvider } from './seasonWorker';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const missing=(v:unknown)=>v===undefined||v===null||['','N/D','NA','N/A','NULL'].includes(String(v).trim());
export function csvNumber(v:unknown):number|null {
  if(missing(v))return null;
  const n=Number(v);if(!Number.isFinite(n))throw Error('INVALID_CSV_NUMBER');return n;
}
export const FOOTBALL_DATA_COMPETITIONS:Record<string,{name:string;country:string}>={E0:{name:'Premier League',country:'England'},SP1:{name:'Primera Division',country:'Spain'},I1:{name:'Serie A',country:'Italy'},F1:{name:'Ligue 1',country:'France'},D1:{name:'Bundesliga',country:'Germany'}};
export function footballDataCompetition(code:string){if(!Object.hasOwn(FOOTBALL_DATA_COMPETITIONS,code))throw Error('CSV_SCOPE_NOT_AUTHORIZED');return FOOTBALL_DATA_COMPETITIONS[code];}
export function footballDataSeason(competition:string,code:string){
  if(!Object.hasOwn(FOOTBALL_DATA_COMPETITIONS,competition)||!/^\d{4}$/.test(code))throw Error('CSV_SCOPE_NOT_AUTHORIZED');
  const start=Number(code.slice(0,2)),end=Number(code.slice(2));
  if(start>24||end!==start+1)throw Error('CSV_SCOPE_NOT_AUTHORIZED');
  return{start:2000+start,end:2000+end,key:`${2000+start}/${String(end).padStart(2,'0')}`};
}
export function footballDataDate(date:string){
  const m=/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(date);if(!m)throw Error('INVALID_CSV_DATE');
  const year=m[3].length===2?2000+Number(m[3]):Number(m[3]);
  const iso=`${year}-${m[2]}-${m[1]}`;const d=new Date(iso+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==iso)throw Error('INVALID_CSV_DATE');
  return{iso,display:`${m[1]}/${m[2]}/${year}`};
}
export function parseFootballCsv(text:string):Record<string,string|null>[] {
  if(Buffer.byteLength(text)>5_000_000)throw Error('CSV_SIZE_LIMIT');
  const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(i===0&&c==='\uFEFF')continue;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('INVALID_CSV_QUOTE');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))records.push(row);row=[];}
    }else{if(closed)throw Error('INVALID_CSV_QUOTE');field+=c;}
  }
  if(quoted)throw Error('UNTERMINATED_CSV_QUOTE');
  if(field||row.length){row.push(field);records.push(row);}
  const headers=records.shift();if(!headers)throw Error('INVALID_CSV_HEADERS');
  // Old exports sometimes include empty trailing columns: discard only structurally empty tails.
  while(headers.at(-1)==='')headers.pop();
  if(new Set(headers).size!==headers.length||headers.some(x=>!x))throw Error('INVALID_CSV_HEADERS');
  for(const key of ['Date','HomeTeam','AwayTeam','FTHG','FTAG'])if(!headers.includes(key))throw Error('MISSING_CSV_IDENTITY_OR_SCORE');
  return records.map(r=>{while(r.length>headers.length&&missing(r.at(-1)))r.pop();if(r.length!==headers.length)throw Error('CSV_WIDTH_MISMATCH');return Object.fromEntries(headers.map((h,i)=>[h,missing(r[i])?null:r[i]]));});
}

// These are the only documented columns imported. Aggregate Max/Avg are not bookmakers.
// Dictionary: https://football-data.co.uk/notes.txt . Quotes have no observation timestamp.
export function footballDataOdds(row:Record<string,string|null>,anomalies?:string[]):NonNullable<HistoricalFixture['archiveOdds']> {
  const result:NonNullable<HistoricalFixture['archiveOdds']>=[];
  const add=(column:string,bookmaker:string,market:'MATCH_RESULT'|'TOTAL_GOALS'|'ASIAN_HANDICAP',selection:string,line:number|null,phase:'PRE_CLOSING'|'CLOSING')=>{
    const price=csvNumber(row[column]);if(price===null)return;if(price<=1||price>=100000){if(anomalies){anomalies.push(`INVALID_ODDS_OMITTED:${column}`);return;}throw Error('INVALID_CSV_ODDS');}
    result.push({bookmaker,market,selection,line,price,phase,sourceColumn:column,quotedAt:null});
  };
  for(const [prefix,bookmaker]of Object.entries({B365:'Bet365',BW:'Bet&Win',BF:'Betfair',PS:'Pinnacle',WH:'William Hill','1XB':'1XBet',BFE:'Betfair Exchange',GB:'Gamebookers',IW:'Interwetten',LB:'Ladbrokes',SB:'Sportingbet'}))
    for(const [suffix,phase]of [['','PRE_CLOSING'],['C','CLOSING']] as const)
      for(const [outcome,selection]of [['H','HOME'],['D','DRAW'],['A','AWAY']])add(prefix+suffix+outcome,bookmaker,'MATCH_RESULT',selection,null,phase);
  for(const [prefix,bookmaker]of [['B365','Bet365'],['P','Pinnacle']])for(const [suffix,phase]of [['','PRE_CLOSING'],['C','CLOSING']] as const){
    for(const [sign,selection]of [['>','OVER'],['<','UNDER']])add(prefix+suffix+sign+'2.5',bookmaker,'TOTAL_GOALS',selection,2.5,phase);
    const line=csvNumber(row[suffix?'AHCh':'AHh']);if(line!==null){
      add(prefix+suffix+'AHH',bookmaker,'ASIAN_HANDICAP','HOME',line,phase);
      add(prefix+suffix+'AHA',bookmaker,'ASIAN_HANDICAP','AWAY',-line,phase);
    }
  }
  return result;
}

// CSV clock is a UK wall clock. Resolve London DST with round-trip validation.
export function footballDataKickoff(date:string,time:string|null):string {
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date),t=/^(\d{2}):(\d{2})$/.exec(time??'');
  if(!m||!t)throw Error('CSV_KICKOFF_TIME_REQUIRED');
  const wall=`${m[3]}-${m[2]}-${m[1]}T${t[1]}:${t[2]}:00`;
  const nominal=Date.parse(wall+'Z');if(!Number.isFinite(nominal))throw Error('INVALID_CSV_DATE');
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const candidates=[nominal,nominal-3600000].filter(n=>format.format(new Date(n))===`${m[1]}/${m[2]}/${m[3]}, ${t[1]}:${t[2]}`);
  if(candidates.length!==1)throw Error('AMBIGUOUS_OR_INVALID_CSV_TIME');return new Date(candidates[0]).toISOString();
}
export class FootballDataCsvProvider implements HistoricalProvider {
  readonly anomalies:string[]=[];
  readonly csvRows:number;
  readonly provider='FOOTBALL_DATA' as const;
  readonly fixtures:HistoricalFixture[];
  readonly pages:HistoricalBatch[];
  readonly sourceHash:string;
  readonly coverage:Record<string,{present:number;missing:number}>;
  readonly duplicates:number;
  constructor(text:string,competition='E0',season='2425',receivedAt=new Date().toISOString()){
    const scope=footballDataSeason(competition,season),league=footballDataCompetition(competition);
    const rows=parseFootballCsv(text);if(!rows.length||rows.length>500)throw Error('CSV_ROW_LIMIT');
    this.csvRows=rows.length;
    this.sourceHash=digest(text);this.coverage={};for(const key of Object.keys(rows[0])){const present=rows.filter(r=>r[key]!==null).length;this.coverage[key]={present,missing:rows.length-present};}
    const unique=new Map<string,HistoricalFixture>();let duplicates=0;
    for(const r of rows){
      if(r.Div!==undefined&&r.Div!==competition)throw Error('CSV_WRONG_COMPETITION');
      if(!r.HomeTeam?.trim()||!r.AwayTeam?.trim())throw Error('CSV_TEAM_MISSING');
      const date=footballDataDate(r.Date!),dateOnly=missing(r.Time);
      const kickoff=dateOnly?date.iso+'T00:00:00.000Z':footballDataKickoff(date.display,r.Time);
      if(date.iso<`${scope.start}-07-01`||date.iso>=`${scope.end}-09-01`)throw Error('CSV_WRONG_SEASON');
      const team=(name:string)=>({id:`${league.country}:${name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')}`,name:name.trim()});
      const home=team(r.HomeTeam),away=team(r.AwayTeam);
      // Date + ordered provider team identities, not row number or score: stable on replay/correction.
      const id=`${competition}:${season}:${digest([date.display,home.id,away.id].join('|')).slice(0,32)}`;
      const metrics=(side:'H'|'A',ht=false):Metrics=>{
        const fields:Partial<Record<keyof Metrics,unknown>>={goals:csvNumber(r[(ht?'HT':'FT')+side+'G'])};
        if(!ht)for(const [suffix,key]of Object.entries({S:'shots',ST:'shotsOnTarget',C:'corners',F:'fouls',Y:'yellowCards',R:'redCards'})){
          const value=csvNumber(r[side+suffix]);if(value!==null&&(!Number.isInteger(value)||value<0))throw Error('INVALID_CSV_COUNT');fields[key as keyof Metrics]=value;
        }
        const goals=fields.goals;if(goals!==null&&(!Number.isInteger(goals)||Number(goals)<0))throw Error('INVALID_CSV_SCORE');
        return historicalMetrics(fields);
      };
      const f:HistoricalFixture={id,competitionId:competition,seasonKey:scope.key,kickoff,...(dateOnly?{kickoffPrecision:'DATE' as const,historicalKickoffAt:null}:{}),status:'FINISHED',home,away,referee:r.Referee??null,periods:[
        {period:'FIRST_HALF',home:metrics('H',true),away:metrics('A',true),source:'FOOTBALL_DATA_EXPLICIT_HT'},
        {period:'FULL_TIME',home:metrics('H'),away:metrics('A'),source:'FOOTBALL_DATA_FULL_TIME'}],archiveOdds:footballDataOdds(r,this.anomalies)};
      for(const s of ['home','away'] as const){const ft=f.periods[1][s];if(ft.shots!==null&&ft.shotsOnTarget!==null&&ft.shotsOnTarget>ft.shots)throw Error('CSV_SOT_EXCEEDS_SHOTS');}
      if(unique.has(id)){if(JSON.stringify(unique.get(id))!==JSON.stringify(f))throw Error('CONFLICTING_CSV_DUPLICATE');duplicates++;}else unique.set(id,f);
    }
    this.duplicates=duplicates;this.fixtures=[...unique.values()].sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
    const from=this.fixtures[0].kickoff,to=this.fixtures.at(-1)!.kickoff;
    this.pages=[];for(let offset=0;offset<this.fixtures.length;offset+=50)this.pages.push({provider:this.provider,competition:{id:competition,...league},season:{key:scope.key,label:scope.key,providerSeasonId:season,startsAt:from,endsAt:to},rangeFrom:from,rangeTo:to,receivedAt,cursor:offset===0?null:`${this.sourceHash}:${offset}`,nextCursor:offset+50<this.fixtures.length?`${this.sourceHash}:${offset+50}`:null,fixtures:this.fixtures.slice(offset,offset+50)});
  }
  async batches(){return this.pages;}
  static async download(competition='E0',season='2425',fetcher:typeof fetch=fetch){
    footballDataSeason(competition,season);
    const response=await fetcher(`https://football-data.co.uk/mmz4281/${season}/${competition}.csv`,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('CSV_DOWNLOAD_FAILED');return new FootballDataCsvProvider(await response.text(),competition,season);
  }
}
