const fs=require('node:fs');
const {FootballDataCsvProvider}=require('../.historical-build/services/historical/footballDataCsv.js');
const {runHistoricalProvider}=require('../.historical-build/services/historical/seasonWorker.js');
const args=process.argv.slice(2),options={};
for(const a of args){if(['--write','--dry-run'].includes(a)){options[a]=true;continue;}const m=/^--(input|competition|season)=(.+)$/.exec(a);if(!m)throw Error('INVALID_ARGUMENT');options[m[1]]=m[2];}
if(options['--write']&&options['--dry-run'])throw Error('CONFLICTING_MODE');
async function main(){
 const competition=options.competition??'E0',season=options.season??'2425';
 const source=options.input?new FootballDataCsvProvider(fs.readFileSync(options.input,'utf8'),competition,season):await FootballDataCsvProvider.download(competition,season);
 const preview=await runHistoricalProvider(source);
 console.log(JSON.stringify({preview,sourceHash:source.sourceHash,duplicates:source.duplicates,odds:source.fixtures.reduce((n,f)=>n+f.archiveOdds.length,0),coverage:source.coverage}));
 if(!options['--write'])return;
 if(source.fixtures.length!==380)throw Error('PILOT_SEASON_EXPECTED_380');
 require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
 try{console.log(JSON.stringify(await runHistoricalProvider(source,db,true)));}finally{await db.$disconnect();}
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'FOOTBALL_DATA_IMPORT_FAILED');process.exitCode=1;});
