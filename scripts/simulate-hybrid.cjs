require('../tests/register-typescript.cjs');
const { prisma }=require('../src/lib/prisma.ts');
const { simulateHybridTraffic }=require('../src/services/training/hybrid/simulation.ts');
const { automaticBudget }=require('../src/services/training/hybrid/budget.ts');
const { scenario }=require('../tests/training/hybrid-fixtures.cjs');
// Explicit network prohibition: this command can never fetch provider data.
globalThis.fetch=()=>{throw new Error('SIMULATION_NETWORK_FORBIDDEN');};
async function main(){
 const since=new Date(Date.now()-24*60*60000);
 const read=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [scouts,legacySnapshots]=await Promise.all([
   tx.hybridScout.findMany({where:{observedAt:{gte:since}}}),
   tx.liveSnapshot.count({where:{timestamp:{gte:since},fixture:{provider:'AllSportsApi'}}})]);
  return {scouts,legacySnapshots};
 },{isolationLevel:'RepeatableRead'});
 const events=read.scouts.map(r=>({at:r.observedAt.toISOString(),identity:r.identity,observation:r.observation,live:r.live}));
 const output={mode:'SIMULATION_ONLY_NO_HTTP_NO_WRITES',automaticEnabled:process.env.API_FOOTBALL_HYBRID_ENABLED==='true',budget:automaticBudget(),outcomeReserve:20,
  recent24Hours:{verifiedScouts:events.length,legacySnapshots:read.legacySnapshots,legacyExcludedReason:'Legacy LiveSnapshot scores may be display defaults; raw confirmed score/period receipt is not persisted. Do not promote missing evidence.',...simulateHybridTraffic(events,automaticBudget())},
  inMemoryScenarios:{tenFixtures:{synthetic:true,...simulateHybridTraffic(scenario(10),automaticBudget())},fortyFixtures:{synthetic:true,...simulateHybridTraffic(scenario(40),automaticBudget())}},
  activation:'DISABLED_PENDING_EXPLICIT_AUTHORIZATION_AND_REPRESENTATIVE_VOLUME',realHttpRequests:0};
 console.log(JSON.stringify(output,null,2));
}
main().catch(()=>{console.error('SIMULATION_FAILED: database/schema unavailable');process.exitCode=1;}).finally(()=>prisma.$disconnect());
