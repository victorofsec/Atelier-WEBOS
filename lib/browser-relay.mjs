// Authenticated HTTP transport for the isolated browser engine. Remote cookies
// are data in the envelope: they are never installed on the Atelier origin.
export const MAX_REQUEST = 8 * 1024 * 1024;
export const MAX_RESPONSE = 16 * 1024 * 1024;
export function publicAddress(address) {
 if(address.includes(':'))return /^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address)&&!/^2002:/i.test(address);
 const a=address.split('.').map(Number);if(a.length!==4||a.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 return ![0,10,127].includes(a[0])&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&(a[1]===168||a[1]===0||a[1]===2))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&(a[1]===18||a[1]===19||a[1]===51))&&!(a[0]===203&&a[1]===0&&a[2]===113);
}
export function browserTarget(value) {
 const url=new URL(value),host=url.hostname.toLowerCase();
 if(!['http:','https:'].includes(url.protocol)||url.port||url.username||url.password||host.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||/(^|\.)(localhost|local|internal|invalid|test|onion|atelier-host\.invalid)$/.test(host))throw Error('Only public websites on standard HTTP/HTTPS ports can be opened.');
 url.hash='';return url;
}
export async function limitedBytes(body,limit) {
 if(!body)return new Uint8Array();const reader=body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('This transfer exceeds the browser size limit.')}chunks.push(value)}}finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength}return result;
}
const dnsCaches=new WeakMap();
async function resolvePublic(host,fetchRemote){
 let cache=dnsCaches.get(fetchRemote);if(!cache){cache=new Map();dnsCaches.set(fetchRemote,cache)}
 const prior=cache.get(host);if(prior&&prior.expires>Date.now())return prior.promise;
 if(cache.size>=256)cache.delete(cache.keys().next().value);
 const entry={expires:Date.now()+8000,promise:null};
 entry.promise=lookupPublic(host,fetchRemote).then(ttl=>{entry.expires=Date.now()+Math.min(30,ttl)*1000},error=>{cache.delete(host);throw error});
 cache.set(host,entry);return entry.promise;
}
async function lookupPublic(host,fetchRemote){
 const signal=AbortSignal.timeout(8000);let ttl=30;
 const answers=await Promise.all(['A','AAAA'].map(async type=>{const r=await fetchRemote('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{accept:'application/dns-json'},signal});if(!r.ok)throw Error('DNS lookup failed.');const data=await r.json();if(data.Status!==0)throw Error('Website address could not be resolved.');for(const record of data.Answer||[])if(Number.isFinite(record.TTL))ttl=Math.min(ttl,Math.max(0,record.TTL));return (data.Answer||[]).filter(x=>x.type===1||x.type===28).map(x=>x.data)}));
 const addresses=answers.flat();if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error('Private or reserved network addresses cannot be opened.');return ttl;
}
export async function browserRelay(request,fetchRemote=fetch){
 const error=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
 if(!request.headers.get('x-atelier-user-id'))return error('Sign in to Atelier to browse.',401);
 if(request.method!=='POST')return error('POST required.',405);
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('x-atelier-browser')!=='1')return error('Invalid browser origin.',403);
 try{
  const raw=request.headers.get('x-browser-request');if(!raw||raw.length>48000)return error('Invalid request metadata.',400);
  const meta=JSON.parse(decodeURIComponent(raw)),url=browserTarget(meta.url),method=String(meta.method||'GET').toUpperCase();
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))return error('Unsupported HTTP method.',400);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(45000)]);
  await resolvePublic(url.hostname,fetchRemote);
  const headers=new Headers();
  for(const [key,value]of Object.entries(meta.headers||{})){
   if(/^(host|connection|content-length|transfer-encoding|upgrade|accept-encoding|proxy-.*|oai-.*|x-hosting-.*|x-atelier-.*|x-browser-.*|cf-.*|x-forwarded-.*|forwarded|sec-.*)$/i.test(key))continue;
   // Origin and Cookie below belong to the proxied website, not the outer request.
   headers.set(key,Array.isArray(value)?value.join(key.toLowerCase()==='cookie'?'; ':', '):String(value));
  }
  headers.set('Accept-Encoding','gzip, br');
  const bytes=await limitedBytes(request.body,MAX_REQUEST);
  const remote=await fetchRemote(url.href,{method,headers,body:['GET','HEAD'].includes(method)?undefined:bytes,redirect:'manual',signal});
  const responseHeaders=Object.fromEntries(remote.headers);
  const cookies=remote.headers.getSetCookie?.();if(cookies?.length)responseHeaders['set-cookie']=cookies;
  // Fetch exposes decompressed bytes; never give a stale compression or length to the engine.
  delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];delete responseHeaders['transfer-encoding'];
  const rejectedScript=/\.m?js$/i.test(url.pathname)&&/text\/html/i.test(responseHeaders['content-type']||'');
  const warning=rejectedScript?'The website returned a browser-verification page instead of JavaScript. Its protection is blocking this page.':remote.status===429?'This website is rate-limiting the shared relay (HTTP 429). Try again later or enter the website address directly.':remote.status===403?'A website resource was refused (HTTP 403). The page may not work through this browser.':undefined;
  let data;if(rejectedScript){await remote.body?.cancel();data=new TextEncoder().encode('// Website script unavailable: the origin returned an HTML verification page.');responseHeaders['content-type']='application/javascript';delete responseHeaders['cache-control']}else data=await limitedBytes(remote.body,MAX_RESPONSE);
  const metadata=new TextEncoder().encode(JSON.stringify({status:rejectedScript&&remote.status<400?502:remote.status,statusText:remote.statusText,headers:responseHeaders,warning}));
  if(metadata.byteLength>65536)return error('Website response headers are too large.',502);
  const packet=new Uint8Array(4+metadata.length+data.length);new DataView(packet.buffer).setUint32(0,metadata.length);packet.set(metadata,4);packet.set(data,4+metadata.length);
  const compressed=request.headers.get('x-atelier-browser-encoding')==='gzip';
  const output=compressed?new Response(packet).body.pipeThrough(new CompressionStream('gzip')):packet;
  // Application-level encoding survives framework response cloning and keeps
  // already-open older desktops compatible (they do not request compression).
  return new Response(output,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(compressed?{'X-Atelier-Encoding':'gzip'}:{})}});
 }catch(e){return error(e.name==='TimeoutError'?'The website took too long to respond.':e.message||'The website could not be reached.',502)}
}
