// Runs in BareMux's SharedWorker. Elect one live window for each request so
// opening/closing a browser window never duplicates a POST or kills the transport.
export default class AtelierTransport {
 constructor(){if(globalThis.atelierTransportV2)return globalThis.atelierTransportV2;globalThis.atelierTransportV2=this;this.ready=true;this.cache=new Map();this.cacheBytes=0;this.inflight=new Map();this.pending=new Map();this.channel=new BroadcastChannel('atelier-http-v2');this.channel.onmessage=({data:m})=>{const p=this.pending.get(m?.id);if(!p)return;if(m.type==='offer'&&!p.client){p.client=m.client;this.channel.postMessage({type:'request',client:m.client,id:m.id,...p.request})}else if(m.type==='response'&&m.client===p.client){this.finish(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.response)}}}
 async init(){} meta(){return {}}
 finish(id){const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);this.pending.delete(id)}
 async networkRequest(remote,method,body,headers,signal){
  if(this.pending.size>=128)throw Error('Too many pending website requests.');
  const bytes=body?await new Response(body).arrayBuffer():null;if(bytes?.byteLength>8*1024*1024)throw Error('Uploads are limited to 8 MB.');
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),abort=()=>{const p=this.pending.get(id);if(!p)return;this.channel.postMessage({type:'cancel',client:p.client,id});this.finish(id);reject(Error('Website request cancelled.'))};const timer=setTimeout(abort,60000);this.pending.set(id,{resolve,reject,timer,signal,abort,request:{url:remote.href,method,headers,body:bytes}});if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});this.channel.postMessage({type:'probe',id})});
 }

 async request(remote,method,body,headers,signal){
  if(method!=='GET'||body||signal||Object.entries(headers).some(([k,v])=>/^(cache-control|pragma)$/i.test(k)&&/no-cache|no-store|max-age=0/i.test(String(v))))return this.networkRequest(remote,method,body,headers,signal);
  const key=remote.href+' '+JSON.stringify(Object.entries(headers).sort(([a],[b])=>a.localeCompare(b)));
  const hit=this.cache.get(key);if(hit&&hit.expires>Date.now())return {...hit.response,body:hit.response.body.slice(0)};
  if(hit){this.cacheBytes-=hit.response.body.byteLength;this.cache.delete(key)}
  let pending=this.inflight.get(key);
  if(!pending){pending=this.networkRequest(remote,method,body,headers,signal).then(response=>{
   const h=Object.fromEntries(Object.entries(response.headers).map(([k,v])=>[k.toLowerCase(),v]));
   const control=String(h['cache-control']||''),age=Number(control.match(/(?:^|[,\s])max-age=(\d+)/i)?.[1]||0);
   if(response.status===200&&age>0&&!/no-store|no-cache|private/i.test(control)&&!h['set-cookie']&&h.vary!=='*'&&/javascript|css|image\/|font\/|woff/i.test(h['content-type']||'')&&response.body.byteLength<=2*1024*1024){
    while((this.cacheBytes+response.body.byteLength>16*1024*1024||this.cache.size>=128)&&this.cache.size){const oldest=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(oldest).response.body.byteLength;this.cache.delete(oldest)}
    this.cache.set(key,{expires:Date.now()+Math.min(age,300)*1000,response:{...response,body:response.body.slice(0)}});this.cacheBytes+=response.body.byteLength;
   }
   return response;
  }).finally(()=>this.inflight.delete(key));this.inflight.set(key,pending)}
  const result=await pending;return {...result,body:result.body.slice(0)};
 }
 connect(url,protocols,headers,onopen,onmessage,onclose,onerror){queueMicrotask(()=>{onerror('WebSocket connections are not available with this HTTP transport.');onclose(1006,'WebSocket unavailable')});return [()=>{},()=>{}]}
}
