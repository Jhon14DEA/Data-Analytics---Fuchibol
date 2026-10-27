import type { PrismaClient } from '@prisma/client';
import type { MatchSummary } from '../../types/domain';
import { createTeamHistoricalProfileSetBuilder, type calculateTeamHistoricalProfile } from './teamProfile';
import { TEAM_MAPPING_METHODS } from './teamProviderMapping';
type Profile=ReturnType<typeof calculateTeamHistoricalProfile>;
type Mapping={kind:string;leftProvider:string;leftExternalId:string;rightProvider:string;rightExternalId:string;method:string;createdAt:Date};
export function mappedHistoricalTeam(provider:string,id:string,mappings:Mapping[],before:Date):string|null{
 const hits=mappings.filter(m=>m.kind==='TEAM'&&TEAM_MAPPING_METHODS.includes(m.method as typeof TEAM_MAPPING_METHODS[number])&&m.createdAt<before).flatMap(m=>m.leftProvider===provider&&m.leftExternalId===id&&m.rightProvider==='FOOTBALL_DATA'?[m.rightExternalId]:m.rightProvider===provider&&m.rightExternalId===id&&m.leftProvider==='FOOTBALL_DATA'?[m.leftExternalId]:[]);
 const ids=[...new Set(hits)];return ids.length===1?ids[0]:null;
}
export function historicalComparison(home:Profile|undefined,away:Profile|undefined,market:'OVER05_1H'|'OVER05_FT'){
 const key=market==='OVER05_1H'?'over05HtRate':'over05FtRate';
 if(!home||!away||home.sampleSize<10||away.sampleSize<10)return null;
 const h=home.features[key],a=away.features[key];if(h===null||a===null)return null;
 return h>0.5&&a>0.5?'HISTÓRICO APOYA':h<0.5&&a<0.5?'HISTÓRICO CONTRADICE':'HISTÓRICO NEUTRO';
}
export type LiveHistoricalContext={status:'AVAILABLE'|'N/D';reason:string|null;before:string|null;latencyMs:number;home:Profile[];away:Profile[];comparison:Record<'OVER05_1H'|'OVER05_FT',ReturnType<typeof historicalComparison>>};
export function unavailableHistoricalContext(reason:string,latencyMs=0):LiveHistoricalContext{return{status:'N/D',reason,before:null,latencyMs,home:[],away:[],comparison:{OVER05_1H:null,OVER05_FT:null}};}
export function createLiveHistoricalContextReader(db:Pick<PrismaClient,'providerEntityMapping'|'team'|'fixture'>){
 const profiles=createTeamHistoricalProfileSetBuilder(db);
 return async(match:MatchSummary):Promise<LiveHistoricalContext>=>{
  const started=Date.now(),before=new Date(match.kickoffAt??'');
  const provider=match.source==='allsports'?'AllSportsApi':match.source==='api-football'?'API-Football':null;
  if(match.status!=='LIVE'||!provider)return unavailableHistoricalContext('NOT_REAL_LIVE');
  if(!Number.isFinite(before.getTime())||before.getTime()>Date.now())return unavailableHistoricalContext('KICKOFF_UNKNOWN');
  if(match.homeTeamExternalId==null||match.awayTeamExternalId==null)return unavailableHistoricalContext('NO_MAPPING');
  try{
   const ids=[String(match.homeTeamExternalId),String(match.awayTeamExternalId)];
   const maps=await db.providerEntityMapping.findMany({where:{kind:'TEAM',createdAt:{lt:before},OR:[{leftProvider:provider,leftExternalId:{in:ids},rightProvider:'FOOTBALL_DATA'},{rightProvider:provider,rightExternalId:{in:ids},leftProvider:'FOOTBALL_DATA'}]}});
   const target=ids.map(id=>mappedHistoricalTeam(provider,id,maps,before));
   if(target.some(t=>t===null)||target[0]===target[1])return unavailableHistoricalContext('NO_UNAMBIGUOUS_MAPPING',Date.now()-started);
   const teams=await db.team.findMany({where:{provider:'FOOTBALL_DATA',externalId:{in:target as string[]}},select:{id:true,externalId:true}});
   const homeId=teams.find(t=>t.externalId===target[0])?.id,awayId=teams.find(t=>t.externalId===target[1])?.id;
   if(!homeId||!awayId)return unavailableHistoricalContext('MAPPING_TARGET_MISSING',Date.now()-started);
   // Four bounded reads, not twelve window queries. All values are read-only sidecar data.
   const home=[...await profiles(homeId,before,'ALL'),...await profiles(homeId,before,'HOME')];
   const away=[...await profiles(awayId,before,'ALL'),...await profiles(awayId,before,'AWAY')];
   const h=home.find(p=>p.window===10&&p.venue==='HOME'),a=away.find(p=>p.window===10&&p.venue==='AWAY');
   return{status:home.some(p=>p.sampleSize)&&away.some(p=>p.sampleSize)?'AVAILABLE':'N/D',reason:home.some(p=>p.sampleSize)&&away.some(p=>p.sampleSize)?null:'NO_OBSERVED_HISTORY',before:before.toISOString(),latencyMs:Date.now()-started,home,away,comparison:{OVER05_1H:historicalComparison(h,a,'OVER05_1H'),OVER05_FT:historicalComparison(h,a,'OVER05_FT')}};
  }catch{return unavailableHistoricalContext('HISTORICAL_READ_FAILED',Date.now()-started);}
 };
}
// Request-driven bounded cache; no timer, polling or provider requests. Cutoff and IDs are part of key.
const cache=new Map<string,{expires:number;value:Promise<LiveHistoricalContext>}>();
export async function getLiveHistoricalContext(match:MatchSummary){
 try{
 const key=JSON.stringify([match.id,match.source,match.status,match.kickoffAt,match.homeTeamExternalId,match.awayTeamExternalId]);
 const found=cache.get(key);if(found&&found.expires>Date.now())return{...await found.value,latencyMs:0};
 const {prisma}=await import('../../lib/prisma');
 if(cache.size>=128)cache.delete(cache.keys().next().value!);
 const value=createLiveHistoricalContextReader(prisma)(match);cache.set(key,{expires:Date.now()+120000,value});return value;
 }catch{return unavailableHistoricalContext('HISTORICAL_READ_FAILED');}
}
