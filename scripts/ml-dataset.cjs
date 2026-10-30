// Offline command: database reads only; no HTTP, provider imports or model execution.
require('../tests/register-typescript.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {PrismaClient}=require('@prisma/client');
const {buildDatasets,VERSION,MARKETS}=require('../src/services/ml/foundation.ts');
const root=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const stringify=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?Number(v):v,2)+'\n';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--(source|out|validation-start|test-start)=(.+)$/.exec(arg);if(!m)throw Error('INVALID_ARGUMENT');return[m[1],m[2]];}));

const fields={
  Fixture:['season','minute','providerUpdatedAt','historicalKickoffAt'],
  LiveSnapshot:['minute','homeXg','awayXg','homeShots','awayShots','homeShotsOnTarget','awayShotsOnTarget','homeBigChances','awayBigChances','homeShotsInsideBox','awayShotsInsideBox','homeCorners','awayCorners','homeYellowCards','awayYellowCards','homeRedCards','awayRedCards'],
  LiveMarketSnapshot:['minute','homeXg','awayXg','homeShots','awayShots','homeSot','awaySot','homeBigChances','awayBigChances','homeShotsInsideBox','awayShotsInsideBox','homeCorners','awayCorners','homeRedCards','awayRedCards','marketOdds','goalBeforeHt','goalBeforeFt','finalHomeScore','finalAwayScore'],
  TeamMatchStats:['goals','shots','shotsOnTarget','xg','corners','yellowCards','redCards'],
  TeamPeriodStats:['goals','shots','shotsOnTarget','xg','corners','yellowCards','redCards'],
  HistoricalMarketOutcome:['observedValue','resolvedAt'],HistoricalOddsQuote:['price','quotedAt','receivedAt'],
  Lineup:['position','starter','number'],MatchEvent:['minute','playerName'],Player:['position','teamId'],
  PlayerMatchStats:['minutes','starter','goals','shots','shotsOnTarget','xg'],OddsSnapshot:['odds','timestamp','receivedAt','marketPeriod']
};

async function capture() {
  const db=new PrismaClient();
  try{return await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const state=await tx.$queryRawUnsafe('SELECT now() AS "auditedAt", current_setting(\'transaction_read_only\') AS "readOnly", current_database() AS database');
    const audit={...state[0],tables:{}};
    for(const [table,columns] of Object.entries(fields)) {
      const id=table==='LiveMarketSnapshot'?'matchId':table==='Fixture'?'id':['Player'].includes(table)?null:'fixtureId';
      const select=['count(*)::int AS rows',...(id?[`count(DISTINCT "${id}")::int AS fixtures`]:[]),...columns.map(c=>`count("${c}")::int AS "${c}"`)];
      audit.tables[table]=(await tx.$queryRawUnsafe(`SELECT ${select.join(',')} FROM "${table}"`))[0];
    }
    audit.periods=await tx.$queryRawUnsafe('SELECT period,count(*)::int AS rows,count(goals)::int AS goals,count(shots)::int AS shots,count("shotsOnTarget")::int AS sot,count(xg)::int AS xg,count(corners)::int AS corners,count("yellowCards")::int AS yellow,count("redCards")::int AS red FROM "TeamPeriodStats" GROUP BY period ORDER BY period');
    audit.minutes=await tx.$queryRawUnsafe('SELECT minute,count(*)::int AS snapshots,count(DISTINCT "fixtureId")::int AS fixtures FROM "LiveSnapshot" GROUP BY minute ORDER BY minute NULLS LAST');
    audit.events=await tx.$queryRawUnsafe('SELECT "eventType",count(*)::int AS rows,count(minute)::int AS with_minute FROM "MatchEvent" GROUP BY "eventType" ORDER BY "eventType"');
    audit.playerPositions=await tx.$queryRawUnsafe('SELECT position,count(*)::int AS rows FROM "Player" GROUP BY position ORDER BY position NULLS LAST');
    audit.playerRateDenominators=(await tx.$queryRawUnsafe('SELECT count(*) FILTER (WHERE minutes>0 AND goals IS NOT NULL)::int AS goals_per90,count(*) FILTER (WHERE minutes>0 AND "shotsOnTarget" IS NOT NULL)::int AS sot_per90,count(*) FILTER (WHERE minutes>0 AND xg IS NOT NULL)::int AS xg_per90,count(*) FILTER (WHERE shots>0 AND goals IS NOT NULL)::int AS conversion FROM "PlayerMatchStats"'))[0];
    audit.oddsPhases=await tx.$queryRawUnsafe('SELECT phase,count(*)::int AS rows,count("quotedAt")::int AS quoted FROM "HistoricalOddsQuote" GROUP BY phase ORDER BY phase');
    const source={};
    // Bounded by current local tables, not an API/backfill. Large odds/outcome tables
    // are aggregated above; only timestamped odds can enter the feature archive.
    for(const [key,table] of Object.entries({fixtures:'Fixture',leagues:'League',seasons:'Season',snapshots:'LiveSnapshot',marketSnapshots:'LiveMarketSnapshot',teamStats:'TeamMatchStats',periodStats:'TeamPeriodStats'}))
      source[key]=await tx.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`);
    source.odds=[...await tx.$queryRawUnsafe('SELECT * FROM "HistoricalOddsQuote" WHERE "quotedAt" IS NOT NULL AND "quotedAt" <= "receivedAt" ORDER BY id'),
      ...await tx.$queryRawUnsafe('SELECT * FROM "OddsSnapshot" WHERE "receivedAt" IS NOT NULL AND timestamp <= "receivedAt" ORDER BY id')];
    // The current schema has no immutable halftime observation table. A verified
    // HT state is required; never manufacture it from 45-minute snapshots or FT archives.
    source.halftimeObservations=[];
    return {version:VERSION,audit,source};
  },{isolationLevel:'RepeatableRead',timeout:180000,maxWait:10000});}finally{await db.$disconnect();}
}

function cell(value){if(value===null||value===undefined)return '\\N';const s=typeof value==='object'?JSON.stringify(value):String(value);return '"'+s.replaceAll('"','""')+'"';}
function csv(columns,rows){return columns.join(',')+'\n'+rows.map(r=>columns.map(k=>cell(r[k])).join(',')).join('\n')+(rows.length?'\n':'');}

async function main(){
  // Disable HTTP for both capture and replay, including accidental future imports.
  global.fetch=async()=>{throw Error('ML_FOUNDATION_NETWORK_FORBIDDEN');};
  const archive=args.source?JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(args.source)))):JSON.parse(stringify(await capture()));
  if(archive.version!==VERSION||!archive.source||archive.audit.readOnly!=='on')throw Error('INVALID_SOURCE_ARCHIVE');
  const seasons=[...new Set(archive.source.seasons.map(s=>Number(String(s.key).slice(0,4))).filter(y=>y>=1900&&y<=2100))].sort((a,b)=>a-b);
  if((!args['validation-start']||!args['test-start'])&&seasons.length<3)throw Error('EXPLICIT_CHRONOLOGICAL_BOUNDARIES_REQUIRED');
  const boundaries={validationStart:args['validation-start']??`${seasons.at(-2)}-07-01T00:00:00.000Z`,testStart:args['test-start']??`${seasons.at(-1)}-07-01T00:00:00.000Z`};
  const output=path.resolve(args.out??path.join(root,'data/ml'));
  if(fs.existsSync(path.join(output,'manifest.json')))throw Error('OUTPUT_ALREADY_EXISTS_USE_NEW_OUT');
  const built=buildDatasets(archive.source,boundaries);
  fs.mkdirSync(output,{recursive:true});const artifacts={};
  const write=(file,content)=>{const target=path.join(output,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);artifacts[file]={sha256:hash(content),bytes:Buffer.byteLength(content)};};
  const sourceBytes=Buffer.from(stringify(archive));write('source.json.gz',zlib.gzipSync(sourceBytes,{level:9}));
  const counts={},groupCounts={};
  for(const [name,rows] of Object.entries(built.datasets)) {
    const defaultLabels=name==='live_minute_dataset'?require('../src/services/ml/foundation.ts').LIVE_LABELS:
      name==='halftime_second_half_goal_dataset'?['onePlusGoals2H','twoPlusGoals2H','threePlusGoals2H']:
      name==='prematch_goal_dataset'?['goalsFT']:name==='prematch_corner_dataset'?['cornersFT']:['cardsFT'];
    const labels=[...defaultLabels];counts[name]={};
    for(const split of ['train','validation','test']) {
      const part=rows.filter(r=>r.split===split);
      write(`${split}/${name}.features.csv`,csv(['rowId','features'],part));
      write(`${split}/${name}.labels.csv`,csv(['rowId',...labels],part.map(r=>({rowId:r.rowId,...r.labels}))));
      write(`${split}/${name}.metadata.csv`,csv(['rowId','fixtureId','provider','leagueId','seasonId','kickoff','capturedAt','sourceId','trainingEligible','eligibilityReason','usableLabels','labelAvailableAt'],part));
      counts[name][split]={rows:part.length,fixtures:new Set(part.map(r=>r.fixtureId)).size,eligibleRows:part.filter(r=>r.trainingEligible).length,
        labels:Object.fromEntries(labels.map(label=>[label,{known:part.filter(r=>r.labels[label]!==null).length,usable:part.filter(r=>r.usableLabels.includes(label)).length}]))};
    }
  }
  for(const [market,labels]of Object.entries(MARKETS)) {
    const rows=built.datasets[market==='GOALS_2H'?'halftime_second_half_goal_dataset':'live_minute_dataset'];
    groupCounts[market]=Object.fromEntries(['train','validation','test'].map(split=>[split,{rows:rows.filter(r=>r.split===split&&labels.every(l=>r.usableLabels.includes(l))).length,
      fixtures:new Set(rows.filter(r=>r.split===split&&labels.every(l=>r.usableLabels.includes(l))).map(r=>r.fixtureId)).size}]));
  }
  write('quarantine/exclusions.csv',csv(['table','id','fixtureId','reason'],built.excluded));
  const candidateColumns=['fixtureId','provider','leagueId','seasonId','kickoff','split','prematch_goal_dataset','halftime_second_half_goal_dataset','prematch_corner_dataset','prematch_card_dataset','reason'];
  write('quarantine/historical_outcomes_only.csv',csv(candidateColumns,built.candidates));
  const leagues=new Map(archive.source.leagues.map(l=>[l.id,l]));
  const leagueCoverage=[];
  for(const id of [...new Set(built.candidates.map(c=>c.leagueId))].sort()) {
    const rows=built.candidates.filter(c=>c.leagueId===id),league=leagues.get(id);
    leagueCoverage.push({leagueId:id,name:league.name,provider:league.provider,fixtures:rows.length,
      ...Object.fromEntries(candidateColumns.slice(6,10).map(k=>[k,rows.filter(c=>c[k]!==null).length]))});
  }
  const candidateCounts=Object.fromEntries(candidateColumns.slice(6,10).map(k=>[k,Object.fromEntries(['train','validation','test'].map(split=>[split,built.candidates.filter(c=>c.split===split&&c[k]!==null).length]))]));
  const seasonCoverage=archive.source.seasons.map(s=>({key:s.key,leagueId:s.leagueId,fixtures:archive.source.fixtures.filter(f=>f.seasonId===s.id).length}));
  const exclusions={};for(const row of built.excluded)exclusions[row.reason]=(exclusions[row.reason]??0)+1;
  const tally=(rows,key)=>rows.reduce((acc,row)=>{const k=row[key]??'NULL';acc[k]=(acc[k]??0)+1;return acc;},{});
  const sourceStatistics={fixturesByProvider:tally(archive.source.fixtures,'provider'),fixturesByStatus:tally(archive.source.fixtures,'status'),
    kickoffPrecision:tally(archive.source.fixtures,'kickoffPrecision'),leagues:archive.source.leagues.length,
    seasonRecords:archive.source.seasons.length,distinctSeasons:[...new Set(archive.source.seasons.map(s=>s.key))].sort(),
    kickoffMin:archive.source.fixtures.map(f=>f.kickoff).sort()[0]??null,kickoffMax:archive.source.fixtures.map(f=>f.kickoff).sort().at(-1)??null,
    snapshotMin:archive.source.snapshots.map(s=>s.timestamp).sort()[0]??null,snapshotMax:archive.source.snapshots.map(s=>s.timestamp).sort().at(-1)??null,
    minuteMin:Math.min(...archive.source.snapshots.filter(s=>s.minute!==null).map(s=>s.minute)),minuteMax:Math.max(...archive.source.snapshots.filter(s=>s.minute!==null).map(s=>s.minute)),
    distinctObservedMinutes:new Set(archive.source.snapshots.filter(s=>s.minute!==null).map(s=>s.minute)).size};
  const audit={...archive.audit,sourceStatistics,boundaries,counts,markets:groupCounts,candidateCounts,leagueCoverage:leagueCoverage.sort((a,b)=>b.fixtures-a.fixtures||a.leagueId.localeCompare(b.leagueId)),seasonCoverage,exclusions,
    historicalBuilder:{file:'src/services/historical/teamProfile.ts',policy:'OBSERVED_BEFORE_CUTOFF',windows:[5,10,20],venues:['HOME','AWAY'],retroactiveBackfillFeatures:false},
    missingHalftimeProvenance:true,cardDefinition:'YELLOW_PLUS_RED_COUNTS; no deduplication of second-yellow without source evidence'};
  write('audit.json',stringify(audit));
  const codeFiles=['scripts/ml-dataset.cjs','src/services/ml/foundation.ts','src/services/ml/paper-betting.schema.json','src/services/historical/teamProfile.ts','src/services/training/pointInTime.ts','src/services/training/oddsIntegrity.ts','package-lock.json'];
  const manifest={version:VERSION,sourceSha256:hash(sourceBytes),boundaries,format:'CSV_RFC4180_UTF8',nullEncoding:'\\N; nested JSON uses null',
    featureColumn:'features (JSON); explicit allowlist, no labels',metadataIsNotFeatures:true,modelsTrained:false,
    labelUnits:{goalNext:'binary 0/1',goalsRemaining:'count',cornersNext:'count',cardsNext:'yellow+red count',shotsOnTargetNext:'count',goals2H:'binary cumulative 1+/2+/3+'},
    counts,markets:groupCounts,code:Object.fromEntries(codeFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),artifacts};
  fs.writeFileSync(path.join(output,'manifest.json'),stringify(manifest));
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});
  if(!args.source)fs.writeFileSync(path.join(root,'reports/ML_DATASET_FOUNDATION_AUDIT.json'),stringify(audit));
  console.log(stringify({output,sourceSha256:manifest.sourceSha256,counts,candidateCounts,exclusions}));
}
main().catch(error=>{console.error(/^[A-Z_]+$/.test(error.message)?error.message:'ML_EXPORT_FAILED: inspect database availability, schema and output permissions; no provider requests were made.');process.exitCode=1;});
