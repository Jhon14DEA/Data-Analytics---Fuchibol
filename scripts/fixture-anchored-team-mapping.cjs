const fs=require('fs'),crypto=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client');const {preserveFixtureAnchoredTeams,verifyFixtureTeamAnchor}=require('../.historical-build/services/historical/fixtureAnchoredTeams.js');
globalThis.fetch=async()=>{throw Error('HTTP_FORBIDDEN')};const db=new PrismaClient();
async function protectedState(){const result={};for(const [table,key]of [['Fixture','id'],['LiveSnapshot','id'],['LiveMarketSnapshot','id'],['HybridScout','matchId'],['ApiFootballBudget','day'],['HybridApiCache','key']]){const rows=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM "${table}" t ORDER BY "${key}"`);result[table]={count:rows.length,hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;}
async function main(){
 const mode=process.argv[2];if(!['--plan','--write'].includes(mode))throw Error('USE_PLAN_OR_WRITE');
 const before=await protectedState(),scouts=await db.hybridScout.findMany({where:{apiFootballFixtureId:{not:null}},include:{match:{include:{homeTeam:true,awayTeam:true,league:true}}},orderBy:{observedAt:'desc'}});
 const caches=await db.hybridApiCache.findMany({where:{key:{startsWith:'directory:'}}}),results=[];
 for(const scout of scouts){
  const versions=caches.flatMap(c=>Array.isArray(c.payload)&&c.fetchedAt?c.payload.filter(f=>String(f.fixture?.id)===scout.apiFootballFixtureId).map(raw=>({raw,receivedAt:c.fetchedAt.toISOString(),key:c.key})):[]);
  const identity=f=>JSON.stringify({teams:f.teams,league:f.league,date:f.fixture.date,timestamp:f.fixture.timestamp},(k,v)=>['logo','flag','winner','round','standings'].includes(k)?undefined:v);
  const fingerprints=new Set(versions.map(v=>identity(v.raw)));
  if(fingerprints.size!==1){results.push({matchId:scout.matchId,status:'NO_MATCH',reason:versions.length?'CONFLICTING_CACHED_IDENTITIES':'NO_CACHED_TEAM_IDS'});continue;}
  const version=versions.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt))[0];
  if(!verifyFixtureTeamAnchor(scout.match,scout.apiFootballFixtureId,version.raw)){results.push({matchId:scout.matchId,status:'NO_MATCH',reason:'ANCHOR_VALIDATION_FAILED'});continue;}
  try{const counts=mode==='--write'?await preserveFixtureAnchoredTeams(db,scout.matchId,version.raw,version.receivedAt):null;results.push({matchId:scout.matchId,allSportsFixtureId:scout.allSportsFixtureId,apiFixtureId:scout.apiFootballFixtureId,home:scout.match.homeTeam.name,away:scout.match.awayTeam.name,kickoff:scout.match.kickoff,cacheKey:version.key,status:'VERIFIED',counts});}
  catch(e){results.push({matchId:scout.matchId,status:'CONFLICT',error:require('../.historical-build/services/historical/errors.js').historicalError(e)});}
 }
 const after=await protectedState();const report={at:new Date().toISOString(),mode,providerMappedFixtures:scouts.length,validAnchors:results.filter(r=>r.status==='VERIFIED').length,conflicts:results.filter(r=>r.status==='CONFLICT').length,results,protectedBefore:before,protectedAfter:after,protectedUnchanged:JSON.stringify(before)===JSON.stringify(after)};
 fs.writeFileSync(`reports/fixture-anchored-${mode.slice(2)}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.results));console.log(JSON.stringify({validAnchors:report.validAnchors,conflicts:report.conflicts,protectedUnchanged:report.protectedUnchanged}));
}
main().catch(e=>{console.error(require('../.historical-build/services/historical/errors.js').historicalError(e));process.exitCode=1}).finally(()=>db.$disconnect());
