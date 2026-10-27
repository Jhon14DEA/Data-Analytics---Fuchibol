const fs=require('fs'),path=require('path');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client');
const {FootballDataCsvProvider,parseFootballCsv}=require('../.historical-build/services/historical/footballDataCsv.js');
const {EPL_SEASONS,initializeEplBackfill,runEplSeason}=require('../.historical-build/services/historical/eplBackfill.js');
const {seasonStatus,shouldSkip,acquireLock}=require('./football-data-backfill-control.cjs');
const {historicalError}=require('../.historical-build/services/historical/errors.js');
const args=process.argv.slice(2),competitionArgs=args.filter(a=>a.startsWith('--competition=')),modes=args.filter(a=>['--write','--status'].includes(a));
const retryArgs=args.filter(a=>a==='--retry-failed'),retryFailed=retryArgs.length===1;
if(competitionArgs.length>1||modes.length!==1||retryArgs.length>1||args.length!==competitionArgs.length+1+retryArgs.length||retryFailed&&modes[0]!=='--write')throw Error('USE_COMPETITION_AND_WRITE_OR_STATUS');
const competition=competitionArgs[0]?.slice('--competition='.length)??'E0';
if(!['E0','SP1','I1','F1','D1'].includes(competition))throw Error('CSV_SCOPE_NOT_AUTHORIZED');
const directory=competition==='E0'?'reports/football-data-backfill':'reports/football-data-backfill/'+competition,lock=path.join(directory,'run.lock');
fs.mkdirSync(directory,{recursive:true});

// One local runner at a time; a failed process cannot silently remove another process's lock.
const write=modes[0]==='--write';if(write)acquireLock(lock);
const db=new PrismaClient();const started=Date.now();
let stopping=false;
if(write)for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;console.log(JSON.stringify({event:'STOP_REQUESTED',detail:'Finish current season, then stop'}));});
async function main(){
 if(!write){
  const states=await db.historicalIngestionState.findMany({where:{provider:'FOOTBALL_DATA',league:{externalId:competition}},include:{season:true}});
  console.table(EPL_SEASONS.map(season=>{const s=states.find(s=>s.season.providerSeasonId===season);return {season,status:seasonStatus(s),fixtures:s?.fixturesFound??0,error:s?.lastError??null};}));return;
 }
 await initializeEplBackfill(db,competition);
 for(const season of EPL_SEASONS){
  if(stopping){console.log(JSON.stringify({event:'BACKFILL_STOPPED',nextSeason:season}));return;}
  const state=await db.historicalIngestionState.findFirstOrThrow({where:{provider:'FOOTBALL_DATA',league:{externalId:competition},season:{providerSeasonId:season}}});
  if(shouldSkip(state,retryFailed)){console.log(JSON.stringify({event:'SEASON_SKIPPED',season,status:seasonStatus(state),fixtures:state.fixturesFound}));continue;}
  if(state.cursor)console.log(JSON.stringify({event:'SEASON_RESUME',competition,season,cursor:state.cursor,confirmedFixtures:state.fixturesFound}));
  console.log(JSON.stringify({event:'SEASON_START',season}));
  const summary=await runEplSeason(db,season,async()=>{
   const file=path.join(directory,`${competition}-${season}.csv`);
   if(!fs.existsSync(file)){
    const response=await fetch(`https://football-data.co.uk/mmz4281/${season}/${competition}.csv`,{redirect:'error',signal:AbortSignal.timeout(20000)});
    fs.appendFileSync(path.join(directory,'http.jsonl'),JSON.stringify({at:new Date().toISOString(),season,http:response.status})+'\n');
    if(!response.ok)throw Error('CSV_DOWNLOAD_FAILED');
    const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>5_000_000)throw Error('CSV_SIZE_LIMIT');
    fs.writeFileSync(file,buffer,{flag:'wx'});
   }
   return new FootballDataCsvProvider(fs.readFileSync(file,'utf8'),competition,season);
  },competition);
  if(summary.skipped&&!summary.checksum){
   const file=competition==='E0'&&season==='2425'?'reports/football-data-E0-2425.csv':path.join(directory,`${competition}-${season}.csv`);
   if(fs.existsSync(file)){
    const existing=new FootballDataCsvProvider(fs.readFileSync(file,'utf8'),competition,season);
    Object.assign(summary,{checksum:existing.sourceHash,csvRows:existing.csvRows,duplicates:existing.duplicates,csvCoverage:existing.coverage,anomalies:{}});
    await db.historicalIngestionState.updateMany({where:{provider:'FOOTBALL_DATA',league:{externalId:competition},season:{providerSeasonId:season}},data:{backfillMetadata:summary}});
   }
  }
  if(summary.status==='FAILED'){
   const file=path.join(directory,`${competition}-${season}.csv`);
   if(fs.existsSync(file)){
    const text=fs.readFileSync(file,'utf8');summary.checksum=require('crypto').createHash('sha256').update(text).digest('hex');
    try{
     const rows=parseFootballCsv(text);summary.csvRows=rows.length;
     summary.csvCoverage=Object.fromEntries(Object.keys(rows[0]??{}).map(k=>{const present=rows.filter(r=>r[k]!==null).length;return[k,{present,missing:rows.length-present}]}));
     summary.anomalies=rows.flatMap(r=>['H','A'].filter(s=>r[s+'S']!==null&&r[s+'ST']!==null&&Number(r[s+'ST'])>Number(r[s+'S'])).map(side=>({type:'SOT_EXCEEDS_SHOTS',date:r.Date,home:r.HomeTeam,away:r.AwayTeam,side,shots:r[side+'S'],sot:r[side+'ST']})));
    }catch{summary.csvInspection='FAILED';}
    await db.historicalIngestionState.updateMany({where:{provider:'FOOTBALL_DATA',league:{externalId:competition},season:{providerSeasonId:season}},data:{backfillMetadata:summary}});
   }
  }
  fs.writeFileSync(path.join(directory,`${competition}-${season}.json`),JSON.stringify(summary,null,2));
  const {csvCoverage,nullCoverage,...brief}=summary;console.log(JSON.stringify(brief));
 }
 console.log(JSON.stringify({event:'BACKFILL_FINISHED',elapsedMs:Date.now()-started}));
}
main().catch(e=>{const diagnostic={event:'BACKFILL_ERROR',competition,at:new Date().toISOString(),diagnostic:historicalError(e)};console.error(JSON.stringify(diagnostic));if(write)fs.appendFileSync(path.join(directory,'errors.jsonl'),JSON.stringify(diagnostic)+'\n');process.exitCode=1;}).finally(async()=>{await db.$disconnect();if(write)fs.unlinkSync(lock);});
