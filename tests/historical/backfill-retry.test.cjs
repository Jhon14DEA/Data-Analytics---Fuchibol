const {test}=require('node:test'),assert=require('node:assert/strict');
const {shouldSkip}=require('../../scripts/football-data-backfill-control.cjs');
const {historicalError}=require('../../src/services/historical/errors.ts');
const worker=require('../../src/services/historical/worker.ts');
const {runHistoricalProvider}=require('../../src/services/historical/seasonWorker.ts');
const {FootballDataCsvProvider}=require('../../src/services/historical/footballDataCsv.ts');
const {hash}=require('../../src/services/historical/persistence.ts');
test('retry is explicit, preserves COMPLETE and leaves width failures alone',()=>{
 assert.equal(shouldSkip({status:'FAILED'}),true);
 assert.equal(shouldSkip({status:'FAILED'},true),false);
 assert.equal(shouldSkip({status:'SUCCEEDED'},true),true);
 assert.equal(shouldSkip({status:'FAILED',lastError:'CSV_WIDTH_MISMATCH'},true),true);
});
test('technical code, message and stack survive with credentials redacted',()=>{
 process.env.TEST_API_KEY='private-test-value';
 try{const e=Object.assign(new Error('Transaction timed out; private-test-value postgresql://user:pass@host/db'),{code:'P2028'});
 const d=historicalError(e);assert.equal(d.code,'P2028');assert.match(d.message,/Transaction timed out/);assert.ok(d.stack);
 assert.doesNotMatch(JSON.stringify(d),/private-test-value|user:pass/);
 }finally{delete process.env.TEST_API_KEY;}
});
test('failed seasons resume only remaining pages and completed replay writes nothing',async()=>{
 const original=worker.runHistoricalBatch;
 try{
  for(const [competition,offset]of [['SP1',50],['I1',200],['F1',250]]){
   const rows=Array.from({length:300},(_,i)=>`${competition},19/08/2000,H${i},A${i},1,0`).join('\n');
   const source=new FootballDataCsvProvider('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\n'+rows,competition,'0001');
   const first=source.pages[0],seen=[];
   const state={status:'FAILED',cursor:`${source.sourceHash}:${offset}`,rangeFrom:new Date(first.rangeFrom),rangeTo:new Date(first.rangeTo)};
   const db={historicalIngestionState:{findFirst:async()=>state}};
   worker.runHistoricalBatch=async(_db,b)=>{seen.push(b.cursor);return {state:b.nextCursor===null?'SUCCEEDED':'READY',inserted:b.fixtures.length,updated:0,rejected:0};};
   const result=await runHistoricalProvider(source,db,true);
   assert.equal(result.inserted,300-offset);assert.deepEqual(seen,source.pages.slice(offset/50).map(p=>p.cursor));
   state.status='SUCCEEDED';state.lastBatchKey=hash({...source.pages.at(-1),receivedAt:null});seen.length=0;
   assert.equal((await runHistoricalProvider(source,db,true)).state,'ALREADY_DONE');assert.equal(seen.length,0);
   state.status='FAILED';state.cursor='different-checksum:50';await assert.rejects(runHistoricalProvider(source,db,true),/SOURCE_CHANGED/);assert.equal(seen.length,0);
  }
 }finally{worker.runHistoricalBatch=original;}
});
