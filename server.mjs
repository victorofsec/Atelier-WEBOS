import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {cloudState,cloudBlob} from './lib/cloud-state.mjs';
import {gitProxy} from './lib/git-proxy.mjs';
import {browserRelay} from './lib/browser-relay.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),dataDir=path.join(here,'.data');
await fs.mkdir(dataDir,{recursive:true});
const locks=new Map(),digest=data=>createHash('sha256').update(data).digest('hex');
const bucket={
 async get(key){try{const data=await fs.readFile(path.join(dataDir,digest(key)+'.json')),record=JSON.parse(data);const body=Buffer.from(record.body,'base64');return {body,size:body.length,httpEtag:'"'+digest(body)+'"',httpMetadata:record.metadata,json:async()=>JSON.parse(body.toString())}}catch(e){if(e.code==='ENOENT')return null;throw e}},
 async put(key,value,options={}){
  const body=Buffer.from(await new Response(value).arrayBuffer());
  const previous=locks.get(key)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{const old=await bucket.get(key),condition=options.onlyIf;if(condition?.get('If-None-Match')==='*'&&old)return null;if(condition?.get('If-Match')&&condition.get('If-Match')!==old?.httpEtag)return null;const filename=path.join(dataDir,digest(key)+'.json'),temporary=filename+'.'+randomUUID();await fs.writeFile(temporary,JSON.stringify({metadata:options.httpMetadata,body:body.toString('base64')}));await fs.rename(temporary,filename);return {httpEtag:'"'+digest(body)+'"'}});
  locks.set(key,operation);try{return await operation}finally{if(locks.get(key)===operation)locks.delete(key)}
 }
};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.zip':'application/zip','.mp3':'audio/mpeg'};
function serve(port,directory,api=false){
 const root=path.join(here,directory);
 http.createServer(async(req,res)=>{try{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end('Invalid host');return}
  const url=new URL(req.url,'http://'+req.headers.host);
  if(api&&['/account/sign-in','/account/sign-out'].includes(url.pathname)){res.writeHead(303,{'Location':'/desktop','Set-Cookie':'atelier-local-guest='+(url.pathname.endsWith('sign-out')?'1':'')+'; Path=/; HttpOnly; SameSite=Lax'+(url.pathname.endsWith('sign-in')?'; Max-Age=0':''),'Cache-Control':'no-store'});res.end();return}
  if(api&&url.pathname.startsWith('/api/')){
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined&&!key.startsWith('x-atelier-user-'))headers.set(key,Array.isArray(value)?value.join(', '):value);
   if(!/(?:^|;\s*)atelier-local-guest=1(?:;|$)/.test(req.headers.cookie||'')){headers.set('x-atelier-user-id','local');headers.set('x-atelier-user-email','local@atelier.invalid');}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>48*1024*1024){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
   const body=Buffer.concat(chunks);if(body.length)headers.set('content-length',String(body.length));
   const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body});
   let result;if(url.pathname==='/api/state')result=await cloudState(request,bucket);else if(url.pathname.startsWith('/api/blob/'))result=await cloudBlob(request,bucket,url.pathname.slice(10));else if(url.pathname==='/api/git')result=await gitProxy(request);else if(url.pathname==='/api/browser-relay')result=await browserRelay(request);else result=new Response('Not found',{status:404});
   res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();return;
  }
  let name=decodeURIComponent(url.pathname);if(name==='/'||name==='/desktop')name=api?'/desktop.html':'/index.html';
  const filename=path.resolve(root,'.'+name);if(!filename.startsWith(root+path.sep))throw Error('Invalid path');
  const bytes=await fs.readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(error){if(!res.headersSent)res.writeHead(error.code==='ENOENT'?404:500);res.end(error.code==='ENOENT'?'Not found':'Request failed')}}).listen(port,'127.0.0.1',()=>console.log('Ready: http://127.0.0.1:'+port));
}
serve(5173,'public',true);serve(5174,'browser-engine/dist');
