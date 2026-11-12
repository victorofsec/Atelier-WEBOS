import {guardWorkspace,migrateLegacyPin} from './workspace-lock.mjs';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
export function cloudAccess(request,allowedEmails){if(!allowedEmails)return null;const email=request.headers.get('x-atelier-user-email')||'';const id=request.headers.get('x-atelier-user-id');if(!id)return null;const allowed=String(allowedEmails).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);return allowed.includes(email.toLowerCase())?null:json({error:'Cloud access is currently limited to invited accounts.',guest:true,user:{id,email}},403)}
export async function cloudState(request,bucket,allowedEmails){
 const denied=cloudAccess(request,allowedEmails);if(denied)return denied;
 const user=request.headers.get('x-atelier-user-id');
 if(!user)return json({error:'Sign in to sync your desktop'},401);
 if(!bucket)return json({error:'Cloud storage is unavailable'},503);
 await migrateLegacyPin(bucket,user);
 const locked=await guardWorkspace(request,bucket,user);if(locked)return locked;
 const key='accounts/'+encodeURIComponent(user)+'/desktop.json';
 if(request.method==='GET'){
  const object=await bucket.get(key);
  if(!object)return json({state:null,revision:'new',user:{id:user,email:request.headers.get('x-atelier-user-email')}},200,{ETag:'"new"'});
  return json({state:await object.json(),revision:object.httpEtag,user:{id:user,email:request.headers.get('x-atelier-user-email')}},200,{ETag:object.httpEtag});
 }
 if(request.method!=='PUT')return json({error:'Method not allowed'},405);
 const origin=request.headers.get('Origin');
 if(origin&&origin!==new URL(request.url).origin)return json({error:'Invalid origin'},403);

 if(Number(request.headers.get('Content-Length'))>48*1024*1024)return json({error:'Snapshot exceeds 48 MB'},413);
 const body=await request.text();
 if(new TextEncoder().encode(body).length>48*1024*1024)return json({error:'Snapshot exceeds 48 MB'},413);
 let payload;try{payload=JSON.parse(body)}catch{return json({error:'Invalid JSON'},400)}
 // Version tokens travel in JSON, unaffected by proxy compression/weak ETags.
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return json({error:'Invalid desktop'},400);
 const modern=Object.hasOwn(payload,'state');
 const state=modern?payload.state:payload;
 const revision=modern?payload.baseRevision:request.headers.get('If-Match')?.replace(/^W\//,'');
 if(typeof revision!=='string'||!revision)return json({error:'Revision required'},428);
 if(!state||!Array.isArray(state.files)||!state.prefs||typeof state.prefs!=='object'||state.files.some(f=>typeof f.id!=='string'||typeof f.name!=='string'))return json({error:'Invalid desktop'},400);
 delete state.prefs.pin;
 const condition=new Headers(revision==='new'||revision==='"new"'?{'If-None-Match':'*'}:{'If-Match':revision});
 const object=await bucket.put(key,JSON.stringify(state),{onlyIf:condition,httpMetadata:{contentType:'application/json'}});
 if(!object)return json({error:'revision_conflict'},409);
 return json({saved:true,revision:object.httpEtag},200,{ETag:object.httpEtag});
}
export async function cloudBlob(request,bucket,id,allowedEmails){
 const denied=cloudAccess(request,allowedEmails);if(denied)return denied;
 const user=request.headers.get('x-atelier-user-id');if(!user)return json({error:'Sign in required'},401);
 if(!/^[a-f0-9]{64}$/.test(id))return json({error:'Invalid file ID'},400);
 if(!bucket)return json({error:'Storage unavailable'},503);
 await migrateLegacyPin(bucket,user);
 const locked=await guardWorkspace(request,bucket,user);if(locked)return locked;
 const key='accounts/'+encodeURIComponent(user)+'/files/'+id;
 if(request.method==='GET'){
  const object=await bucket.get(key,{range:request.headers});if(!object)return json({error:'File missing'},404);
  const headers=new Headers({'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store','Accept-Ranges':'bytes'});
  if(object.range){const offset=object.range.offset||0,length=object.range.length||object.size;headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${object.size}`);headers.set('Content-Length',String(length))}
  return new Response(object.body,{status:object.range?206:200,headers});
 }
 if(request.method!=='PUT')return json({error:'Method not allowed'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Invalid origin'},403);
 const length=Number(request.headers.get('Content-Length'));if(!length||length>40*1024*1024)return json({error:'File must be under 40 MB'},413);
 await bucket.put(key,request.body,{httpMetadata:{contentType:request.headers.get('Content-Type')||'application/octet-stream'}});
 return json({saved:true});
}
