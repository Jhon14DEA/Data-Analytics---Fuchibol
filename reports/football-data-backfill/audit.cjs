const fs=require('fs'),crypto=require('crypto');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
async function main(){
 const before=JSON.parse(fs.readFileSync('reports/football-data-backfill/before.json','utf8'));
 const protectedData={};
 for(const table of ['Fixture','LiveSnapshot','LiveMarketSnapshot','HybridScout','ApiFootballBudget']){
  const where=table==='Fixture'?` WHERE t.provider <> 'FOOTBALL_DATA' OR t."externalId" LIKE 'E0:2425:%'`:'';
  const order=table==='ApiFootballBudget'?'day':table==='HybridScout'?'matchId':'id';
  const rows=await db.$queryRawUnsafe(`SELECT to_jsonb(t) - 'kickoffPrecision' - 'historicalKickoffAt' AS data FROM "${table}" t${where} ORDER BY "${order}"`);
  protectedData[table]={count:rows.length,hash:sha(JSON.stringify(rows))};
 }
 const counts={};for(const key of Object.keys(before.counts))counts[key]=await db[key].count();
 const [size]=await db.$queryRawUnsafe(`SELECT sum(pg_total_relation_size(c.oid))::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Fixture','Team','League','Season','TeamMatchStats','TeamPeriodStats','HistoricalMarketOutcome','HistoricalOddsQuote','HistoricalIngestionState')`);
 const sourceBaseline=JSON.parse(fs.readFileSync('reports/historical-foundation-protected-before.json','utf8'));
 const changedSources=Object.entries(sourceBaseline).filter(([file,hash])=>sha(fs.readFileSync(file))!==hash).map(([file])=>file);
 const states=await db.historicalIngestionState.findMany({where:{provider:'FOOTBALL_DATA',league:{externalId:'E0'}},select:{status:true,season:{select:{providerSeasonId:true}},backfillMetadata:true}});
 const result={at:new Date().toISOString(),protectedData,counts,bytes:String(size.bytes),protectedUnchanged:Object.fromEntries(Object.entries(protectedData).map(([k,v])=>[k,JSON.stringify(v)===JSON.stringify(before.protectedData[k])])),sourcesChecked:Object.keys(sourceBaseline).length,changedSources,states};
 fs.writeFileSync('reports/football-data-backfill/after.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({counts,bytes:result.bytes,protectedUnchanged:result.protectedUnchanged,sourcesChecked:result.sourcesChecked,changedSources}));
}
main().catch(()=>{console.error('AUDIT_FAILED');process.exitCode=1}).finally(()=>db.$disconnect());
