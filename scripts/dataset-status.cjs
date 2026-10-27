// Uses the existing TypeScript loader; no server, provider calls or data mutations.
require('../tests/register-typescript.cjs');
const { prisma } = require('../src/lib/prisma.ts');
const { trainingSummary } = require('../src/services/training/liveMarketSnapshots.ts');
async function main() {
  const status = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return trainingSummary({}, tx);
  }, { isolationLevel: 'RepeatableRead' });
  status.diagnostics.note = 'CLI process only: historical rejection counters are unavailable here. Check running-server endpoint/logs.';
  console.log(JSON.stringify(status, null, 2));
}
main().catch(() => { console.error('DATASET_STATUS_ERROR: database unavailable or incompatible schema.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
