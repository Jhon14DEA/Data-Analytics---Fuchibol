import type { Prisma } from '@prisma/client';
import { exact } from './scope';
import { persistMapping, type Identity } from './mapping';
import type { HistoricalBatch, HistoricalFixture } from './types';
export function historicalTeamName(name:string){const key=exact(name);return ({'man united':'manchester united'} as Record<string,string>)[key]??key;}
export function fixtureIdentity(b:HistoricalBatch,f:HistoricalFixture):Identity {
  return{provider:b.provider,id:f.id,name:'',competitionKey:`${exact(b.competition.country??'')}:${exact(b.competition.name)}`,home:historicalTeamName(f.home.name),away:historicalTeamName(f.away.name),kickoff:f.kickoff};
}
export async function mappedHistoricalFixture(tx:Prisma.TransactionClient,b:HistoricalBatch,f:HistoricalFixture){
  const mappings=await tx.providerEntityMapping.findMany({where:{kind:'FIXTURE',OR:[{leftProvider:b.provider,leftExternalId:f.id},{rightProvider:b.provider,rightExternalId:f.id}]}});
  const references=mappings.map(m=>m.leftProvider===b.provider?{provider:m.rightProvider,externalId:m.rightExternalId}:{provider:m.leftProvider,externalId:m.leftExternalId});
  // Fence both directions of a known mapping before checking canonical records.
  const source=fixtureIdentity(b,f);
  const key=[source.competitionKey,source.home,source.away,new Date(source.kickoff!).toISOString()].join('|');
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  if(b.provider==='API-Football'||b.provider==='FOOTBALL_DATA'){
    const day=f.kickoff.slice(0,10),next=new Date(Date.parse(day+'T00:00:00Z')+86400000);
    const uncertain=await tx.fixture.findMany({where:{provider:b.provider==='FOOTBALL_DATA'?'API-Football':'FOOTBALL_DATA',kickoff:{gte:new Date(day+'T00:00:00Z'),lt:next},...(f.kickoffPrecision==='DATE'?{}:{kickoffPrecision:'DATE'}),league:{name:b.competition.name,country:b.competition.country}},include:{homeTeam:true,awayTeam:true}});
    if(uncertain.some(c=>historicalTeamName(c.homeTeam.name)===historicalTeamName(f.home.name)&&historicalTeamName(c.awayTeam.name)===historicalTeamName(f.away.name)))throw Error('DATE_ONLY_MAPPING_REQUIRES_VERIFICATION');
  }
  const mapped=references.length?await tx.fixture.findMany({where:{OR:references},include:{homeTeam:true,awayTeam:true,league:true}}):[];
  let candidates=mapped;
  if(!references.length){
    candidates=await tx.fixture.findMany({where:{provider:b.provider==='FOOTBALL_DATA'?'API-Football':b.provider==='API-Football'?'FOOTBALL_DATA':'__NONE__',status:'FINISHED',kickoff:new Date(f.kickoff),league:{name:b.competition.name,country:b.competition.country}},include:{homeTeam:true,awayTeam:true,league:true}});
    const exactMatches=candidates.filter(c=>historicalTeamName(c.homeTeam.name)===historicalTeamName(f.home.name)&&historicalTeamName(c.awayTeam.name)===historicalTeamName(f.away.name));
    if(candidates.length&&!exactMatches.length)throw Error('UNRESOLVED_CROSS_PROVIDER_IDENTITY');
    candidates=exactMatches;
  }
  if(candidates.length>1)throw Error('AMBIGUOUS_HISTORICAL_IDENTITY');
  const c=candidates[0];if(!c)return null;
  if(c.status!=='FINISHED'||exact(c.league.name)!==exact(b.competition.name)||exact(c.league.country??'')!==exact(b.competition.country??'')||historicalTeamName(c.homeTeam.name)!==historicalTeamName(f.home.name)||historicalTeamName(c.awayTeam.name)!==historicalTeamName(f.away.name)||c.kickoff.getTime()!==Date.parse(f.kickoff))throw Error('MAPPED_FIXTURE_IDENTITY_CONFLICT');
  const target={...source,provider:c.provider,id:c.externalId};
  if(!references.length)await persistMapping(tx,'FIXTURE',source,target,'EXACT_IDENTITY');
  await persistMapping(tx,'COMPETITION',{provider:b.provider,id:b.competition.id,name:b.competition.name,country:b.competition.country},{provider:c.provider,id:c.league.externalId,name:c.league.name,country:c.league.country},'EXACT_IDENTITY');
  for(const side of ['home','away'] as const){const other=side==='home'?c.homeTeam:c.awayTeam;await persistMapping(tx,'TEAM',{provider:b.provider,id:f[side].id,name:historicalTeamName(f[side].name),competitionKey:source.competitionKey},{provider:c.provider,id:other.externalId,name:historicalTeamName(other.name),competitionKey:source.competitionKey},'EXACT_IDENTITY');}
  return c;
}
