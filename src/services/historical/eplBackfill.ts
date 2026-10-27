import type { PrismaClient, Prisma } from '@prisma/client';
import { FootballDataCsvProvider, footballDataSeason, footballDataCompetition } from './footballDataCsv';
import { runHistoricalProvider } from './seasonWorker';
import { historicalError, historicalErrorText } from './errors';
export const EPL_SEASONS=Array.from({length:25},(_,i)=>`${String(i).padStart(2,'0')}${String(i+1).padStart(2,'0')}`);
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function initializeEplBackfill(db:PrismaClient,competition='E0'){
  const info=footballDataCompetition(competition);
  const league=await db.league.upsert({where:{provider_externalId:{provider:'FOOTBALL_DATA',externalId:competition}},create:{provider:'FOOTBALL_DATA',externalId:competition,...info,classification:'MEN_SENIOR',classificationSource:'VERIFIED_PROVIDER_BINDING'},update:{}});
  for(const code of EPL_SEASONS){
    const s=footballDataSeason(competition,code);
    const season=await db.season.upsert({where:{leagueId_key:{leagueId:league.id,key:s.key}},create:{leagueId:league.id,key:s.key,label:s.key,providerSeasonId:code,receivedAt:new Date()},update:{}});
    await db.historicalIngestionState.upsert({where:{provider_leagueId_seasonId:{provider:'FOOTBALL_DATA',leagueId:league.id,seasonId:season.id}},create:{provider:'FOOTBALL_DATA',leagueId:league.id,seasonId:season.id,rangeFrom:new Date(`${s.start}-07-01T00:00:00Z`),rangeTo:new Date(`${s.end}-06-30T23:59:59Z`),status:'READY',backfillMetadata:{season:code,status:'PENDING'}},update:{}});
  }
  return league;
}
export async function eplSeasonCounts(db:PrismaClient,seasonId:string){
  const where={provider:'FOOTBALL_DATA',seasonId};
  const fixtures=await db.fixture.findMany({where,select:{homeTeamId:true,awayTeamId:true}});
  const metrics=await db.teamMatchStats.aggregate({where:{fixture:where},_count:{_all:true,goals:true,shots:true,shotsOnTarget:true,corners:true,fouls:true,yellowCards:true,redCards:true,xg:true,possession:true}});
  return {fixtures:fixtures.length,teams:new Set(fixtures.flatMap(f=>[f.homeTeamId,f.awayTeamId])).size,
    teamMatchStats:metrics._count._all,referee:await db.fixture.count({where:{...where,referee:{not:null}}}),
    dateOnly:await db.fixture.count({where:{...where,kickoffPrecision:'DATE'}}),
    periodStats:await db.teamPeriodStats.count({where:{fixture:where,provider:'FOOTBALL_DATA'}}),
    outcomes:await db.historicalMarketOutcome.count({where:{fixture:where,provider:'FOOTBALL_DATA'}}),
    odds:await db.historicalOddsQuote.count({where:{fixture:where,provider:'FOOTBALL_DATA'}}),
    nullCoverage:Object.fromEntries(Object.entries(metrics._count).filter(([k])=>k!=='_all').map(([k,n])=>[k,{available:n,missing:metrics._count._all-n}]))};
}
export async function runEplSeason(db:PrismaClient,code:string,load:()=>Promise<FootballDataCsvProvider>,competition='E0'){
  const scope=footballDataSeason(competition,code),started=Date.now();
  const state=await db.historicalIngestionState.findFirstOrThrow({where:{provider:'FOOTBALL_DATA',league:{externalId:competition},season:{key:scope.key}}});
  const previous=(state.backfillMetadata??{}) as Record<string,unknown>;
  if(state.status==='SUCCEEDED'){
    const summary={...previous,status:'COMPLETE',season:code,skipped:true,reason:'ALREADY_DONE',insertedThisRun:0,updatedThisRun:0,...await eplSeasonCounts(db,state.seasonId)};
    await db.historicalIngestionState.update({where:{id:state.id},data:{backfillMetadata:json(summary)}});
    return summary;
  }
  if(state.leaseUntil&&state.leaseUntil>new Date())throw Error('BACKFILL_SEASON_BUSY');
  let writeStarted=false,source:FootballDataCsvProvider|undefined;
  await db.historicalIngestionState.update({where:{id:state.id},data:{backfillMetadata:json({...previous,status:'RUNNING',season:code,startedAt:new Date().toISOString()})}});
  try{
    source=await load();
    if(source.pages[0].competition.id!==competition||source.pages[0].season.providerSeasonId!==code)throw Error('CSV_WRONG_SEASON');
    await runHistoricalProvider(source);
    if(source.fixtures.length!==expectedFootballDataFixtures(competition,code))throw Error('CSV_UNEXPECTED_FIXTURE_COUNT');
    if(previous.checksum&&previous.checksum!==source.sourceHash)throw Error('CSV_CHECKSUM_CHANGED');
    const page=source.pages[0];
    if(state.fixturesFound===0&&state.cursor===null){
      await db.historicalIngestionState.update({where:{id:state.id},data:{rangeFrom:new Date(page.rangeFrom),rangeTo:new Date(page.rangeTo),status:'READY',leaseToken:null,leaseUntil:null}});
      await db.season.update({where:{id:state.seasonId},data:{startsAt:new Date(page.rangeFrom),endsAt:new Date(page.rangeTo)}});
    }
    await db.historicalIngestionState.update({where:{id:state.id},data:{backfillMetadata:json({...previous,status:'RUNNING',season:code,checksum:source.sourceHash,csvRows:source.csvRows})}});
    const beforeTeams=await db.team.count({where:{provider:'FOOTBALL_DATA'}});
    writeStarted=true;const result=await runHistoricalProvider(source,db,true);
    const teamInsertions=await db.team.count({where:{provider:'FOOTBALL_DATA'}})-beforeTeams;
    const counts=await eplSeasonCounts(db,state.seasonId);
    const summary={status:'COMPLETE',season:code,skipped:false,csvRows:source.csvRows,checksum:source.sourceHash,insertedThisRun:'inserted'in result?result.inserted:0,updatedThisRun:'updated'in result?result.updated:0,teamsInserted:teamInsertions,teamsReused:counts.teams-teamInsertions,...counts,duplicates:source.duplicates,anomalies:source.anomalies.reduce((a,s)=>(a[s]=(a[s]??0)+1,a),{} as Record<string,number>),csvCoverage:source.coverage,elapsedMs:Date.now()-started};
    await db.historicalIngestionState.update({where:{id:state.id},data:{backfillMetadata:json(summary)}});return summary;
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const codeError=/^[A-Z_]+$/.test(message)?message:'BACKFILL_FAILED';
    const safeToContinue=!writeStarted&&/^(CSV_|INVALID_CSV|UNTERMINATED_CSV|MISSING_CSV|AMBIGUOUS_OR_INVALID_CSV|PROVIDER_PREFLIGHT)/.test(codeError);
    const diagnostic=historicalError(error);
    console.error(JSON.stringify({event:'SEASON_FAILED',competition,season:code,checkpoint:state.cursor,diagnostic}));
    let counts={};try{counts=await eplSeasonCounts(db,state.seasonId);}catch{/* Diagnostics must survive a failed metrics query. */}
    const summary={status:'FAILED',season:code,error:codeError,diagnostic,safeToContinue,checksum:source?.sourceHash??previous.checksum??null,csvRows:source?.csvRows??null,elapsedMs:Date.now()-started,...counts};
    try{await db.historicalIngestionState.update({where:{id:state.id},data:{status:'FAILED',lastError:historicalErrorText(error),backfillMetadata:json(summary)}});}catch{console.error(JSON.stringify({event:'DIAGNOSTIC_DB_WRITE_FAILED',competition,season:code,diagnostic}));}
    if(!safeToContinue)throw error;return summary;
  }
}

export function expectedFootballDataFixtures(competition:string,code:string){
 const {start}=footballDataSeason(competition,code);
 if(competition==='D1')return 306;
 if(competition==='I1'&&start<2004)return 306;
 if(competition==='F1'){if(start===2019)return 279;if(start<2002||start>=2023)return 306;}
 return 380;
}
