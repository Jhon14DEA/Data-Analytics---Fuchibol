require('../tests/register-typescript.cjs');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {reconstruct,reconstructionInput,RECONSTRUCTION_VERSION,HISTORICAL_POLICY}=require('../src/services/ml/historicalReconstruction.ts');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const m=/^--(source|out|validation-start|test-start)=(.+)$/.exec(a);if(!m)throw Error('INVALID_ARGUMENT');return [m[1],m[2]];}));
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const cell=x=>x==null?'\\N':'"'+(typeof x==='object'?JSON.stringify(x):String(x)).replaceAll('"','""')+'"';
const csv=(cols,row)=>cols.map(k=>cell(row[k])).join(',')+'\n';

function main(){
  global.fetch=async()=>{throw Error('OFFLINE_RECONSTRUCTION_NO_NETWORK');};
  const input=path.resolve(args.source??'data/ml/source.json.gz'),out=path.resolve(args.out??'data/ml/historical-v1');
  if(fs.existsSync(out))throw Error('OUTPUT_ALREADY_EXISTS');
  const bytes=zlib.gunzipSync(fs.readFileSync(input)),archive=JSON.parse(bytes);
  if(archive.version!=='ML_DATASET_FOUNDATION_V1')throw Error('INVALID_SOURCE_VERSION');
  const bounds={validationStart:args['validation-start']??'2023-07-01T00:00:00.000Z',testStart:args['test-start']??'2024-07-01T00:00:00.000Z'};
  const source=archive.source,files=new Map(),coverage={},coverageByLeague={},splits={},labels={},leagues={},seasons={},exclusions={},columns={};
  fs.mkdirSync(out,{recursive:true});
  const writeRow=(file,cols,row)=>{
    if(!files.has(file)){fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});const fd=fs.openSync(path.join(out,file),'wx');files.set(file,fd);fs.writeSync(fd,cols.join(',')+'\n');}
    fs.writeSync(files.get(file),csv(cols,row));
  };
  const excluded=reconstructionInput(source).excluded;
  for(const e of excluded)writeRow('excluded.csv',['fixtureId','dataset','reason'],{...e,dataset:'BOTH'});
  const fixtureSplits=new Map();let candidateRows=0;
  try{for(const row of reconstruct(source,bounds)) {
    candidateRows++;
    const {dataset,metadata:m,features,labels:target}=row;
    if(fixtureSplits.has(m.fixtureId)&&fixtureSplits.get(m.fixtureId)!==m.split)throw Error('FIXTURE_SPLIT_LEAKAGE');
    fixtureSplits.set(m.fixtureId,m.split);
    columns[dataset]??={features:Object.keys(features),labels:Object.keys(target)};
    if(!m.eligible){const k=`${dataset}:${m.reason}`;exclusions[k]=(exclusions[k]??0)+1;writeRow('excluded.csv',['fixtureId','dataset','reason'],{fixtureId:m.fixtureId,dataset,reason:m.reason});continue;}
    splits[dataset]??={train:0,validation:0,test:0};splits[dataset][m.split]++;
    coverage[dataset]??={};for(const [k,v]of Object.entries(features)){coverage[dataset][k]??={present:0,null:0};coverage[dataset][k][v===null?'null':'present']++;}
    coverageByLeague[dataset]??={};coverageByLeague[dataset][features.league]??={};
    for(const [k,v]of Object.entries(features)){const c=coverageByLeague[dataset][features.league];c[k]??={present:0,null:0};c[k][v===null?'null':'present']++;}
    labels[dataset]??={};for(const [k,v]of Object.entries(target)){labels[dataset][k]??={};const value=v===null?'NULL':String(v);labels[dataset][k][value]=(labels[dataset][k][value]??0)+1;}
    leagues[dataset]??={};leagues[dataset][features.league]=(leagues[dataset][features.league]??0)+1;
    seasons[dataset]??={};seasons[dataset][features.season]=(seasons[dataset][features.season]??0)+1;
    const rowId=`${dataset}:${m.fixtureId}`;
    writeRow(`${m.split}/${dataset}.features.csv`,['rowId',...columns[dataset].features],{rowId,...features});
    writeRow(`${m.split}/${dataset}.labels.csv`,['rowId',...columns[dataset].labels],{rowId,...target});
    writeRow(`${m.split}/${dataset}.metadata.csv`,['rowId','fixtureId','kickoff','leagueId','season','temporalPolicy','provenance'],{rowId,...m});
  }}finally{for(const fd of files.values())fs.closeSync(fd);}
  const hashes={};for(const file of files.keys())hashes[file]=digest(fs.readFileSync(path.join(out,file)));
  const report={version:RECONSTRUCTION_VERSION,temporalPolicy:HISTORICAL_POLICY,sourceAuditedAt:archive.audit.auditedAt,sourceSha256:digest(bytes),boundaries:bounds,
    priorPolicy:'FINISHED; kickoff before target; exclude target calendar day and preceding calendar day (no fabricated final whistle timestamp)',
    eligibility:'At least 5 previous HOME matches for home team and 5 previous AWAY matches for away team; HT requires consistent explicit HT scores',
    candidateRows,candidateFixtures:fixtureSplits.size,splits,leagues,seasons,labelDistributions:labels,nullByFeature:coverage,nullByFeatureByLeague:coverageByLeague,exclusions,duplicateOrInvalidFixtures:excluded,
    featureColumns:columns,modelsTrained:false,artifacts:hashes,
    codeHashes:Object.fromEntries(['scripts/historical-ml-reconstruction.cjs','src/services/ml/historicalReconstruction.ts','src/services/ml/foundation.ts'].map(f=>[f,digest(fs.readFileSync(f))]))};
  fs.writeFileSync(path.join(out,'manifest.json'),json(report));
  fs.writeFileSync('reports/HISTORICAL_ML_RECONSTRUCTION_V1_AUDIT.json',json(report));
  console.log(json({output:out,splits,leagues,exclusions,sourceSha256:report.sourceSha256}));
}
try{main();}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'HISTORICAL_RECONSTRUCTION_FAILED');process.exitCode=1;}
