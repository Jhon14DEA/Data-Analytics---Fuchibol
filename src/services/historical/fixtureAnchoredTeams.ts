import { Prisma, type PrismaClient } from '@prisma/client';
import { exact } from './scope';
import { TEAM_MAPPING_METHODS } from './teamProviderMapping';
export type AnchorRaw={fixture:{id:number|string;date?:string;timestamp?:number};teams:{home:{id:number;name:string};away:{id:number;name:string}};league:{id:number;name:string;country?:string}};
type Side={externalId:string;name:string;country:string|null};
export type AnchorSource={provider:string;externalId:string;kickoff:Date;kickoffPrecision:string;homeTeam:Side;awayTeam:Side;league:{name:string;country:string|null}};
export function verifyFixtureTeamAnchor(source:AnchorSource,apiId:string,raw:AnchorRaw){
 if(!raw?.fixture||!raw.teams?.home||!raw.teams?.away||!raw.league||!Number.isFinite(source.kickoff.getTime()))return false;
 if(![source.externalId,source.homeTeam.externalId,source.awayTeam.externalId,apiId].every(id=>/^[1-9]\d*$/.test(id)))return false;
 if(raw.fixture.date&&!/(Z|[+-]\d{2}:\d{2})$/i.test(raw.fixture.date))return false;
 const time=raw.fixture.date?Date.parse(raw.fixture.date):(raw.fixture.timestamp??NaN)*1000;
 if(raw.fixture.date&&raw.fixture.timestamp!==undefined&&Math.abs(time-raw.fixture.timestamp*1000)>1000)return false;
 if(source.provider!=='AllSportsApi'||source.kickoffPrecision!=='EXACT'||String(raw.fixture.id)!==apiId||!Number.isFinite(time)||Math.abs(source.kickoff.getTime()-time)>300000)return false;
 if(!raw.league.country?.trim()||exact(source.league.name)!==exact(raw.league.name)||source.league.country&&exact(source.league.country)!==exact(raw.league.country))return false;
 if(source.homeTeam.externalId===source.awayTeam.externalId||raw.teams.home.id===raw.teams.away.id)return false;
 return (['home','away'] as const).every(side=>{const a=side==='home'?source.homeTeam:source.awayTeam,b=raw.teams[side];return !!a.externalId&&Number.isSafeInteger(b.id)&&b.id>0&&!!b.name?.trim()&&exact(a.name)===exact(b.name)&&(!a.country||exact(a.country)===exact(raw.league.country!));});
}
type Ref={provider:string;id:string};
export function mappingConflict(a:Ref,b:Ref,rows:{kind:string;leftProvider:string;leftExternalId:string;rightProvider:string;rightExternalId:string}[]){
 return rows.some(m=>m.kind==='TEAM'&&(m.leftProvider===a.provider&&m.rightProvider===b.provider&&((m.leftExternalId===a.id&&m.rightExternalId!==b.id)||(m.rightExternalId===b.id&&m.leftExternalId!==a.id))||m.rightProvider===a.provider&&m.leftProvider===b.provider&&((m.rightExternalId===a.id&&m.leftExternalId!==b.id)||(m.leftExternalId===b.id&&m.rightExternalId!==a.id))));
}
// Only a proven explicit spelling pair, and both identities must be present in this country.
const aliasPairs=[['man city','manchester city'],['man united','manchester united'],['inter milan','inter'],['psg','paris saint-germain']];
export function selectHistoricalBridge(api:{name:string;country:string},teams:{externalId:string;name:string;country:string|null}[],persistedIds:string[]=[]){
 const scoped=teams.filter(t=>t.country&&exact(t.country)===exact(api.country));
 if(new Set(persistedIds).size>1)return{status:'AMBIGUOUS',target:null,alias:false} as const;
 const alias=(name:string)=>aliasPairs.some(pair=>pair.includes(exact(api.name))&&pair.includes(exact(name)));
 const matches=scoped.filter(t=>persistedIds.length?t.externalId===persistedIds[0]:exact(t.name)===exact(api.name)||alias(t.name));
 return{status:matches.length===1?'MAPPED':matches.length?'AMBIGUOUS':'NO_MATCH',target:matches.length===1?matches[0]:null,alias:matches.length===1&&exact(matches[0].name)!==exact(api.name)} as const;
}
export async function preserveFixtureAnchoredTeams(db:PrismaClient,matchId:string,raw:AnchorRaw,receivedAt:string){
 if(!Number.isFinite(Date.parse(receivedAt))||Date.parse(receivedAt)>Date.now())throw Error('INVALID_ANCHOR_RECEIPT');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('historical-team-provider-mapping'))`;
  const source=await tx.fixture.findUnique({where:{id:matchId},include:{homeTeam:true,awayTeam:true,league:true}});
  if(!source)throw Error('ANCHOR_SOURCE_MISSING');
  const scout=await tx.hybridScout.findUnique({where:{matchId}});
  const apiId=String(raw.fixture.id);
  const fixtureLinks=await tx.providerEntityMapping.findMany({where:{kind:'FIXTURE',OR:[{leftProvider:'AllSportsApi',leftExternalId:source.externalId,rightProvider:'API-Football'},{rightProvider:'AllSportsApi',rightExternalId:source.externalId,leftProvider:'API-Football'}]}});
  const mappedIds=[...new Set([...(scout?.apiFootballFixtureId&&scout.allSportsFixtureId===source.externalId?[scout.apiFootballFixtureId]:[]),...fixtureLinks.filter(m=>['VERIFIED_PROVIDER_ID','EXACT_IDENTITY','FIXTURE_ANCHORED'].includes(m.method)).map(m=>m.leftProvider==='API-Football'?m.leftExternalId:m.rightExternalId)])];
  if(mappedIds.length!==1||mappedIds[0]!==apiId||!verifyFixtureTeamAnchor(source,apiId,raw))throw Error('UNCONFIRMED_OR_CONTRADICTORY_FIXTURE_ANCHOR');
  const reverseFixtureLinks=await tx.providerEntityMapping.findMany({where:{kind:'FIXTURE',OR:[{leftProvider:'API-Football',leftExternalId:apiId,rightProvider:'AllSportsApi'},{rightProvider:'API-Football',rightExternalId:apiId,leftProvider:'AllSportsApi'}]}});
  if(reverseFixtureLinks.some(m=>(m.leftProvider==='AllSportsApi'?m.leftExternalId:m.rightExternalId)!==source.externalId))throw Error('AMBIGUOUS_FIXTURE_ANCHOR');
  if(scout){const identity=scout.identity as {home?:string;away?:string;league?:string};if(!identity.home||!identity.away||!identity.league||exact(identity.home)!==exact(source.homeTeam.name)||exact(identity.away)!==exact(source.awayTeam.name)||exact(identity.league)!==exact(source.league.name))throw Error('SCOUT_IDENTITY_CONFLICT');}
  const others=await tx.hybridScout.count({where:{apiFootballFixtureId:apiId,NOT:{matchId}}});if(others)throw Error('AMBIGUOUS_FIXTURE_ANCHOR');
  const links=await tx.providerEntityMapping.findMany({where:{kind:'TEAM'}});
  const historical=await tx.team.findMany({where:{provider:'FOOTBALL_DATA',country:raw.league.country!},select:{externalId:true,name:true,country:true}});
  const evidence={version:1,allSportsFixtureId:source.externalId,apiFixtureId:apiId,kickoff:source.kickoff.toISOString(),receivedAt,league:raw.league,teams:raw.teams,orientation:'HOME_HOME_AWAY_AWAY'};
  const counts={allSportsApiCreated:0,apiFootballDataCreated:0,allSportsFootballDataCreated:0,reused:0,bridgeNoMatch:0,bridgeAmbiguous:0,apiTeamsCreated:0};
  async function link(a:Ref,b:Ref,method:string){
   if(mappingConflict(a,b,links))throw Error('TEAM_MAPPING_CONFLICT');
   const found=links.find(m=>m.leftProvider===a.provider&&m.leftExternalId===a.id&&m.rightProvider===b.provider&&m.rightExternalId===b.id||m.rightProvider===a.provider&&m.rightExternalId===a.id&&m.leftProvider===b.provider&&m.leftExternalId===b.id);
   if(found){if(!TEAM_MAPPING_METHODS.includes(found.method as typeof TEAM_MAPPING_METHODS[number]))throw Error('UNTRUSTED_EXISTING_TEAM_MAPPING');counts.reused++;return false;}
   const [l,r]=a.provider<b.provider?[a,b]:[b,a];
   const row=await tx.providerEntityMapping.create({data:{kind:'TEAM',leftProvider:l.provider,leftExternalId:l.id,rightProvider:r.provider,rightExternalId:r.id,method,evidence:evidence as unknown as Prisma.InputJsonValue}});links.push(row);return true;
  }
  for(const side of ['home','away'] as const){
   const team=raw.teams[side],api:Ref={provider:'API-Football',id:String(team.id)},all:Ref={provider:'AllSportsApi',id:(side==='home'?source.homeTeam:source.awayTeam).externalId};
   const existing=await tx.team.findUnique({where:{provider_externalId:{provider:api.provider,externalId:api.id}}});
   if(existing&&(exact(existing.name)!==exact(team.name)||existing.country&&exact(existing.country)!==exact(raw.league.country!)))throw Error('API_TEAM_IDENTITY_CONFLICT');
   if(!existing){await tx.team.create({data:{provider:api.provider,externalId:api.id,name:team.name,country:raw.league.country!}});counts.apiTeamsCreated++;}
   if(await link(all,api,'FIXTURE_ANCHORED'))counts.allSportsApiCreated++;
   const ids=links.filter(m=>TEAM_MAPPING_METHODS.includes(m.method as typeof TEAM_MAPPING_METHODS[number])).flatMap(m=>m.leftProvider===api.provider&&m.leftExternalId===api.id&&m.rightProvider==='FOOTBALL_DATA'?[m.rightExternalId]:m.rightProvider===api.provider&&m.rightExternalId===api.id&&m.leftProvider==='FOOTBALL_DATA'?[m.leftExternalId]:[]);
   const bridge=selectHistoricalBridge({name:team.name,country:raw.league.country!},historical,ids);
   if(!bridge.target){if(bridge.status==='AMBIGUOUS')counts.bridgeAmbiguous++;else counts.bridgeNoMatch++;continue;}
   const fd={provider:'FOOTBALL_DATA',id:bridge.target.externalId};
   if(await link(api,fd,bridge.alias?'CONTROLLED_ALIAS':'EXACT_IDENTITY'))counts.apiFootballDataCreated++;
   if(await link(all,fd,'FIXTURE_ANCHORED'))counts.allSportsFootballDataCreated++;
  }
  return counts;
 },{timeout:15000});
}
