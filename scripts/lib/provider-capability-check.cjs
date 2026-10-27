const HOST='https://v3.football.api-sports.io';
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
function supported(value){return value==='AVAILABLE';}
function canBackfill({remaining,historical,stats}){return number(remaining)!==null&&number(remaining)>0&&supported(historical)&&supported(stats);}
function createProbe({key,fetchImpl=globalThis.fetch,beforeRequest=()=>{},initialUsed=0,maxRequests=3}){
 if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>3)throw Error('INVALID_HTTP_LIMIT');
 if(!Number.isInteger(initialUsed)||initialUsed<0||initialUsed>maxRequests)throw Error('INVALID_PRIOR_USAGE');
 let used=initialUsed;
 return {get used(){return used;},async request(path,params={}){
  if(!key?.trim())throw Error('KEY_MISSING');
  if(!['/status','/leagues','/fixtures','/fixtures/statistics'].includes(path))throw Error('ENDPOINT_NOT_ALLOWED');
  if(used>=maxRequests)throw Error('GLOBAL_HTTP_LIMIT');
  const url=new URL(HOST+path);for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  used++;await beforeRequest({attempt:used,endpoint:url.pathname+url.search,cost:1,maximum:maxRequests});
  // No redirect following, pagination or retry. Network errors still consume an attempt.
  const response=await fetchImpl(url,{headers:{'x-apisports-key':key.trim()},redirect:'manual',signal:AbortSignal.timeout(10000)});
  const headers={};for(const [k,v]of response.headers)if(/^(x-)?ratelimit[-a-z]*$|^retry-after$/i.test(k))headers[k]=v;
  const payload=await response.json();
  return {http:response.status,ok:response.ok,headers,payload};
 }};
}
function quota(result){
 const requests=result.payload?.response?.requests;
 const dailyLimit=number(requests?.limit_day??result.headers['x-ratelimit-requests-limit']);
 const current=number(requests?.current);
 const values=[number(result.headers['x-ratelimit-requests-remaining']),dailyLimit!==null&&current!==null?Math.max(0,dailyLimit-current):null].filter(x=>x!==null);
 return {dailyLimit,current,remaining:values.length?Math.min(...values):null,minuteLimit:number(result.headers['x-ratelimit-limit']),minuteRemaining:number(result.headers['x-ratelimit-remaining']),reset:result.headers['x-ratelimit-reset']??null};
}
module.exports={createProbe,quota,supported,canBackfill};
