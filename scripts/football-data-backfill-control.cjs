const fs=require('fs');
function seasonStatus(state){
 if(state?.status==='SUCCEEDED')return 'COMPLETE';
 if(state?.status==='FAILED'||state?.backfillMetadata?.status==='FAILED')return 'FAILED';
 return state?.backfillMetadata?.status==='RUNNING'||state?.status==='RUNNING'?'RUNNING':'PENDING';
}
function shouldSkip(state,retryFailed=false){
 const status=seasonStatus(state);
 return status==='COMPLETE'||status==='FAILED'&&(!retryFailed||state.lastError==='CSV_WIDTH_MISMATCH'||state.backfillMetadata?.error==='CSV_WIDTH_MISMATCH');
}
function acquireLock(file){
 if(fs.existsSync(file)){
  const previous=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Number.isInteger(previous.pid)||previous.pid<=0)throw Error('INVALID_BACKFILL_LOCK');
  try{process.kill(previous.pid,0);throw Error('BACKFILL_ALREADY_RUNNING');}
  catch(error){if(error.code!=='ESRCH')throw error;}
  fs.unlinkSync(file);
 }
 fs.writeFileSync(file,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'});
}
module.exports={seasonStatus,shouldSkip,acquireLock};
