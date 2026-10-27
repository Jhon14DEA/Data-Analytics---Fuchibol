import type { Prisma, PrismaClient } from '@prisma/client';
import { exact, scopeBinding, HISTORICAL_SCOPE } from './scope';
export const TEAM_MAPPING_METHODS=['VERIFIED_PROVIDER_ID','EXACT_IDENTITY','CONTROLLED_ALIAS','FIXTURE_ANCHORED'] as const;
export type TeamIdentity={provider:string;id:string;name:string;country:string|null;competitions:string[]};
export type TeamAlias={country:string;competition:string;names:string[]};
type Link={kind:string;leftProvider:string;leftExternalId:string;rightProvider:string;rightExternalId:string;method:string};
export type TeamResolution={status:'MAPPED'|'NO_MATCH'|'AMBIGUOUS';reason:string;target:TeamIdentity|null;method:string|null;reused:boolean};
const providers=['AllSportsApi','API-Football','FOOTBALL_DATA'];
export function canonicalTeamProvider(provider:string){return ({ALLSPORTS:'AllSportsApi',API_FOOTBALL:'API-Football',FOOTBALL_DATA:'FOOTBALL_DATA'} as Record<string,string>)[provider]??provider;}
// Only activate these spelling pairs when BOTH are observed in the same verified country/competition.
const proposals:TeamAlias[]=[{country:'England',competition:'premier-league',names:['Man City','Manchester City']},{country:'England',competition:'premier-league',names:['Man United','Manchester United']},{country:'Italy',competition:'serie-a',names:['Inter Milan','Inter']},{country:'France',competition:'ligue-1',names:['PSG','Paris Saint-Germain']}];
export function observedTeamAliases(teams:TeamIdentity[]):TeamAlias[]{return proposals.filter(a=>a.names.every(name=>teams.some(t=>exact(t.name)===exact(name)&&exact(t.country??'')===exact(a.country)&&t.competitions.includes(a.competition))));}
export function exactTeamCompetition(country:string|null,name:string){
 if(!country)return null;
 const matches=HISTORICAL_SCOPE.filter(s=>s.id&&exact(s.country)===exact(country)&&exact(s.name)===exact(name));
 const keys=[...new Set(matches.map(s=>s.key))];return keys.length===1?{country:matches[0].country,key:keys[0]}:null;
}
function sameScope(a:TeamIdentity,b:TeamIdentity){return !!a.country&&!!b.country&&exact(a.country)===exact(b.country)&&a.competitions.some(c=>b.competitions.includes(c));}
export function resolveTeamProviderMapping(source:TeamIdentity,targetProvider:string,candidates:TeamIdentity[],links:Link[],aliases:TeamAlias[]=[],knownTargetId?:string):TeamResolution{
 source={...source,provider:canonicalTeamProvider(source.provider)};targetProvider=canonicalTeamProvider(targetProvider);
 const no=(reason:string,status:'NO_MATCH'|'AMBIGUOUS'='NO_MATCH'):TeamResolution=>({status,reason,target:null,method:null,reused:false});
 if(!providers.includes(source.provider)||!providers.includes(targetProvider)||source.provider===targetProvider)return no('INVALID_PROVIDER_PAIR');
 const persisted=links.filter(m=>m.kind==='TEAM').flatMap(m=>m.leftProvider===source.provider&&m.leftExternalId===source.id&&m.rightProvider===targetProvider?[{id:m.rightExternalId,method:m.method}]:m.rightProvider===source.provider&&m.rightExternalId===source.id&&m.leftProvider===targetProvider?[{id:m.leftExternalId,method:m.method}]:[]);
 if(new Set(persisted.map(p=>p.id)).size>1)return no('CONFLICTING_PERSISTED_MAPPING','AMBIGUOUS');
 const pool=candidates.filter(t=>t.provider===targetProvider);
 const conflictingSource=(targetId:string)=>links.some(m=>m.kind==='TEAM'&&(m.leftProvider===source.provider&&m.rightProvider===targetProvider&&m.rightExternalId===targetId&&m.leftExternalId!==source.id||m.rightProvider===source.provider&&m.leftProvider===targetProvider&&m.leftExternalId===targetId&&m.rightExternalId!==source.id));
 if(persisted.length){
  const p=persisted[0],found=pool.filter(t=>t.id===p.id);
  if(found.length!==1)return no('PERSISTED_TARGET_NOT_UNIQUE',found.length?'AMBIGUOUS':'NO_MATCH');
  if(conflictingSource(p.id))return no('TARGET_ALREADY_LINKED','AMBIGUOUS');
  if(!TEAM_MAPPING_METHODS.includes(p.method as typeof TEAM_MAPPING_METHODS[number]))return no('UNTRUSTED_MAPPING_METHOD');
  if(source.country&&found[0].country&&exact(source.country)!==exact(found[0].country))return no('COUNTRY_CONFLICT');
  if(source.competitions.length&&found[0].competitions.length&&!source.competitions.some(c=>found[0].competitions.includes(c)))return no('COMPETITION_CONFLICT');
  return{status:'MAPPED',reason:'PERSISTED_MAPPING',target:found[0],method:p.method,reused:true};
 }
 if(!source.country||!source.competitions.length)return no('COUNTRY_OR_COMPETITION_UNVERIFIED');
 const scoped=pool.filter(t=>sameScope(source,t));
 const aliasMatch=(t:TeamIdentity)=>aliases.some(a=>exact(a.country)===exact(source.country!)&&source.competitions.includes(a.competition)&&t.competitions.includes(a.competition)&&a.names.map(exact).includes(exact(source.name))&&a.names.map(exact).includes(exact(t.name)));
 const identified=knownTargetId?scoped.filter(t=>t.id===knownTargetId):scoped.filter(t=>exact(t.name)===exact(source.name)||aliasMatch(t));
 // An exact-name hit cannot hide a second identity admitted by an explicit alias.
 if(identified.length>1)return no('MULTIPLE_TARGET_IDENTITIES','AMBIGUOUS');
 if(!identified.length)return no(knownTargetId?'KNOWN_ID_NOT_CONFIRMED':'NO_EXACT_OR_CONTROLLED_ALIAS');
 const target=identified[0];
 if(conflictingSource(target.id))return no('TARGET_ALREADY_LINKED','AMBIGUOUS');
 return{status:'MAPPED',reason:knownTargetId?'KNOWN_PROVIDER_ID':exact(source.name)===exact(target.name)?'EXACT_NAME':'OBSERVED_CONTROLLED_ALIAS',target,method:knownTargetId?'VERIFIED_PROVIDER_ID':exact(source.name)===exact(target.name)?'EXACT_IDENTITY':'CONTROLLED_ALIAS',reused:false};
}
export async function loadTeamMappingInventory(db:Pick<PrismaClient,'team'|'fixture'|'league'|'providerEntityMapping'>){
 const [teams,leagues,memberships,links]=await Promise.all([db.team.findMany({select:{provider:true,externalId:true,name:true,country:true,id:true}}),db.league.findMany(),db.fixture.findMany({distinct:['leagueId','homeTeamId','awayTeamId'],select:{leagueId:true,homeTeamId:true,awayTeamId:true}}),db.providerEntityMapping.findMany({where:{kind:{in:['TEAM','COMPETITION']}}})]);
 const leagueKeys=new Map<string,{country:string;key:string}>();
 for(const league of leagues){
  const binding=scopeBinding(league.provider as 'AllSportsApi', {id:league.externalId,name:league.name,country:league.country});
  if(binding){leagueKeys.set(league.id,{country:binding.country,key:binding.key});continue;}
  const named=exactTeamCompetition(league.country,league.name);
  if(named){leagueKeys.set(league.id,named);continue;}
  const targets=links.filter(m=>m.kind==='COMPETITION'&&TEAM_MAPPING_METHODS.includes(m.method as typeof TEAM_MAPPING_METHODS[number])).flatMap(m=>m.leftProvider===league.provider&&m.leftExternalId===league.externalId?leagues.filter(l=>l.provider===m.rightProvider&&l.externalId===m.rightExternalId):m.rightProvider===league.provider&&m.rightExternalId===league.externalId?leagues.filter(l=>l.provider===m.leftProvider&&l.externalId===m.leftExternalId):[]);
  const bindings=targets.flatMap(l=>{const b=scopeBinding(l.provider as 'AllSportsApi',{id:l.externalId,name:l.name,country:l.country});return b?[b]:[];});
  if(bindings.length===1&&(!league.country||exact(league.country)===exact(bindings[0].country)))leagueKeys.set(league.id,{country:bindings[0].country,key:bindings[0].key});
 }
 const membership=new Map<string,{country:string;key:string}[]>();for(const f of memberships){const l=leagueKeys.get(f.leagueId);if(l)for(const teamId of [f.homeTeamId,f.awayTeamId])membership.set(teamId,[...membership.get(teamId)??[],l]);}
 const identities:TeamIdentity[]=teams.map(t=>{const scopes=membership.get(t.id)??[],countries=[...new Set(scopes.map(s=>s.country))];const country=t.country??(countries.length===1?countries[0]:null);return{provider:t.provider,id:t.externalId,name:t.name,country,competitions:scopes.filter(s=>country&&exact(s.country)===exact(country)).map(s=>s.key).filter((v,i,a)=>a.indexOf(v)===i)};});
 return{identities,links,aliases:observedTeamAliases(identities)};
}
export async function persistTeamProviderResolution(db:PrismaClient,source:TeamIdentity,targetProvider:string,aliases:TeamAlias[],knownTargetId?:string){
 return db.$transaction(async tx=>{
  // Serialize mapping proposals; uniqueness is also enforced in both provider directions by schema.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('historical-team-provider-mapping'))`;
  const inventory=await loadTeamMappingInventory(tx as unknown as PrismaClient);
  const current=inventory.identities.find(t=>t.provider===canonicalTeamProvider(source.provider)&&t.id===source.id);
  if(!current)throw Error('MAPPING_SOURCE_MISSING');
  const verifiedAliases=inventory.aliases.filter(a=>aliases.some(b=>JSON.stringify(a)===JSON.stringify(b)));
  const result=resolveTeamProviderMapping(current,targetProvider,inventory.identities,inventory.links,verifiedAliases,knownTargetId);
  if(result.status!=='MAPPED'||result.reused)return result;
  const target=result.target!;const [left,right]=current.provider<target.provider?[current,target]:[target,current];
  await tx.providerEntityMapping.create({data:{kind:'TEAM',leftProvider:left.provider,leftExternalId:left.id,rightProvider:right.provider,rightExternalId:right.id,method:result.method!,evidence:{version:1,left,right,reason:result.reason,aliases:verifiedAliases} as unknown as Prisma.InputJsonValue}});
  return result;
 },{timeout:30000});
}
