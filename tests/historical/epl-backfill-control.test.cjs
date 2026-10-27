const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {seasonStatus,shouldSkip,acquireLock}=require('../../scripts/football-data-backfill-control.cjs');
test('completed legacy seasons and failures skip without source access',()=>{
 assert.equal(seasonStatus({status:'SUCCEEDED'}),'COMPLETE');
 assert.equal(shouldSkip({status:'SUCCEEDED'}),true);
 const failed={status:'FAILED',cursor:'checksum:350',backfillMetadata:{status:'FAILED'}};
 const before=JSON.stringify(failed);assert.equal(shouldSkip(failed),true);assert.equal(JSON.stringify(failed),before);
});
test('pending and interrupted running seasons remain resumable',()=>{
 assert.equal(seasonStatus(undefined),'PENDING');
 assert.equal(shouldSkip({status:'READY',backfillMetadata:{status:'PENDING'}}),false);
 assert.equal(shouldSkip({status:'READY',cursor:'checksum:350',backfillMetadata:{status:'RUNNING'}}),false);
});
test('lock rejects live process and recovers a dead process without deleting live lock',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fut-backfill-lock-')),file=path.join(dir,'run.lock');
 const kill=process.kill;
 try{
  acquireLock(file);const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>acquireLock(file),/BACKFILL_ALREADY_RUNNING/);assert.equal(fs.readFileSync(file,'utf8'),before);
  process.kill=()=>{const e=new Error('dead');e.code='ESRCH';throw e;};
  acquireLock(file);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pid,process.pid);
 }finally{process.kill=kill;fs.rmSync(dir,{recursive:true,force:true});}
});
