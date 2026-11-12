import assert from 'node:assert/strict';
import {cloudState,cloudBlob} from './lib/cloud-state.mjs';
class Bucket{
 constructor(){this.objects=new Map();this.revision=0}
 async get(key){const o=this.objects.get(key);if(!o)return null;return {...o,json:async()=>JSON.parse(o.value),body:o.value}}
 async put(key,body,options={}){const old=this.objects.get(key),headers=options.onlyIf;
  if(headers?.get('If-None-Match')==='*'&&old)return null;
  if(headers?.get('If-Match')&&headers.get('If-Match')!==old?.httpEtag)return null;
  const value=typeof body==='string'?body:await new Response(body).text();const object={value,httpEtag:'"'+(++this.revision)+'"',httpMetadata:options.httpMetadata,size:value.length};this.objects.set(key,object);return object;
 }
}
const bucket=new Bucket(),snapshot={files:[{id:'a',name:'private.txt',type:'text',content:'Private A'}],prefs:{name:'A'}};
function request(user,method='GET',body,revision,origin='https://atelier.test'){const headers={'Content-Type':'application/json',Origin:origin};if(user)headers['x-atelier-user-id']=user;if(revision)headers['If-Match']=revision;return new Request('https://atelier.test/api/state',{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}
assert.equal((await cloudState(request(null),bucket)).status,401);
assert.equal((await cloudState(request('A'),null)).status,503);
assert.equal((await cloudState(request('A'),bucket)).headers.get('ETag'),'"new"');
const saved=await cloudState(request('A','PUT',snapshot,'"new"'),bucket);assert.equal(saved.status,200);const etag=saved.headers.get('ETag');
assert.equal((await cloudState(request('A','PUT',snapshot,'"new"'),bucket)).status,409);
assert.equal((await cloudState(request('B'),bucket)).status,200);assert.equal((await (await cloudState(request('B'),bucket)).json()).state,null);
assert.equal((await (await cloudState(request('A'),bucket)).json()).state.files[0].content,'Private A');
assert.equal((await cloudState(request('A','PUT',snapshot),bucket)).status,428);
assert.equal((await cloudState(request('A','PUT',snapshot,etag,'https://other.test'),bucket)).status,403);
assert.equal((await cloudState(request('A','PUT',{files:'bad'},etag),bucket)).status,400);
assert.equal((await cloudState(request('A','PUT',snapshot,etag),bucket)).status,200);
assert.equal((await cloudState(request('A','PUT',snapshot,etag),bucket)).status,409);
const hash='a'.repeat(64);const blobRequest=(user,method)=>new Request('https://atelier.test/api/blob/'+hash,{method,headers:{'x-atelier-user-id':user,'Content-Length':'3','Content-Type':'image/png'},body:method==='PUT'?'abc':undefined});
assert.equal((await cloudBlob(blobRequest('A','PUT'),bucket,hash)).status,200);
assert.equal((await cloudBlob(blobRequest('B','GET'),bucket,hash)).status,404);
const blob=await cloudBlob(blobRequest('A','GET'),bucket,hash);assert.equal(await blob.text(),'abc');assert.match(blob.headers.get('Content-Security-Policy'),/sandbox/);
assert.equal((await cloudBlob(blobRequest('A','GET'),bucket,'../account')).status,400);
console.log('16 cloud assertions passed: account isolation, authentication, conflict prevention, validation and blob protection.');

const modernBucket=new Bucket();
const modernRequest=(body,headers={})=>new Request('https://atelier.test/api/state',{method:'PUT',headers:{'x-atelier-user-id':'modern','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const created=await cloudState(modernRequest({baseRevision:'new',state:snapshot},{'If-Match':'W/"new"'}),modernBucket);assert.equal(created.status,200);const createdRevision=(await created.json()).revision;assert.ok(createdRevision);
const readModern=await(await cloudState(request('modern'),modernBucket)).json();assert.equal(readModern.revision,createdRevision);
const updated=await cloudState(modernRequest({baseRevision:createdRevision,state:{...snapshot,prefs:{name:'Updated'}}},{'If-Match':'W/'+createdRevision}),modernBucket);assert.equal(updated.status,200);
assert.equal((await cloudState(modernRequest({baseRevision:createdRevision,state:snapshot}),modernBucket)).status,409);
assert.equal((await cloudState(modernRequest(null),modernBucket)).status,400);
const legacyBucket=new Bucket();assert.equal((await cloudState(request('legacy','PUT',snapshot,'W/"new"'),legacyBucket)).status,200);
console.log('JSON revisions survive rewritten headers; stale writes are rejected; legacy W/new creates correctly.');

const accessModule=await import('./lib/cloud-state.mjs');
const uninvited=new Request('https://atelier.example/api/state',{headers:{'x-atelier-user-id':'uninvited','x-atelier-user-email':'outside@example.invalid'}});
assert.equal((await accessModule.cloudState(uninvited,null,'invited@example.invalid')).status,403);
assert.equal((await accessModule.cloudBlob(uninvited,null,'a'.repeat(64),'invited@example.invalid')).status,403);
assert.equal(accessModule.cloudAccess(new Request('https://atelier.example/api/state',{headers:{'x-atelier-user-id':'invited','x-atelier-user-email':'INVITED@example.invalid'}}),'invited@example.invalid'),null);
console.log('PASS invited accounts: state and files enforce trusted identity allowlist');
