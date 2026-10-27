const {randomUUID}=require('node:crypto');
const {historicalMetrics}=require('../../src/services/historical/normalize.ts');
function batch(){
 const tag=randomUUID(),date=new Date(Date.now()-86400000).toISOString().slice(0,10),key='test-'+tag;
 const fixture={id:tag,competitionId:'39',seasonKey:key,kickoff:date+'T12:00:00.000Z',status:'FINISHED',home:{id:tag+'h',name:'Home'},away:{id:tag+'a',name:'Away'},periods:[
  {period:'FIRST_HALF',source:'EXPLICIT_HT',home:historicalMetrics({goals:0}),away:historicalMetrics({goals:0})},
  {period:'FULL_TIME',source:'EXPLICIT_FT',home:historicalMetrics({goals:1,shotsOnTarget:4,corners:3,yellowCards:1,redCards:0}),away:historicalMetrics({goals:1,shotsOnTarget:3,corners:2,yellowCards:2,redCards:0})}
 ],events:[{id:tag+'event',side:'HOME',type:'Goal',minute:60,playerName:'Player',detail:'Normal Goal'}],players:[{id:tag+'player',name:'Player',side:'HOME',starter:true,stats:{goals:1,xg:null}}],odds:[]};
 return{provider:'API-Football',competition:{id:'39',name:'Premier League',country:'England',gender:'male',ageCategory:'senior',reserve:false},season:{key,label:'2026/27'},rangeFrom:date+'T00:00:00.000Z',rangeTo:date+'T23:59:59.999Z',receivedAt:new Date().toISOString(),cursor:null,nextCursor:null,fixtures:[fixture]};
}
module.exports={batch};
