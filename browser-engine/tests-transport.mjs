import assert from 'node:assert/strict';
import Transport from './transport.mjs';
import './failure.js';
const a=new MessageChannel(),b=new MessageChannel();
const transport=new Transport(a.port1);assert.equal(new Transport(b.port1),transport);
let sent=0;
function serve(port,client){port.onmessage=({data:m})=>{if(m.type==='probe')port.postMessage({type:'offer',id:m.id,client});if(m.type==='request'){sent++;port.postMessage({type:'response',id:m.id,client,response:{status:200,headers:{'content-type':'application/javascript','cache-control':'public, max-age=300'},body:new Uint8Array([42]).buffer}})}}}
serve(a.port2,'a');serve(b.port2,'b');
try{
 const r=await transport.request(new URL('https://example.com/'),'POST',new Uint8Array([7]),{});assert.equal(r.status,200);assert.equal(sent,1,'POST dispatched only once');
 a.port2.postMessage({type:'disconnect'});await new Promise(r=>setTimeout(r,20));
 await transport.request(new URL('https://example.com/'),'POST',null,{});assert.equal(sent,2,'remaining window still works');
 await Promise.all(Array.from({length:10},()=>transport.request(new URL('https://example.com/app.js'),'GET',null,{})));assert.equal(sent,3);
 const cached=await transport.request(new URL('https://example.com/app.js'),'GET',null,{});structuredClone(cached.body,{transfer:[cached.body]});assert.equal((await transport.request(new URL('https://example.com/app.js'),'GET',null,{})).body.byteLength,1);
 await transport.request(new URL('https://example.com/app.js'),'GET',null,{cookie:'different'});assert.equal(sent,4);
 const abort=new AbortController();abort.abort();await assert.rejects(transport.request(new URL('https://example.com/'),'POST',null,{},abort.signal),/cancelled/);assert.equal(transport.pending.size,0);
 b.port2.postMessage({type:'disconnect'});await new Promise(r=>setTimeout(r,20));
 const start=Date.now();await assert.rejects(transport.request(new URL('https://example.com/'),'GET',null,{}),/connection unavailable/);assert.ok(Date.now()-start<5000);assert.equal(transport.pending.size,0);
 const raw='<textarea id="errorTrace">https://private-engine.example/ secret stack</textarea><b id="fetchedURL"></b>';
 const sanitized=await AtelierFailure.sanitize(new Response(raw,{status:500,headers:{'content-type':'text/html'}}));const html=await sanitized.text();assert.equal(sanitized.status,502);assert.ok(!html.includes('private-engine'));assert.ok(!html.includes('secret stack'));assert.ok(html.includes('Try again'));
 const legitimate=new Response('Website maintenance',{status:500,headers:{'content-type':'text/html'}});assert.equal(await AtelierFailure.sanitize(legitimate),legitimate);
 console.log('PASS explicit ports, exactly-once POST, closed window recovery, concurrent GET/cache isolation, cancellation, fast missing-bridge error and private error page');
}finally{for(const port of [a.port1,a.port2,b.port1,b.port2])port.close()}
