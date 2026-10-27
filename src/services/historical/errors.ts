// Preserve technical diagnostics without serializing request headers or environment contents.
export function historicalError(error:unknown):{name:string;code:string|null;message:string;stack:string|null;cause:unknown} {
 const e=error instanceof Error?error:Object.assign(new Error(String(error)),{name:'UnknownError'});
 const clean=(text:string)=>{
  for(const [key,value]of Object.entries(process.env))if(value&&value.length>=4&&/(KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)/i.test(key))text=text.split(value).join('<redacted>');
  return text.replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi,'<redacted-url>').replace(/((?:password|token|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi,'$1<redacted>').slice(0,12000);
 };
 const extra=e as Error&{code?:unknown;cause?:unknown};
 return{name:clean(e.name),code:extra.code==null?null:clean(String(extra.code)),message:clean(e.message),stack:e.stack?clean(e.stack):null,cause:extra.cause==null?null:clean(extra.cause instanceof Error?extra.cause.message:String(extra.cause))};
}
export function historicalErrorText(error:unknown){const d=historicalError(error);return `${d.code?d.code+': ':''}${d.message}`;}
