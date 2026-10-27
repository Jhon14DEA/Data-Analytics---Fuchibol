// Read-only local validation: no provider transport, no database writes.
const fs=require('fs'),crypto=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client');
const {createTeamHistoricalProfileBuilder}=require('../.historical-build/services/historical/teamProfile.js');
globalThis.fetch=async()=>{throw Error('HTTP_FORBIDDEN')};
const db=new PrismaClient({log:[{emit:'event',level:'query'}]});let queries=0;db.$on('query',()=>queries++);
async function protectedState(tx){const result={};for(const [table,key]of [['LiveSnapshot','id'],['LiveMarketSnapshot','id'],['HybridScout','matchId'],['ApiFootballBudget','day']]){
 const rows=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM "${table}" t ORDER BY "${key}"`);
 result[table]={count:rows.length,hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}return result;}
async function main(){
 const before=new Date();
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const baseline=await protectedState(tx);
  const specs=[{requested:'Manchester City',names:['Manchester City','Man City'],country:'England'},{requested:'Real Madrid',names:['Real Madrid'],country:'Spain'},{requested:'Inter',names:['Inter'],country:'Italy'}];
  const profiles=[];const build=createTeamHistoricalProfileBuilder(tx);
  for(const spec of specs){
   const teams=await tx.team.findMany({where:{provider:'FOOTBALL_DATA',country:spec.country,name:{in:spec.names}},select:{id:true,externalId:true,name:true,provider:true,country:true}});
   if(teams.length!==1)throw Error('TEAM_IDENTITY_NOT_UNIQUE_'+spec.country);
   const team=teams[0];
   for(const venue of ['ALL','HOME','AWAY'])for(const window of [5,10,20]){
    const start=queries,t=Date.now(),profile=await build(team.id,before,{window,venue});
    profiles.push({requested:spec.requested,identity:team,queryCount:queries-start,elapsedMs:Date.now()-t,profile});
   }
  }
  const teamId=profiles[0].identity.id;
  const plan=await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM "Fixture" WHERE ("homeTeamId"=$1 OR "awayTeamId"=$1) AND status='FINISHED' AND kickoff<$2 AND "createdAt"<$2 AND "updatedAt"<$2 AND ("kickoffPrecision"='EXACT' OR ("kickoffPrecision"='DATE' AND kickoff<$3)) ORDER BY kickoff DESC,id ASC LIMIT 20`,teamId,before,new Date(before.toISOString().slice(0,10)+'T00:00:00Z'));
  const after=await protectedState(tx);
  return{before:before.toISOString(),profiles,protectedBefore:baseline,protectedAfter:after,protectedUnchanged:JSON.stringify(baseline)===JSON.stringify(after),plan};
 },{timeout:120000});
 fs.writeFileSync('reports/historical-feature-profiles.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({before:result.before,protectedUnchanged:result.protectedUnchanged,counts:result.protectedAfter,profiles:result.profiles.map(x=>({team:x.requested,venue:x.profile.venue,window:x.profile.window,sampleSize:x.profile.sampleSize,queryCount:x.queryCount,elapsedMs:x.elapsedMs,features:x.profile.features,coverage:x.profile.coverage}))}));
}
main().catch(e=>{console.error(require('../.historical-build/services/historical/errors.js').historicalError(e));process.exitCode=1}).finally(()=>db.$disconnect());
