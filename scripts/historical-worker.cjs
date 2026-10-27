// Separate process. Input is an already available normalized provider batch; never fetches HTTP.
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
const file=args[args.indexOf('--input')+1];
if(!args.includes('--input')||!file||args.some((a,i)=>!['--input','--dry-run','--write'].includes(a)&&args[i-1]!=='--input')){
 console.error('Usage: historical-worker --input <normalized-provider-batch.json> [--dry-run | --write]');process.exit(1);
}
if(args.includes('--write')&&args.includes('--dry-run')){console.error('Choose --dry-run or --write');process.exit(1);}
const {previewBatch,runHistoricalBatch}=require('../.historical-build/services/historical/worker.js');
async function main(){
 const resolved=path.resolve(file);if(fs.statSync(resolved).size>2*1024*1024)throw Error('INPUT_SIZE_LIMIT');
 const batch=JSON.parse(fs.readFileSync(resolved,'utf8'));
 if(!args.includes('--write')){console.log(JSON.stringify(previewBatch(batch),null,2));return;}
 require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 const {PrismaClient}=require('@prisma/client');
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit','2');
 const db=new PrismaClient({datasourceUrl:url.toString()});
 try{console.log(JSON.stringify(await runHistoricalBatch(db,batch,{dryRun:false}),null,2));}finally{await db.$disconnect();}
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'HISTORICAL_WORKER_FAILED');process.exitCode=1;});
