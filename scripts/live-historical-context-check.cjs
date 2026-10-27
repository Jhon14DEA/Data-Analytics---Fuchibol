const fs=require('fs'),crypto=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client'),{createLiveHistoricalContextReader}=require('../.historical-build/services/historical/liveContext.js');
globalThis.fetch=async()=>{throw Error('HTTP_FORBIDDEN')};const db=new PrismaClient();
async function main(){
 const report=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const digest=async()=>{const out={};for(const [table,key]of [['LiveSnapshot','id'],['LiveMarketSnapshot','id'],['HybridScout','matchId'],['ApiFootballBudget','day']]){const rows=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM "${table}" t ORDER BY "${key}"`);out[table]={count:rows.length,hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return out;};
  const before=await digest();const now=new Date();
  const fixtures=await tx.fixture.findMany({where:{status:'LIVE'},include:{homeTeam:true,awayTeam:true,league:true},orderBy:{kickoff:'desc'},take:100});
  const read=createLiveHistoricalContextReader(tx),results=[];
  for(const f of fixtures){const context=await read({id:f.externalId,source:f.provider==='AllSportsApi'?'allsports':f.provider==='API-Football'?'api-football':'demo',homeTeamExternalId:f.homeTeam.externalId,awayTeamExternalId:f.awayTeam.externalId,homeTeam:f.homeTeam.name,awayTeam:f.awayTeam.name,competition:f.league.name,status:'LIVE',minute:f.minute,score:{home:f.homeScore,away:f.awayScore},kickoffAt:f.kickoffPrecision==='EXACT'?f.kickoff.toISOString():undefined});results.push({fixtureId:f.id,kickoff:f.kickoff.toISOString(),recentKickoff:f.kickoff<=now&&now-f.kickoff<6*3600000,context});}
  const after=await digest();return{at:now.toISOString(),scannedPersistedLive:fixtures.length,liveCount:await tx.fixture.count({where:{status:'LIVE'}}),withContext:results.filter(x=>x.context.status==='AVAILABLE').length,withoutMapping:results.filter(x=>['NO_MAPPING','NO_UNAMBIGUOUS_MAPPING','MAPPING_TARGET_MISSING'].includes(x.context.reason)).length,mappings:await tx.providerEntityMapping.count({where:{kind:'TEAM',OR:[{leftProvider:'FOOTBALL_DATA'},{rightProvider:'FOOTBALL_DATA'}]}}),results,protectedBefore:before,protectedAfter:after,protectedUnchanged:JSON.stringify(before)===JSON.stringify(after)};
 },{timeout:60000});
 fs.writeFileSync('reports/live-historical-context-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify({scanned:report.scannedPersistedLive,withContext:report.withContext,withoutMapping:report.withoutMapping,mappings:report.mappings,latenciesMs:report.results.map(x=>x.context.latencyMs),recentKickoff:report.results.filter(x=>x.recentKickoff).length,protectedUnchanged:report.protectedUnchanged}));
}
main().catch(()=>{console.error('READ_ONLY_CHECK_FAILED');process.exitCode=1}).finally(()=>db.$disconnect());
