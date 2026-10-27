import type { PrismaClient } from '@prisma/client';
import type { Provider } from './scope';
import type { HistoricalBatch } from './types';
import { previewBatch, runHistoricalBatch } from './worker';
import { hash } from './persistence';
export interface HistoricalProvider { readonly provider:Provider; batches():Promise<HistoricalBatch[]> }
// Bridge for API-Football's normalized batches; transport remains separately controlled.
export class ApiFootballProvider implements HistoricalProvider {
  readonly provider='API-Football' as const;
  constructor(private readonly pages:HistoricalBatch[]){}
  async batches(){if(this.pages.some(p=>p.provider!==this.provider))throw Error('WRONG_PROVIDER');return this.pages;}
}
export async function runHistoricalProvider(source:HistoricalProvider,db?:PrismaClient,write=false){
  const batches=await source.batches();if(!batches.length)throw Error('EMPTY_PROVIDER_BATCHES');
  const previews=batches.map(b=>{if(b.provider!==source.provider)throw Error('WRONG_PROVIDER');return previewBatch(b);});
  if(previews.some(p=>Object.keys(p.rejected).length))throw Error('PROVIDER_PREFLIGHT_REJECTED');
  if(!write)return{mode:'DRY_RUN',provider:source.provider,fixtures:previews.reduce((n,p)=>n+p.accepted,0),pages:previews.length,rejected:0};
  if(!db)throw Error('DATABASE_REQUIRED');
  let pending=batches;
  const first=batches[0];
  const state=await db.historicalIngestionState.findFirst({where:{provider:source.provider,league:{externalId:first.competition.id},season:{key:first.season.key}}});
  if(state){
    if(state.rangeFrom.getTime()!==Date.parse(first.rangeFrom)||state.rangeTo.getTime()!==Date.parse(first.rangeTo))throw Error('PROVIDER_RESUME_RANGE_CHANGED');
    if(state.status==='SUCCEEDED'){
      if(source.provider==='FOOTBALL_DATA'&&state.lastBatchKey!==hash({...batches.at(-1)!,receivedAt:null}))throw Error('PROVIDER_COMPLETED_SOURCE_CHANGED');
      return{mode:'WRITE',state:'ALREADY_DONE',inserted:0,updated:0};
    }
    const start=batches.findIndex(b=>b.cursor===state.cursor);if(start<0)throw Error('PROVIDER_RESUME_SOURCE_CHANGED');pending=batches.slice(start);
  }
  let inserted=0,updated=0;
  for(const batch of pending){const result=await runHistoricalBatch(db,batch,{dryRun:false});
    if(!('state'in result)||!['READY','SUCCEEDED'].includes(result.state))throw Error('PROVIDER_BATCH_NOT_COMMITTED');
    if('inserted'in result){inserted+=result.inserted;updated+=result.updated;if(result.rejected)throw Error('PROVIDER_WRITE_REJECTED');}
  }
  return{mode:'WRITE',state:'SUCCEEDED',inserted,updated};
}
