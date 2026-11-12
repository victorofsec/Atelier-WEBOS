// A lock is an additional server-side gate, not end-to-end encryption.
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const prefix=user=>'accounts/'+encodeURIComponent(user)+'/';
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
async function digest(value){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))}
async function pinHash(pin,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256))}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0}
async function get(bucket,key){const object=await bucket.get(key);return object?{value:await object.json(),etag:object.httpEtag}:null}
const put=(bucket,key,value,etag)=>bucket.put(key,JSON.stringify(value),etag?{onlyIf:new Headers({'If-Match':etag})}:{});
function cookie(request){return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('atelier_unlock='))?.slice(15)||''}
function cookieHeader(request,token,age=43200){return 'atelier_unlock='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(new URL(request.url).protocol==='https:'?'; Secure':'')}
export async function lockConfig(bucket,user){return get(bucket,prefix(user)+'security.json')}
export async function unlocked(request,bucket,user,config){if(!config?.value.hash)return true;const token=cookie(request);if(!/^[a-f0-9]{64}$/.test(token))return false;const session=await get(bucket,prefix(user)+'sessions/'+await digest(token)+'.json');return !!session&&session.value.version===config.value.version&&session.value.expires>Date.now()}
export async function guardWorkspace(request,bucket,user){const config=await lockConfig(bucket,user);return await unlocked(request,bucket,user,config)?null:reply({locked:true,hasPin:true,error:'Unlock your workspace to continue.'},423)}
// Migrate old plaintext codes before returning any workspace contents.
export async function migrateLegacyPin(bucket,user){const key=prefix(user)+'desktop.json',object=await get(bucket,key);if(!object?.value.prefs?.pin)return;const pin=object.value.prefs.pin,existing=await lockConfig(bucket,user);if(!existing?.value.hash){const salt=random();await bucket.put(prefix(user)+'security.json',JSON.stringify({salt,hash:await pinHash(pin,salt),version:random(),failures:0,retryAt:0}),{onlyIf:new Headers({'If-None-Match':'*'})})}delete object.value.prefs.pin;await put(bucket,key,object.value,object.etag)}
export async function workspaceSecurity(request,bucket,user){
 if(!user)return reply({error:'Sign in required'},401);if(!bucket)return reply({error:'Cloud storage unavailable'},503);await migrateLegacyPin(bucket,user);let config=await lockConfig(bucket,user);
 if(request.method==='GET')return reply({hasPin:!!config?.value.hash,locked:!await unlocked(request,bucket,user,config)});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply({error:'Invalid origin'},403);
 let body;try{const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large'},413);body=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
 if(!body||!['unlock','lock','set','remove'].includes(body.action))return reply({error:'Unknown action'},400);
 const key=prefix(user)+'security.json';
 if(body.action==='lock'){const token=cookie(request);if(token&&bucket.delete)await bucket.delete(prefix(user)+'sessions/'+await digest(token)+'.json');else if(token)await put(bucket,prefix(user)+'sessions/'+await digest(token)+'.json',{expires:0});return reply({locked:!!config?.value.hash,hasPin:!!config?.value.hash},200,{'Set-Cookie':cookieHeader(request,'',0)})}
 if(config?.value.hash){
  if(config.value.retryAt>Date.now())return reply({error:'Too many attempts. Try again shortly.',retryAfter:Math.ceil((config.value.retryAt-Date.now())/1000)},429);
  // Reserve an attempt atomically before doing expensive verification.
  const attempt={...config.value,failures:(config.value.failures||0)+1,retryAt:Date.now()+1500};if(attempt.failures>=5)attempt.retryAt=Date.now()+60000;
  const reserved=await put(bucket,key,attempt,config.etag);if(!reserved)return reply({error:'Another attempt is in progress. Try again.'},429);
  const pin=body.action==='unlock'?body.pin:body.currentPin;
  if(typeof pin!=='string'||pin.length>128||!equal(await pinHash(pin,config.value.salt),config.value.hash))return reply({error:'Incorrect code. Try again.'},403);
  config={value:attempt,etag:reserved.httpEtag};
 }
 if(body.action==='remove'){const result=await put(bucket,key,{version:random(),failures:0,retryAt:0},config?.etag);if(!result)return reply({error:'Security settings changed. Try again.'},409);return reply({hasPin:false,locked:false},200,{'Set-Cookie':cookieHeader(request,'',0)})}
 let next={...(config?.value||{}),failures:0,retryAt:0};
 if(body.action==='set'){if(typeof body.pin!=='string'||body.pin.length<6||body.pin.length>128)return reply({error:'Use 6 to 128 characters.'},400);const salt=random();next={salt,hash:await pinHash(body.pin,salt),version:random(),failures:0,retryAt:0}}
 const result=await put(bucket,key,next,config?.etag);if(!result)return reply({error:'Security settings changed. Try again.'},409);
 const token=random();await put(bucket,prefix(user)+'sessions/'+await digest(token)+'.json',{version:next.version,expires:Date.now()+43200000});
 return reply({locked:false,hasPin:!!next.hash},200,{'Set-Cookie':cookieHeader(request,token)});
}
