import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as idb from 'fake-indexeddb';
await import('./browser-engine/tests-transport.mjs');
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
