import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as idb from 'fake-indexeddb';
import Transport from './browser-engine/transport.mjs';

// Real HTTP transport election: two live windows must send a POST only once.
const transport=new Transport(),a=new BroadcastChannel('atelier-http-v2'),b=new BroadcastChannel('atelier-http-v2');let sent=0;
for(const [channel,client]of [[a,'a'],[b,'b']])channel.onmessage=({data:m})=>{if(m.type==='probe')channel.postMessage({type:'offer',id:m.id,client});if(m.type==='request'&&m.client===client){sent++;assert.equal(m.method,'POST');assert.deepEqual(new Uint8Array(m.body),new Uint8Array([7,9]));channel.postMessage({type:'response',id:m.id,client,response:{status:201,statusText:'Created',headers:{},body:new Uint8Array([3,5]).buffer}})}};
const response=await transport.request(new URL('https://example.com/'),'POST',new Uint8Array([7,9]),{});assert.equal(response.status,201);assert.equal(sent,1);
a.close();await transport.request(new URL('https://example.com/'),'POST',new Uint8Array([7,9]),{});assert.equal(sent,2);b.close();
const cacheWindow=new BroadcastChannel('atelier-http-v2');let gets=0;
cacheWindow.onmessage=({data:m})=>{if(m.type==='probe')cacheWindow.postMessage({type:'offer',id:m.id,client:'cache'});if(m.type==='request'&&m.client==='cache'){gets++;cacheWindow.postMessage({type:'response',id:m.id,client:'cache',response:{status:200,statusText:'OK',headers:{'content-type':'application/javascript','cache-control':'public, max-age=300'},body:new Uint8Array([42]).buffer}})}};
await Promise.all(Array.from({length:10},()=>transport.request(new URL('https://example.com/app.js'),'GET',null,{})));assert.equal(gets,1);const cached=await transport.request(new URL('https://example.com/app.js'),'GET',null,{});assert.equal(gets,1);structuredClone(cached.body,{transfer:[cached.body]});assert.equal((await transport.request(new URL('https://example.com/app.js'),'GET',null,{})).body.byteLength,1);await transport.request(new URL('https://example.com/app.js'),'GET',null,{cookie:'different-user'});assert.equal(gets,2);cacheWindow.close();transport.channel.close();
console.log('PASS concurrent GET deduplication, static cache, transferable buffers and credential-key isolation');
await import('./browser-engine/navigation.js');const canonical=globalThis.AtelierNavigation.canonical;let nested='https://github.com/';for(let i=0;i<6;i++)nested='https://engine.example/browse/'+encodeURIComponent(nested);assert.equal(canonical(nested,'https://engine.example'),'https://github.com/');assert.equal(canonical('https://example.com/a%2Fb','https://engine.example'),'https://example.com/a%2Fb');assert.throws(()=>canonical('https://engine.example/','https://engine.example'));console.log('PASS repeated URL encoding is unwrapped without altering remote paths');
console.log('PASS real transport elects one window, preserves binary requests and survives window closure');

const dom=new JSDOM('<!doctype html><body></body>',{url:'https://engine.example/',runScripts:'outside-only'}),w=dom.window;
for(const [key,value]of Object.entries(idb))if(key!=='default')w[key]=value;
Object.assign(w,{TextEncoder,TextDecoder,Response,Request,Headers,ReadableStream,TransformStream,MessageChannel,MessagePort,crossOriginIsolated:false});
const channels=[];w.BroadcastChannel=class extends BroadcastChannel{constructor(name){super(name);channels.push(this)}};
w.SharedWorker=class{constructor(){this.port={postMessage(){},start(){},addEventListener(){}}}};
w.localStorage['bare-mux-path']='/baremux/worker.js';
Object.defineProperty(w.navigator,'serviceWorker',{value:{controller:null,addEventListener(){}}});
w.fetch=async url=>{if(String(url).endsWith('.wasm'))return new Response(await fs.readFile('node_modules/@mercuryworkshop/scramjet/dist/scramjet.wasm.wasm'));throw Error('Unexpected native fetch '+url)};
try{
 w.eval(await fs.readFile('node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js','utf8'));
 const {ScramjetController}=w.$scramjetLoadController();const controller=new ScramjetController(w.JSON.parse(JSON.stringify({prefix:'/browse/',flags:{captureErrors:false,sourcemaps:false},files:{wasm:'/scramjet/scramjet.wasm.wasm',all:'/scramjet/scramjet.all.js',sync:'/scramjet/scramjet.sync.js'}})));await controller.init();
 const encoded=controller.encodeUrl('https://example.com/page?q=hello');assert.match(encoded,/^\/browse\//);assert.equal(controller.decodeUrl('https://engine.example'+encoded),'https://example.com/page?q=hello');
 const {ScramjetServiceWorker}=w.$scramjetLoadWorker();const worker=new ScramjetServiceWorker();w.clients={get:async()=>undefined,matchAll:async()=>[]};
 await worker.loadConfig();
 worker.client={fetch:async()=>{const response=new Response('<!doctype html><html><head><title>Interactive fixture</title><link rel="stylesheet" href="/style.css"></head><body><form action="/submit" method="post"><input name="q"></form><a href="/next">Next</a><script>document.title="Executed";fetch("/api");console.log(window.top.location.href);</script></body></html>',{headers:{'content-type':'text/html','x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'"}});response.rawHeaders=Object.fromEntries(response.headers);response.finalURL='https://example.com/page';return response}};
 const request=new Request('https://engine.example'+encoded);Object.defineProperty(request,'destination',{value:'document'});
 const rewritten=await worker.fetch({request,clientId:''});const html=await rewritten.text();assert.equal(rewritten.status,200,html.slice(0,300));assert.match(html,/scramjet\.all\.js/);assert.match(html,/<form/);assert.match(html,/browse\//);assert.match(html,/\$scramjet/);assert.equal(rewritten.headers.get('x-frame-options'),null);
 console.log('PASS actual Scramjet WASM and worker rewrite HTML, CSS links, forms and JavaScript; frame-blocking headers removed');
}catch(error){console.error(error.name+': '+error.message+'\n'+error.stack?.split('\n').slice(1,4).join('\n'));process.exitCode=1}
finally{for(const channel of channels)channel.close();dom.window.close()}
