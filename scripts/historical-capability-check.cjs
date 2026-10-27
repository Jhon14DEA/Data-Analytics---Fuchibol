// Explicit one-shot diagnostic. No application/Prisma imports or provider persistence hooks.
const fs=require('node:fs');
const {createProbe,quota}=require('./lib/provider-capability-check.cjs');
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const key=process.env.API_FOOTBALL_KEY?.trim();
const file='reports/provider-capability-observations.json';
const log={startedAt:new Date().toISOString(),configured:Boolean(key),requests:[],results:[],decision:'NO-GO'};
const clean=value=>JSON.parse(JSON.stringify(value??null).split(key||'__ABSENT_SECRET__').join('<redacted>'));
const save=()=>fs.writeFileSync(file,JSON.stringify(clean(log),null,2));
const errors=r=>r.payload?.errors??null;
const success=r=>r.ok&&(!errors(r)||Object.keys(errors(r)).length===0);
async function main(){
 if(!key)throw Error('KEY_MISSING');
 // Existing ledger prevents accidental second run within this phase.
 fs.writeFileSync(file,JSON.stringify(log),{flag:'wx'});
 const probe=createProbe({key,beforeRequest(request){log.requests.push(request);save();console.log(JSON.stringify(request));}});
 async function request(path,params){const r=await probe.request(path,params);log.results.push({endpoint:path,http:r.http,errors:clean(errors(r)),headers:r.headers});save();return r;}
 const status=await request('/status',{});
 log.account={plan:status.payload?.response?.subscription?.plan??null,active:status.payload?.response?.subscription?.active??null,quota:quota(status)};save();
 if(!success(status)||log.account.active!==true||log.account.quota.remaining===null||log.account.quota.remaining<2)return;
 const leagues=await request('/leagues',{id:'39',season:'2025'});
 const league=Array.isArray(leagues.payload?.response)?leagues.payload.response.find(x=>x.league?.id===39):null;
 const season=league?.seasons?.find(x=>x.year===2025);
 log.league={id:39,season:2025,catalogue:success(leagues)&&season?'AVAILABLE':'UNKNOWN',metadata:season?{year:season.year,start:season.start,end:season.end,coverage:season.coverage}:null};save();
 if(!success(leagues)||!season||!/^\d{4}-\d{2}-\d{2}$/.test(season.end)||!(new Date(season.end)<new Date()))return;
 const remaining=quota(leagues).remaining;if(remaining!==null&&remaining<1)return;
 const fixtures=await request('/fixtures',{league:'39',season:'2025',date:season.end,status:'FT'});
 const rows=Array.isArray(fixtures.payload?.response)?fixtures.payload.response:[];
 const valid=rows.filter(x=>x.league?.id===39&&x.league?.season===2025&&x.fixture?.status?.short==='FT'&&String(x.fixture?.date).slice(0,10)===season.end);
 log.historical={status:success(fixtures)&&valid.length?'AVAILABLE':'UNKNOWN',received:rows.length,matchingFinished:valid.length,fixtureIds:valid.map(x=>x.fixture.id),date:season.end};save();
}
main().catch(e=>{if(e.code==='EEXIST'){console.error('PHASE_LEDGER_EXISTS_NO_HTTP');process.exitCode=1;return;}log.error=/^[A-Z_]+$/.test(e.message)?e.message:'DIAGNOSTIC_FAILED_NO_RETRY';if(fs.existsSync(file))save();console.error(log.error);process.exitCode=1;}).finally(()=>{console.log(JSON.stringify(clean(log),null,2));});
