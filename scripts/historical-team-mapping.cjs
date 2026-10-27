const fs=require('fs'),crypto=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client');const {loadTeamMappingInventory,resolveTeamProviderMapping,persistTeamProviderResolution}=require('../.historical-build/services/historical/teamProviderMapping.js');
globalThis.fetch=async()=>{throw Error('HTTP_FORBIDDEN')};const db=new PrismaClient();
async function protectedState(){const out={};for(const [table,key]of [['LiveSnapshot','id'],['LiveMarketSnapshot','id'],['HybridScout','matchId'],['ApiFootballBudget','day']]){const rows=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM "${table}" t ORDER BY "${key}"`);out[table]={count:rows.length,hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return out;}
async function main(){
 const mode=process.argv[2];if(!['--plan','--write'].includes(mode)||process.argv.length!==3)throw Error('USE_PLAN_OR_WRITE');
 const before=await protectedState(),inventory=await loadTeamMappingInventory(db),results=[];
 for(const [sourceProvider,targetProvider]of [['AllSportsApi','FOOTBALL_DATA'],['API-Football','FOOTBALL_DATA'],['AllSportsApi','API-Football']])for(const source of inventory.identities.filter(t=>t.provider===sourceProvider)){
  let result=resolveTeamProviderMapping(source,targetProvider,inventory.identities,inventory.links,inventory.aliases);
  if(mode==='--write'&&result.status==='MAPPED')result=await persistTeamProviderResolution(db,source,targetProvider,inventory.aliases);
  results.push({source,targetProvider,...result});
 }
 const after=await protectedState(),summary={mode,created:mode==='--write'?results.filter(r=>r.status==='MAPPED'&&!r.reused).length:0,proposed:results.filter(r=>r.status==='MAPPED'&&!r.reused).length,reused:results.filter(r=>r.reused).length,ambiguous:results.filter(r=>r.status==='AMBIGUOUS').length,noMatch:results.filter(r=>r.status==='NO_MATCH').length,aliases:inventory.aliases,protectedUnchanged:JSON.stringify(before)===JSON.stringify(after)};
 const report={at:new Date().toISOString(),...summary,providerTeams:Object.fromEntries(['AllSportsApi','API-Football','FOOTBALL_DATA'].map(p=>[p,inventory.identities.filter(t=>t.provider===p).length])),results,protectedBefore:before,protectedAfter:after};
 fs.writeFileSync(`reports/historical-team-mapping-${mode.slice(2)}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(summary));
}
main().catch(e=>{console.error(require('../.historical-build/services/historical/errors.js').historicalError(e));process.exitCode=1}).finally(()=>db.$disconnect());
