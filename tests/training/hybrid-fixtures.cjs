const { allSportsObservation, apiFootballObservation } = require('../../src/services/training/observation.ts');
const { identityKey, HYBRID_POLICY } = require('../../src/services/training/hybrid/policy.ts');
function sample(at = new Date(), id = '701') {
  const identity={providerFixtureId:id,home:'Test Home '+id,away:'Test Away '+id,league:'Test League',kickoff:new Date(at.getTime()-17*60000).toISOString()};
  const raw={fixture:{id:Number(id)+10000,date:identity.kickoff,status:{short:'1H',elapsed:17}},teams:{home:{id:1,name:identity.home},away:{id:2,name:identity.away}},league:{id:1,name:identity.league},goals:{home:0,away:0},score:{halftime:{home:null,away:null},fulltime:{home:null,away:null}}};
  const observation=allSportsObservation({event_key:id,event_live:'1',event_status:'17',event_final_result:'0 - 0',statistics:[{type:'Shots On Target',home:'0',away:'1'},{type:'Expected Goals',home:'N/D',away:'N/D'},{type:'Corners',home:'2',away:'0'}]},at.toISOString());
  const certificate={apiFixtureId:String(raw.fixture.id),allSportsFixtureId:id,identityKey:identityKey(identity),observedAt:at.toISOString(),expiresAt:new Date(at.getTime()+HYBRID_POLICY.confirmationTtlMs).toISOString(),minute:17,observation:apiFootballObservation(raw,at.toISOString())};
  const match={id:'allsports-'+id,source:'allsports',demo:false,homeTeam:identity.home,awayTeam:identity.away,competition:identity.league,kickoffAt:identity.kickoff,status:'LIVE',minute:17,score:{home:0,away:0},trainingObservation:observation};
  return {identity,raw,observation,certificate,match};
}
function scenario(count) {
  const start=Date.parse('2026-10-08T00:00:00Z'),events=[];
  for(let i=0;i<count;i++) {
    const kickoff=start+i*30*60000;
    const s=sample(new Date(kickoff+17*60000),String(1000+i));
    for(let minute=12;minute<=40;minute+=2){const at=new Date(kickoff+minute*60000).toISOString();events.push({at,identity:s.identity,observation:{...s.observation,observedAt:at,minute},live:true});}
    for(const [minute,period] of [[48,'HALFTIME'],[100,'FINISHED']]){const at=new Date(kickoff+minute*60000).toISOString();events.push({at,identity:s.identity,observation:{...s.observation,observedAt:at,minute,period},live:period!=='FINISHED'});}
  }
  return events;
}
module.exports={sample,scenario};
