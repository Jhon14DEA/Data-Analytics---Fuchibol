// One-shot inspection through the existing provider's diagnostic list queries.
// No polling, DB writes, full payloads, URLs, headers or credentials are emitted.
require('../tests/register-typescript.cjs');
const fs = require('node:fs');
const originalFetch = global.fetch;
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
const samples = [];
const allowed = ['event_key','event_home_team','event_away_team','event_status','event_live','event_halftime_result','event_final_result','event_ft_result','event_date','event_time','stage_name'];
for (const key of Object.keys(originals)) console[key] = () => {};
global.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = new URL(String(args[0]));
  if (url.hostname === 'apiv2.allsportsapi.com' && ['Livescore','Fixtures'].includes(url.searchParams.get('met'))) {
    const payload = await response.clone().json();
    for (const raw of Array.isArray(payload.result) ? payload.result : []) {
      if (url.searchParams.get('met') !== 'Livescore' && raw.event_live !== '1') continue;
      const observation = require('../src/services/training/observation.ts').allSportsObservation(raw,new Date().toISOString());
      samples.push({endpoint:url.searchParams.get('met'),fieldsPresent:Object.keys(raw).filter(k=>!/key|token|secret|auth/i.test(k)),
        raw:Object.fromEntries(allowed.map(k=>[k,raw[k]??null])),normalizedMinute:observation.minute,
        period:observation.period,evidence:observation.periodEvidence??null});
    }
  }
  return response;
};
(async()=>{
  const {AllSportsApiProvider}=require('../src/providers/football/allSportsApi.ts');
  await new AllSportsApiProvider().debugListMatches();
  const report={observedAt:new Date().toISOString(),samples};
  fs.writeFileSync('reports/allsports-period-inspection.json',JSON.stringify(report,null,2));
  const available = [...new Set(samples.map(s=>s.period))];
  originals.log(JSON.stringify({observedAt:report.observedAt,
    unavailablePeriods:['FIRST_HALF','HALFTIME','SECOND_HALF','FINISHED'].filter(p=>!available.includes(p)),
    samples:samples.map(s=>({fixture:s.raw.event_key,teams:`${s.raw.event_home_team} - ${s.raw.event_away_team}`,endpoint:s.endpoint,
      rawEventStatus:s.raw.event_status,eventLive:s.raw.event_live,rawHtScore:s.raw.event_halftime_result,rawScore:s.raw.event_final_result,
      normalizedMinute:s.normalizedMinute,resolvedPeriod:s.period,confidence:s.evidence?.confidence??'UNKNOWN',reason:s.evidence?.reason??'NO_EVIDENCE'}))},null,2));
})().catch(()=>{originals.error('ALLSPORTS_INSPECTION_FAILED');process.exitCode=1;}).finally(async()=>{
  global.fetch=originalFetch;Object.assign(console,originals);
  await require('../src/lib/prisma.ts').prisma.$disconnect();
});
