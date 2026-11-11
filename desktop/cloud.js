// Cloud is the durable store. IndexedDB only buffers unacknowledged changes.
let localOwner=null;
const cloud={user:null,revision:null,base:null,ready:false,busy:false,loading:null,running:null,dirty:false,timer:null,status:'Connecting…',generation:0,conflict:false};
const uploadCache=new Map();
function defaultPreferences(){return {name:'Your Space',theme:'light',wall:'assets/wallpaper.jpg',brightness:1,volume:.5,pin:'',lockSameWallpaper:true,lockWall:'',events:[],reminders:[],contacts:[],musicFavorites:[]}}
function normalizeRevision(value){return typeof value==='string'?value.replace(/^W\//,'').replace(/^"new"$/,'new'):null}
function syncStatus(message){cloud.status=message;for(const node of $$('[data-sync-status]'))node.textContent=message;for(const button of $$('[data-action=sync-now]')){button.disabled=cloud.busy;button.textContent=cloud.busy?'Saving…':'Sync Now'}}
async function cloudRequest(url,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{return await fetch(url,{...options,cache:'no-store',signal:controller.signal})}finally{clearTimeout(timer)}}
async function readRemote(){const response=await cloudRequest('/api/state');if(!response.ok)throw Error(response.status===401?'Sign in again to resume cloud sync.':'Cloud unavailable. Retrying automatically.');const data=await response.json();if(!data.user?.id||typeof data.revision!=='string')throw Error('Cloud response is incomplete. Retrying automatically.');return data}
async function persistCache(){if(!db)return;const owner=cloud.user?.id||localOwner;const record=structuredClone({files,prefs,owner,baseRevision:cloud.revision,baseState:cloud.base,pending:cloud.dirty});try{await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(record,owner?'session:'+owner:'session');if(owner)tx.objectStore('state').put({files:[],prefs:defaultPreferences(),owner},'session');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}catch{if(!cloud.ready)toast('Connection required: the temporary local buffer is unavailable.')}}
save=async function(){queueCloudSave();await persistCache()};
function queueCloudSave(){cloud.generation++;cloud.dirty=true;cloud.conflict=false;clearTimeout(cloud.timer);syncStatus(cloud.ready?(cloud.busy?'Saving new changes…':'Waiting to sync…'):'Offline · changes waiting to sync');cloud.timer=setTimeout(()=>cloud.ready?flushCloud():loadCloud(),700)}
function comparable(value){if(value===undefined)return undefined;return JSON.stringify(value,(key,v)=>key==='modified'?undefined:v)}
function mergeCloudStates(base,local,remote){
 const before=new Map((base?.files||[]).map(f=>[f.id,f])),ours=new Map(local.files.map(f=>[f.id,f])),theirs=new Map(remote.files.map(f=>[f.id,f]));const merged=[],copies=[];
 for(const id of new Set([...before.keys(),...ours.keys(),...theirs.keys()])){
  const b=before.get(id),l=ours.get(id),r=theirs.get(id),same=(a,b)=>comparable(a)===comparable(b);
  if(same(l,r)){if(l)merged.push(l)}else if(base&&same(l,b)){if(r)merged.push(r)}else if(base&&same(r,b)){if(l)merged.push(l)}
  else if(!l||!r){const kept=l||r;if(kept)merged.push(kept)}
  else if(l.parent==='root'||l.type==='folder'&&r.type==='folder'){merged.push({...r,...l})}
  else{merged.push(r);if(!l.deleted)copies.push({...l,id:uid(),recoveredFrom:l.id,deleted:false,name:l.name.replace(/(\.[^.]+)?$/,(_,ext)=>' (recovered copy)'+(ext||''))})}
 }
 for(const f of copies){while(merged.some(x=>x.parent===f.parent&&x.name===f.name))f.name='Copy of '+f.name;merged.push(f)}
 const preferences={...remote.prefs};for(const key of Object.keys(local.prefs)){const l=local.prefs[key],r=remote.prefs[key],b=base?.prefs?.[key];if(base&&comparable(l)===comparable(b))continue;
  if(['events','reminders','contacts','playlists'].includes(key)&&Array.isArray(l)&&Array.isArray(r)){const bm=new Map((b||[]).map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));preferences[key]=[];for(const id of new Set([...lm.keys(),...rm.keys()])){const lv=lm.get(id),rv=rm.get(id),bv=bm.get(id);const item=base&&comparable(lv)===comparable(bv)?rv:base&&comparable(rv)===comparable(bv)?lv:lv||rv;if(item)preferences[key].push(item)}}
  else preferences[key]=l;
 }
 return {files:merged,prefs:preferences};
}
function adoptCloudState(state){
 const oldIds=new Set(files.map(f=>f.id));for(const copy of state.files.filter(f=>f.recoveredFrom&&!oldIds.has(f.id)))for(const w of windows.values())for(const key of ['file','note','photo'])if(w.state[key]===copy.recoveredFrom)w.state[key]=copy.id;
 files=state.files;prefs={...defaultPreferences(),...state.prefs};
}
function repaintCloudDesktop(){applyPrefs();renderDesktop();renderDock();for(const w of windows.values())if(['files','trash','settings','notes','textedit','editor','photos','calendar','reminders','contacts'].includes(w.app)&&!w.sheetResolve){const focused=document.activeElement,inside=w.body.contains(focused),label=inside?focused.getAttribute('aria-label'):null,start=inside?focused.selectionStart:null,end=inside?focused.selectionEnd:null;render(w);if(label){const target=[...w.body.querySelectorAll('[aria-label]')].find(el=>el.getAttribute('aria-label')===label);if(target){target.focus();if(start!==null&&typeof target.setSelectionRange==='function')try{target.setSelectionRange(start,end)}catch{}}}}}
async function loadCloud(){
 if(cloud.loading)return cloud.loading;if(cloud.busy)return cloud.running;
 cloud.loading=(async()=>{try{
  syncStatus('Connecting…');const remote=await readRemote(),sameAccount=!localOwner||localOwner===remote.user.id;
  const cached=await readLocalSession('session:'+remote.user.id);const pending=sameAccount&&cloud.dirty?{files,prefs,baseRevision:cloud.revision,baseState:cloud.base,pending:true}:cached;
  cloud.user=remote.user;uploadCache.clear();cloud.revision=remote.revision;cloud.conflict=false;
  if(pending?.pending){const local={files:pending.files,prefs:pending.prefs};const state=remote.state&&normalizeRevision(pending.baseRevision)!==remote.revision?mergeCloudStates(pending.baseState||null,local,remote.state):local;adoptCloudState(state);cloud.dirty=!remote.state||comparable(state)!==comparable(remote.state)}
  else if(remote.state){files=remote.state.files;prefs={...defaultPreferences(),...remote.state.prefs};cloud.dirty=false}
  else{if(cached){files=cached.files;prefs={...defaultPreferences(),...cached.prefs}}else if(!sameAccount){files=seed();prefs=defaultPreferences()}cloud.dirty=true}
  localOwner=remote.user.id;cloud.base=remote.state?structuredClone(remote.state):null;cloud.ready=true;await persistCache();syncStatus(cloud.dirty?'Waiting to sync…':'Saved to your account');
 }catch(error){cloud.ready=false;syncStatus(error.name==='AbortError'?'Connection timed out. Retrying automatically.':error.message);clearTimeout(cloud.timer);cloud.timer=setTimeout(loadCloud,15000)}finally{cloud.loading=null}})();
 await cloud.loading;if(cloud.ready&&cloud.dirty)return flushCloud();
}
async function cloudContent(value){if(typeof value!=='string'||!value.startsWith('data:'))return value;if(uploadCache.has(value))return uploadCache.get(value);const blob=await(await fetch(value)).blob();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');const url='/api/blob/'+hash;const response=await cloudRequest(url,{method:'PUT',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});if(!response.ok)throw Error('File upload failed. Retrying automatically.');uploadCache.set(value,url);return url}
async function cloudSnapshot(){const snapshot=structuredClone({files,prefs});for(const f of snapshot.files)f.content=await cloudContent(f.content);snapshot.prefs.wall=await cloudContent(snapshot.prefs.wall);snapshot.prefs.lockWall=await cloudContent(snapshot.prefs.lockWall);return snapshot}
async function flushCloud(){
 if(cloud.busy)return cloud.running;if(!cloud.ready)return loadCloud();if(!cloud.dirty){syncStatus('Saved to your account');return}
 clearTimeout(cloud.timer);cloud.busy=true;syncStatus('Saving…');
 cloud.running=(async()=>{try{for(let attempt=0;attempt<4;attempt++){
  const generation=cloud.generation,snapshot=await cloudSnapshot();
  const response=await cloudRequest('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:cloud.revision,state:snapshot})});
  if(response.status===409){syncStatus('Combining changes from your devices…');const remote=await readRemote();if(remote.user.id!==cloud.user.id)throw Error('Account changed. Reload Atelier to continue.');const mergeGeneration=cloud.generation,latest=await cloudSnapshot();if(cloud.generation!==mergeGeneration)continue;const merged=remote.state?mergeCloudStates(cloud.base,latest,remote.state):latest;adoptCloudState(merged);cloud.base=remote.state;cloud.revision=remote.revision;cloud.generation++;cloud.dirty=true;await persistCache();repaintCloudDesktop();continue}
  if(!response.ok)throw Error('Cloud save failed ('+response.status+'). Retrying automatically.');const result=await response.json();if(typeof result.revision!=='string')throw Error('Save confirmation missing. Retrying automatically.');
  cloud.revision=result.revision;cloud.base=snapshot;cloud.dirty=cloud.generation!==generation;await persistCache();syncStatus(cloud.dirty?'Saving new changes…':'Saved to your account');return;
 }throw Error('Other devices are saving. Retrying shortly.')}catch(error){cloud.dirty=true;syncStatus(error.name==='AbortError'?'Connection timed out. Retrying automatically.':error.message);await persistCache()}finally{cloud.busy=false;syncStatus(cloud.status);cloud.running=null;if(cloud.dirty){clearTimeout(cloud.timer);cloud.timer=setTimeout(flushCloud,cloud.status==='Saving new changes…'?200:5000)}}})();return cloud.running;
}
window.addEventListener('online',()=>{(cloud.ready?flushCloud():loadCloud()).then(repaintCloudDesktop)});
window.addEventListener('beforeunload',e=>{if(cloud.dirty||cloud.busy){e.preventDefault();e.returnValue=''}});
