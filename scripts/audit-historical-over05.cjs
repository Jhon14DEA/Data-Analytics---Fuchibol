// Read-only audit of the legacy schema; no provider/application imports or writes.
// Run: node --env-file=.env scripts/audit-historical-over05.cjs
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const sum = (s, a, b) => s[a] == null || s[b] == null ? null : Number(s[a]) + Number(s[b]);
const metrics = { totalShots: ['homeShots','awayShots'], SOT: ['homeShotsOnTarget','awayShotsOnTarget'], xG: ['homeXg','awayXg'], bigChances: ['homeBigChances','awayBigChances'], shotsInsideBox: ['homeShotsInsideBox','awayShotsInsideBox'], corners: ['homeCorners','awayCorners'], dangerousAttacks: ['homeDangerousAttacks','awayDangerousAttacks'], redCards: ['homeRedCards','awayRedCards'] };
const percentile = (a,q) => { const n=(a.length-1)*q, i=Math.floor(n); return a.length ? a[i]+(a[Math.ceil(n)]-a[i])*(n-i) : null; };
async function main() {
  const report = await p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const readOnly = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    const fixtures = await tx.fixture.findMany({include:{homeTeam:{select:{name:true}},awayTeam:{select:{name:true}}}});
    const snapshots = await tx.liveSnapshot.findMany({orderBy:{timestamp:'asc'}});
    const odds = await tx.oddsSnapshot.findMany({where:{market:'Total goles 1T',selection:'Over 0.5 1T'}});
    const events = await tx.matchEvent.findMany({select:{fixtureId:true,eventType:true,minute:true}});
    const marketCount = await tx.liveMarketSnapshot.count();
    // This audit certifies only the observed legacy-only dataset, without period/raw-score provenance.
    if (marketCount !== 0) throw new Error('New market evidence exists: review audit assumptions before rerunning.');
    const byId = new Map(fixtures.map(f=>[f.id,f]));
    const minuteValid = s => s.minute != null && s.minute >= 1 && s.minute <=45;
    const potential = snapshots.filter(s=>minuteValid(s)&&s.homeScore===0&&s.awayScore===0);
    // Conclusions below belong to this inspected database, not a general backfill engine.
    // Fail closed if the evidence changes; reassess outcomes and temporal coverage manually.
    if (snapshots.length !== 18 || fixtures.length !== 15 || events.length !== 148 || odds.length !== 37 ||
        potential.length !== 2 || fixtures.some(f=>f.status !== 'LIVE') ||
        snapshots[0]?.timestamp.toISOString() !== '2026-10-05T20:15:27.631Z' ||
        snapshots.at(-1)?.timestamp.toISOString() !== '2026-10-05T20:52:50.022Z') {
      throw new Error('Historical dataset changed; review point-in-time audit conclusions.');
    }
    const usableOdds = s => odds.filter(o=>o.fixtureId===s.fixtureId&&Number(o.line)===0.5&&o.timestamp<=s.timestamp&&s.timestamp-o.timestamp<=180000).sort((a,b)=>b.timestamp-a.timestamp)[0] ?? null;
    const coverage = list => Object.fromEntries([...Object.entries(metrics).map(([k,[a,b]])=>[k,list.filter(s=>sum(s,a,b)!==null).length]),['odds',list.filter(s=>usableOdds(s)).length],['timestampStored',list.filter(s=>s.timestamp instanceof Date).length],['providerObservationTimeConfirmed',0]].map(([k,n])=>[k,{availableCount:n,missingCount:list.length-n,coveragePercent:list.length?Number((n/list.length*100).toFixed(2)):null}]));
    const groups = new Map();
    for(const s of snapshots){if(!groups.has(s.fixtureId))groups.set(s.fixtureId,[]);groups.get(s.fixtureId).push(s);}
    const intervals=[]; let repeatedState=0;
    const state = s => JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k])=>!['id','timestamp','createdAt','sourceHash'].includes(k))));
    for(const list of groups.values()) for(let i=1;i<list.length;i++){intervals.push((list[i].timestamp-list[i-1].timestamp)/1000);if(state(list[i])===state(list[i-1]))repeatedState++;}
    intervals.sort((a,b)=>a-b);
    const rejection = s => !minuteValid(s)?'invalidMinute':s.homeScore+s.awayScore>0?'alreadyHadGoal':'unknownScore';
    const reasons = ['unknownScore','invalidPeriod','invalidMinute','alreadyHadGoal','missingHtOutcome','insufficientFixtureIdentity','duplicatedObservation','other'];
    const breakdown = list => Object.fromEntries(reasons.map(r=>[r,list.filter(s=>rejection(s)===r).length]));
    const sample = s => {const f=byId.get(s.fixtureId);return {snapshotId:s.id,fixtureId:s.fixtureId,provider:f.provider,externalId:f.externalId,teams:`${f.homeTeam.name} - ${f.awayTeam.name}`,date:f.kickoff,capturedAt:s.timestamp,minute:s.minute,storedScore:`${s.homeScore}-${s.awayScore}`,scoreClassification:s.homeScore===0&&s.awayScore===0?'UNKNOWN_SCORE':'STORED_NONZERO',period:null,...Object.fromEntries(Object.entries(metrics).map(([k,[a,b]])=>[k,sum(s,a,b)])),odds:usableOdds(s)?.odds??null,confirmedHtScore:null,confirmedFtScore:null,goalBeforeHt:null,goalBeforeFt:null,valid:false,rejection:rejection(s),reason:!minuteValid(s)?'Minuto fuera de 1..45; no se confirma FIRST_HALF.':s.homeScore+s.awayScore>0?'El marcador almacenado ya tiene goles.':'0-0 sin procedencia verificable; periodo y resultado HT no persistidos.'};};
    const offsets=odds.map(o=>(o.timestamp-o.createdAt)/1000);
    return {auditedAt:new Date(),transactionReadOnly:readOnly,scope:'Legacy-only dataset; counts are persisted availability, not verified provider semantics.',counts:{Fixture:fixtures.length,LiveSnapshot:snapshots.length,OddsSnapshot:await tx.oddsSnapshot.count(),LiveMarketSnapshot:marketCount,Match:await tx.match.count(),MatchSnapshot:await tx.matchSnapshot.count(),MatchEvent:events.length},snapshotRange:{min:snapshots[0]?.timestamp??null,max:snapshots.at(-1)?.timestamp??null},distinctFixtures:groups.size,fixtureStatuses:fixtures.reduce((a,f)=>(a[f.status]=(a[f.status]??0)+1,a),{}),eligibility:{confirmedFirstHalf:0,minute1to44Proxy:snapshots.filter(s=>s.minute>=1&&s.minute<45).length,storedNumericScore:snapshots.filter(s=>Number.isInteger(s.homeScore)&&Number.isInteger(s.awayScore)).length,storedZeroZero:snapshots.filter(s=>s.homeScore===0&&s.awayScore===0).length,confirmedZeroZero:0,minute1to45:snapshots.filter(minuteValid).length,confirmedJointConditions:0},simulation:{potentialCandidates:potential.length,validCandidates:0,rejectedCandidates:potential.length,exclusivePrimaryRejections:breakdown(potential),overlappingFailures:{unknownScore:potential.length,invalidPeriod:potential.length,missingHtOutcome:potential.length},wholePoolPrimaryRejections:breakdown(snapshots)},outcomes:{confirmedHtFixtures:0,confirmedFtFixtures:0,goalBeforeHtResolvable:0,goalBeforeFtResolvable:0,potentialFixtureEvents:events.filter(e=>potential.some(s=>s.fixtureId===e.fixtureId))},coverageAll:coverage(snapshots),coveragePotential:coverage(potential),temporal:{intervalCount:intervals.length,intervalsSeconds:intervals,medianSeconds:percentile(intervals,.5),averageSeconds:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,p90Seconds:percentile(intervals,.9),gapsAbove300Seconds:intervals.filter(x=>x>300).length,gapsAbove900Seconds:intervals.filter(x=>x>900).length,singleObservationFixtures:[...groups.values()].filter(x=>x.length===1).length,repeatedAdjacentFootballState:repeatedState,tolerance:'Not estimable reliably from three intervals; do not bridge sparse observations.',last5:0,last10:0,last15:0},odds:{textMatchingFirstHalfOver05:odds.length,lineValues:[...new Set(odds.map(o=>String(o.line)))],quotedAfterInsertion:odds.filter(o=>o.timestamp>o.createdAt).length,minimumQuoteMinusInsertionSeconds:Math.min(...offsets),maximumQuoteMinusInsertionSeconds:Math.max(...offsets),potentialWithPriorQuoteWithin180sIgnoringLine:potential.filter(s=>odds.some(o=>o.fixtureId===s.fixtureId&&o.timestamp<=s.timestamp&&s.timestamp-o.timestamp<=180000)).length},potentialSamples:potential.slice(0,10).map(sample),rejectedSamples:[...potential,...snapshots.filter(s=>!potential.includes(s))].slice(0,5).map(sample),recommendation:'C'};
  }, {isolationLevel:'RepeatableRead',timeout:30000});
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
