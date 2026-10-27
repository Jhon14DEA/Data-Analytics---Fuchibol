import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { parseGoalTotal, timestampIssue } from '../training/oddsIntegrity';
import { DEFAULT_MARKETS, marketKey, resolveHistoricalMarket } from './outcomes';
import type { HistoricalBatch, HistoricalFixture } from './types';
import { mappedHistoricalFixture } from './fixtureIdentity';
export const hash = (v:unknown) => createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
// Dedicated historical writer. Never call persistMatchDetail or any LIVE/hybrid hook.
export async function persistHistoricalFixture(tx:Prisma.TransactionClient,b:HistoricalBatch,f:HistoricalFixture,leagueId:string,seasonId:string) {
  const existing=await tx.fixture.findUnique({where:{provider_externalId:{provider:b.provider,externalId:f.id}}});
  const canonical=existing?null:await mappedHistoricalFixture(tx,b,f);
  if(existing&&existing.status!=='FINISHED')return 'REJECTED' as const;
  if(existing?.providerUpdatedAt && existing.providerUpdatedAt.getTime()>Date.parse(b.receivedAt))return 'REJECTED' as const;
  if(existing&&(existing.leagueId!==leagueId||existing.seasonId&&existing.seasonId!==seasonId))throw Error('FIXTURE_IDENTITY_CONFLICT');
  const team=async(side:'home'|'away')=>tx.team.upsert({where:{provider_externalId:{provider:b.provider,externalId:f[side].id}},update:{},create:{provider:b.provider,externalId:f[side].id,name:f[side].name,country:b.competition.country}});
  const home=canonical?.homeTeam??await team('home'),away=canonical?.awayTeam??await team('away');
  if(existing&&(existing.homeTeamId!==home.id||existing.awayTeamId!==away.id||existing.kickoff.getTime()!==Date.parse(f.kickoff)))throw Error('FIXTURE_IDENTITY_CONFLICT');
  const ft=f.periods.find(p=>p.period==='FULL_TIME')!,receivedAt=new Date(b.receivedAt);
  if(canonical&&(canonical.homeScore!==ft.home.goals||canonical.awayScore!==ft.away.goals))throw Error('CROSS_PROVIDER_SCORE_CONFLICT');
  const data={leagueId,homeTeamId:home.id,awayTeamId:away.id,kickoff:new Date(f.kickoff),status:'FINISHED' as const,homeScore:ft.home.goals!,awayScore:ft.away.goals!,seasonId,providerUpdatedAt:receivedAt,...(f.referee!==undefined?{referee:f.referee}:{}),...(b.provider==='FOOTBALL_DATA'?{kickoffPrecision:f.kickoffPrecision??'EXACT',historicalKickoffAt:f.kickoffPrecision==='DATE'?null:new Date(f.kickoff)}:{})};
  const fixture=canonical??await tx.fixture.upsert({where:{provider_externalId:{provider:b.provider,externalId:f.id}},update:data,create:{...data,provider:b.provider,externalId:f.id}});
  for(const p of f.periods)for(const [side,t]of [['home',home],['away',away]] as const){
    const metrics=p[side];
    await tx.teamPeriodStats.upsert({where:{fixtureId_teamId_provider_period:{fixtureId:fixture.id,teamId:t.id,provider:b.provider,period:p.period}},create:{fixtureId:fixture.id,teamId:t.id,provider:b.provider,period:p.period,...metrics,source:p.source,receivedAt},update:{...metrics,source:p.source,receivedAt}});
    if(p.period==='FULL_TIME'&&!canonical)await tx.teamMatchStats.upsert({where:{fixtureId_teamId:{fixtureId:fixture.id,teamId:t.id}},create:{fixtureId:fixture.id,teamId:t.id,isHome:side==='home',...metrics,possession:Number.isInteger(metrics.possession)?metrics.possession:null},update:{...metrics,possession:Number.isInteger(metrics.possession)?metrics.possession:null}});
  }
  for(const e of f.events??[]) {
    if(!e.id||!e.type||e.minute!==null&&(!Number.isInteger(e.minute)||e.minute<0))throw Error('INVALID_EVENT');
    const sourceHash=hash([b.provider,'historical-event',e.id]);
    const event={teamId:e.side==='HOME'?home.id:e.side==='AWAY'?away.id:null,providerEventId:e.id,eventType:e.type,minute:e.minute,playerName:e.playerName,detail:e.detail};
    await tx.matchEvent.upsert({where:{fixtureId_sourceHash:{fixtureId:fixture.id,sourceHash}},create:{fixtureId:fixture.id,sourceHash,...event},update:event});
  }
  for(const p of f.players??[]) {
    if(!p.id||!p.name||!['HOME','AWAY'].includes(p.side))throw Error('INVALID_PLAYER');
    const teamId=p.side==='HOME'?home.id:away.id;
    const player=await tx.player.upsert({where:{provider_externalId:{provider:b.provider,externalId:p.id}},create:{provider:b.provider,externalId:p.id,name:p.name,teamId},update:{}});
    if(typeof p.starter==='boolean')await tx.lineup.upsert({where:{fixtureId_playerId_teamId:{fixtureId:fixture.id,playerId:player.id,teamId}},create:{fixtureId:fixture.id,playerId:player.id,teamId,isHome:p.side==='HOME',starter:p.starter,position:p.position,number:p.number},update:{starter:p.starter,position:p.position,number:p.number}});
    if(p.stats){
      for(const n of Object.values(p.stats))if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0))throw Error('INVALID_PLAYER_METRIC');
      await tx.playerMatchStats.upsert({where:{fixtureId_playerId:{fixtureId:fixture.id,playerId:player.id}},create:{fixtureId:fixture.id,playerId:player.id,teamId,starter:p.starter,...p.stats},update:{starter:p.starter,...p.stats}});
    }
  }
  for(const q of f.odds??[]) {
    const parsed=parseGoalTotal(q.market,q.selection,q.price);
    if(!parsed||timestampIssue(q.quotedAt,q.receivedAt,b.receivedAt)||!q.bookmaker?.trim())continue;
    const bookmaker=await tx.bookmaker.upsert({where:{name:q.bookmaker},create:{name:q.bookmaker},update:{}});
    const sourceHash=hash([b.provider,f.id,q.bookmaker,parsed,q.quotedAt,q.receivedAt]);
    await tx.oddsSnapshot.createMany({data:{fixtureId:fixture.id,bookmakerId:bookmaker.id,market:q.market,selection:q.selection,line:parsed.line,odds:q.price,timestamp:new Date(q.quotedAt),receivedAt:new Date(q.receivedAt),marketPeriod:parsed.period,provider:b.provider,sourceHash},skipDuplicates:true});
  }
  const archive=[];
  const books=new Map<string,string>();
  for(const q of f.archiveOdds??[]){
    if(b.provider!=='FOOTBALL_DATA'||q.quotedAt!==null||!q.bookmaker||!q.sourceColumn||!Number.isFinite(q.price)||q.price<=1||!['MATCH_RESULT','TOTAL_GOALS','ASIAN_HANDICAP'].includes(q.market)||!['PRE_CLOSING','CLOSING'].includes(q.phase))throw Error('INVALID_ARCHIVE_ODDS');
    if(!books.has(q.bookmaker)){const bookmaker=await tx.bookmaker.upsert({where:{name:q.bookmaker},create:{name:q.bookmaker},update:{}});books.set(q.bookmaker,bookmaker.id);}
    archive.push({fixtureId:fixture.id,bookmakerId:books.get(q.bookmaker)!,provider:b.provider,sourceColumn:q.sourceColumn,market:q.market,selection:q.selection,line:q.line,price:q.price,phase:q.phase,quotedAt:null,receivedAt});
  }
  if(archive.length)await tx.historicalOddsQuote.createMany({data:archive,skipDuplicates:true});
  for(const spec of [...DEFAULT_MARKETS,...f.markets??[]]) {
    const result=resolveHistoricalMarket(spec,f.periods),key=marketKey(spec);
    const outcome={market:spec.market,period:spec.period,selection:spec.selection,side:spec.side,line:spec.line,rules:spec.rules,...result,receivedAt,resolvedAt:result.status==='UNKNOWN'?null:receivedAt};
    await tx.historicalMarketOutcome.upsert({where:{fixtureId_provider_marketKey:{fixtureId:fixture.id,provider:b.provider,marketKey:key}},create:{fixtureId:fixture.id,provider:b.provider,marketKey:key,...outcome},update:outcome});
  }
  return existing||canonical?'UPDATED' as const:'INSERTED' as const;
}
