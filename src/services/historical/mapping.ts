import type { Prisma, ProviderEntityKind } from '@prisma/client';
import { exact } from './scope';
export type Identity = {provider:string;id:string;name:string;country?:string|null;competitionKey?:string;home?:string;away?:string;kickoff?:string};
export function exactIdentityMatch(kind:ProviderEntityKind,a:Identity,b:Identity) {
  if(!a.id||!b.id||!a.provider||!b.provider||kind!=='FIXTURE'&&(!a.name.trim()||!b.name.trim()))return false;
  if(kind==='COMPETITION')return !!a.country&&!!b.country&&exact(a.country)===exact(b.country)&&exact(a.name)===exact(b.name);
  if(kind==='TEAM')return !!a.competitionKey&&a.competitionKey===b.competitionKey&&exact(a.name)===exact(b.name);
  return !!a.competitionKey&&a.competitionKey===b.competitionKey&&!!a.home&&!!a.away&&!!b.home&&!!b.away
    &&exact(a.home)===exact(b.home)&&exact(a.away)===exact(b.away)
    &&Number.isFinite(Date.parse(a.kickoff??''))&&Number.isFinite(Date.parse(b.kickoff??''))
    &&Math.abs(Date.parse(a.kickoff!)-Date.parse(b.kickoff!))<=5*60_000;
}
export async function resolveMapping(db:Prisma.TransactionClient,kind:ProviderEntityKind,source:Identity,targetProvider:string,candidates:Identity[],knownTargetId?:string) {
  const maps=await db.providerEntityMapping.findMany({where:{kind,OR:[{leftProvider:source.provider,leftExternalId:source.id,rightProvider:targetProvider},{rightProvider:source.provider,rightExternalId:source.id,leftProvider:targetProvider}]}});
  let ids=maps.map(m=>m.leftProvider===source.provider?m.rightExternalId:m.leftExternalId);
  // Reuse the existing unambiguous hybrid fixture mapping; do not duplicate or mutate its budget/certificate.
  if(!ids.length&&kind==='FIXTURE'&&[source.provider,targetProvider].sort().join('|')==='API-Football|AllSportsApi') {
    const scouts=await db.hybridScout.findMany({where:source.provider==='AllSportsApi'?{allSportsFixtureId:source.id}:{apiFootballFixtureId:source.id}});
    ids=scouts.flatMap(s=>source.provider==='AllSportsApi'?(s.apiFootballFixtureId?[s.apiFootballFixtureId]:[]):[s.allSportsFixtureId]);
  }
  if(new Set(ids).size>1)return null;
  const targetId=ids[0]??knownTargetId??(source.provider===targetProvider?source.id:undefined);
  const matches=candidates.filter(c=>c.provider===targetProvider&&(!targetId||c.id===targetId)&&exactIdentityMatch(kind,source,c));
  return matches.length===1?matches[0]:null;
}
export async function persistMapping(db:Prisma.TransactionClient,kind:ProviderEntityKind,a:Identity,b:Identity,method:'VERIFIED_PROVIDER_ID'|'EXACT_IDENTITY') {
  if(a.provider===b.provider||![a.provider,b.provider].every(p=>['API-Football','AllSportsApi','FOOTBALL_DATA'].includes(p))||!exactIdentityMatch(kind,a,b))throw Error('UNSAFE_MAPPING');
  const [l,r]=a.provider<b.provider?[a,b]:[b,a];
  const existing=await db.providerEntityMapping.findMany({where:{kind,leftProvider:l.provider,rightProvider:r.provider,OR:[{leftExternalId:l.id},{rightExternalId:r.id}]}});
  if(existing.some(x=>x.leftExternalId!==l.id||x.rightExternalId!==r.id))throw Error('AMBIGUOUS_MAPPING');
  return db.providerEntityMapping.upsert({where:{kind_leftProvider_leftExternalId_rightProvider:{kind,leftProvider:l.provider,leftExternalId:l.id,rightProvider:r.provider}},update:{},create:{kind,leftProvider:l.provider,leftExternalId:l.id,rightProvider:r.provider,rightExternalId:r.id,method,evidence:{left:l,right:r}}});
}
