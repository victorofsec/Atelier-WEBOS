import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {gitProxy} from './lib/git-proxy.mjs';
import {gitFixture} from './test-git-fixture.mjs';
const fixture=await gitFixture();
// Evaluate the deployed browser artifact, not the Node export of isomorphic-git.
const context=vm.createContext({indexedDB,IDBKeyRange,navigator:{userAgent:'Atelier test'},console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,URL,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext('globalThis.window=globalThis;globalThis.self=globalThis',context);
assert.equal(vm.runInContext('typeof Buffer',context),'undefined');
const modules=new Map();
async function load(url){if(modules.has(url))return modules.get(url);const mod=new vm.SourceTextModule(await fs.readFile(new URL(url),'utf8'),{context,identifier:url});modules.set(url,mod);await mod.link((specifier,parent)=>load(new URL(specifier,parent.identifier).href));return mod}
try{
 const module=await load(new URL('./public/vendor/git.js',import.meta.url).href);await module.evaluate();const git=module.namespace.default;const {fs:gitFs,dir}=fixture.env;
 await git.clone({fs:gitFs,dir,http:{request:fixture.request},url:'https://github.com/fixture/remote.git',singleBranch:true});
 assert.equal(await fs.readFile(dir+'/hello.txt','utf8'),'Original\n');
 await fs.writeFile(dir+'/hello.txt','Browser artifact commit\n');await git.add({fs:gitFs,dir,filepath:'hello.txt'});
 const oid=await git.commit({fs:gitFs,dir,message:'Browser artifact test',author:{name:'Fixture',email:'fixture@example.invalid'}});
 await git.push({fs:gitFs,dir,http:{request:fixture.request},remote:'origin',ref:'main'});assert.equal(fixture.head(),oid);
 assert.equal(vm.runInContext('typeof Buffer',context),'undefined');
 
 if(process.argv.includes('--remote')){
  const remoteDir='/remote',browserFs=new module.namespace.LightningFS('browser-remote-fixture',{wipe:true});await browserFs.promises.mkdir(remoteDir);
  const http={async request({url,method='GET',headers={},body}){const chunks=[];if(body)for await(const chunk of body)chunks.push(chunk);const requestHeaders=new Headers(headers);requestHeaders.set('x-atelier-user-id','local-regression-fixture');const response=await gitProxy(new Request('https://atelier.test/api/git?url='+encodeURIComponent(url),{method,headers:requestHeaders,body:method==='GET'?undefined:new Blob(chunks)}));return{url,method,statusCode:response.status,statusMessage:response.statusText,headers:Object.fromEntries(response.headers),body:[new Uint8Array(await response.arrayBuffer())]}}};
  await git.clone({fs:browserFs,dir:remoteDir,http,url:'https://github.com/victorofsec/remarrees',singleBranch:true});
  assert.ok((await git.log({fs:browserFs,dir:remoteDir,depth:1}))[0].oid);
  console.log('PASS exact reported HTTPS URL through the Git transport using the browser artifact (read-only clone)');
 }
 console.log('PASS deployed browser Git bundle: clone, checkout, add, commit and push without a global Buffer or process');
}finally{await fixture.close()}
