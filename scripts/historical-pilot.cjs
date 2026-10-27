// Deliberately offline until account-specific season access and historical quota are verified.
const { historicalPilotPlan } = require('../.historical-build/services/historical/provider.js');
const { HISTORICAL_SCOPE } = require('../.historical-build/services/historical/scope.js');
try {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') continue;
    const match = /^--(limit|competition|season)=(.+)$/.exec(arg);
    if (!match || options[match[1]] !== undefined) throw Error('INVALID_ARGUMENT');
    options[match[1]] = match[2];
  }
  const binding = HISTORICAL_SCOPE.find(b => b.id === options.competition);
  if (!binding || !options.season) throw Error('COMPETITION_AND_SEASON_REQUIRED');
  console.log(JSON.stringify(historicalPilotPlan({competition: {id: binding.id, name: binding.name, country: binding.country}, season: options.season, limit: Number(options.limit ?? 20)}), null, 2));
} catch (error) {
  console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'PILOT_PLAN_FAILED');
  process.exitCode = 1;
}
