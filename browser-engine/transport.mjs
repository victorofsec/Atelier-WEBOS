// Runs in BareMux's SharedWorker. Explicit MessagePorts avoid relying on
// BroadcastChannel delivery across embedded browser storage partitions.
export default class AtelierTransport {
 constructor(port){const existing=globalThis.atelierTransportV4;if(existing){existing.attach(port);return existing}globalThis.atelierTransportV4=this;this.ready=true;this.cache=new Map();this.cacheBytes=0;this.inflight=new Map();this.pending=new Map();this.ports=new Set();this.attach(port)}
 attach(port){if(!port||this.ports.has(port))return;this.ports.add(port);port.onmessage=({data:m})=>{if(m?.type==='disconnect'){this.ports.delete(port);port.close();for(const [id,p]of this.pending)if(p.port===port){this.finish(id);p.reject(Error('Browser window closed.'))}return}const p=this.pending.get(m?.id);if(!p)return;if(m.type==='offer'&&!p.port){p.port=port;p.client=m.client;clearTimeout(p.bridgeTimer);port.postMessage({type:'request',client:m.client,id:m.id,...p.request})}else if(m.type==='response'&&p.port===port&&m.client===p.client){this.finish(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.response)}};port.start()}
 async init(){} meta(){return {}}
 finish(id){const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);clearTimeout(p.bridgeTimer);p.signal?.removeEventListener('abort',p.abort);this.pending.delete(id)}
 async networkRequest(remote,method,body,headers,signal){
  if(this.pending.size>=128)throw Error('Too many pending website requests.');
  const bytes=body?await new Response(body).arrayBuffer():null;if(bytes?.byteLength>8*1024*1024)throw Error('Uploads are limited to 8 MB.');
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),fail=message=>{const p=this.pending.get(id);if(!p)return;p.port?.postMessage({type:'cancel',client:p.client,id});this.finish(id);reject(Error(message))},abort=()=>fail('Website request cancelled.');const timer=setTimeout(()=>fail('The website took too long to respond.'),55000),bridgeTimer=setTimeout(()=>fail('Browser connection unavailable. Close and reopen the browser.'),4000);this.pending.set(id,{resolve,reject,timer,bridgeTimer,signal,abort,request:{url:remote.href,method,headers,body:bytes}});if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});for(const port of this.ports)port.postMessage({type:'probe',id})});
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
