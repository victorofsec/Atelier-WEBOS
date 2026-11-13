// The engine runs on a different origin. Its only desktop capability is this
// bounded HTTP relay; it never receives files, cloud credentials or account data.
const BROWSER_ENGINE_ORIGIN='http://127.0.0.1:5174';
function browserStatus(w,text){const node=q(w,'.reader-status');if(node)node.textContent=text}
function browserHistoryState(w){const s=w.state;q(w,'.web-address').value=s.history[s.index]==='atelier://home'?'':s.history[s.index]}
function browserPost(w,message){const body=message.response?.body;w.state.browserFrame?.contentWindow?.postMessage({atelierBrowser:1,...message},BROWSER_ENGINE_ORIGIN,body instanceof ArrayBuffer?[body]:[])}
function browserWarning(w,text){w.state.browserWarning=text;browserStatus(w,text);const banner=q(w,'.browser-warning');banner.textContent=text;banner.hidden=!text}
function rememberBrowserPage(url,title){prefs.browserHistory??=[];prefs.browserHistory=prefs.browserHistory.filter(h=>h.url!==url);prefs.browserHistory.unshift({url,title:String(title||url).slice(0,180),time:Date.now()});prefs.browserHistory=prefs.browserHistory.slice(0,200);save()}
async function browserRelayFetch(m,signal){
 if(!/^https?:\/\//i.test(m.url)||m.url.length>8192)throw Error('Invalid website address.');
 if(m.body&&(!(m.body instanceof ArrayBuffer)||m.body.byteLength>8*1024*1024))throw Error('Uploads are limited to 8 MB.');
 const metadata=encodeURIComponent(JSON.stringify({url:m.url,method:m.method,headers:m.headers}));if(metadata.length>48000)throw Error('Website request headers are too large.');
 const response=await fetch('/api/browser-relay',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Atelier-Browser':'1','X-Atelier-Browser-Encoding':'gzip','X-Browser-Request':metadata},credentials:'same-origin',body:m.body||undefined,signal});
 if(!response.ok){let detail;try{detail=(await response.json()).error}catch{}throw Error(detail||'Browser relay returned HTTP '+response.status+'.')}
 const decoded=response.headers.get('x-atelier-encoding')==='gzip'?new Response(response.body.pipeThrough(new DecompressionStream('gzip'))):response;
 const packet=await decoded.arrayBuffer();if(packet.byteLength<4||packet.byteLength>17*1024*1024)throw Error('Invalid browser response.');
 const length=new DataView(packet).getUint32(0);if(length>65536||length+4>packet.byteLength)throw Error('Invalid browser response headers.');
 return {...JSON.parse(new TextDecoder().decode(new Uint8Array(packet,4,length))),body:packet.slice(4+length)};
}
async function handleBrowserRelay(w,m){
 const s=w.state,epoch=s.browserEpoch;if(typeof m.id!=='string'||m.id.length>100||s.browserRequests.has(m.id))return;
 if(s.browserRequests.size>=96){browserPost(w,{type:'response',id:m.id,error:'Too many website requests.'});return}
 const controller=new AbortController();s.browserRequests.set(m.id,controller);
 try{
  const info=await browserRelayFetch(m,controller.signal);
  if(info.warning&&epoch===s.browserEpoch){let target;try{target=new URL(m.url).hostname}catch{}browserWarning(w,(target?target+': ':'')+info.warning)}
  browserPost(w,{type:'response',id:m.id,response:info});
 }catch(error){if(!s.browserClosed)browserPost(w,{type:'response',id:m.id,error:error.message})}finally{s.browserRequests.delete(m.id)}
}
function ensureBrowserFrame(w){
 const s=w.state;if(s.browserFrame)return;
 const frame=document.createElement('iframe');frame.className='browser-engine';frame.title='Atelier web browser';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-downloads');frame.src=BROWSER_ENGINE_ORIGIN+'/';s.browserFrame=frame;
 q(w,'.browser-frame-slot').append(frame);browserStatus(w,'Starting browser…');
 s.browserTimer=setTimeout(()=>{if(!s.browserReady)browserStatus(w,'Browser engine did not start. Check your connection, then click Reload.')},25000);
}
renderBrowser=function(w){
 const s=w.state;s.history??=['atelier://home'];s.index??=0;s.zoom??=100;s.browserRequests=new Map();s.browserClosed=false;
 w.body.innerHTML='<div class="browser-toolbar">'+button(icon('back'),'back')+button(icon('forward'),'forward')+button(icon('refresh'),'refresh')+button(icon('home'),'home')+'<input class="web-address" placeholder="Search or enter website address" aria-label="Address">'+button('Open HTML','open-html')+'</div><div class="reader-tools"><span class="reader-status" role="status">Ready</span><span class="spacer"></span>'+button('−','zoom-out')+'<span class="reader-zoom">'+s.zoom+'%</span>'+button('+','zoom-in')+'</div><div class="browser-warning" role="status" hidden></div><div class="browser-content"><div class="web-body reader-body"></div><div class="browser-frame-slot" hidden></div></div>';
 q(w,'.browser-toolbar').insertAdjacentHTML('beforeend',button('Reader','reading-mode'));
 const readerToggle=q(w,'[data-action=reading-mode]');readerToggle.title='Read public pages without the interactive engine';readerToggle.setAttribute('aria-pressed',String(!!s.readerMode));
 readerToggle.textContent=s.readerMode?'Interactive':'Reader';
 readerToggle.onclick=()=>{s.readerMode=!s.readerMode;readerToggle.setAttribute('aria-pressed',String(s.readerMode));readerToggle.textContent=s.readerMode?'Interactive':'Reader';if(s.readerMode){for(const request of s.browserRequests.values())request.abort();s.browserRequests.clear();clearTimeout(s.browserTimer);s.browserFrame?.remove();s.browserFrame=null;s.browserReady=false}showPage(w)};
 const message=e=>{
  if(e.origin!==BROWSER_ENGINE_ORIGIN||e.source!==s.browserFrame?.contentWindow||e.data?.atelierBrowser!==1)return;
  const m=e.data;
  if(m.type==='hello'){browserPost(w,{type:'init'});return}
  if(m.type==='ready'){s.browserReady=true;clearTimeout(s.browserTimer);const url=s.history[s.index];if(/^https?:/.test(url)&&!s.readerMode)browserPost(w,{type:'navigate',url});browserPost(w,{type:'zoom',value:s.zoom});return}
  if(m.type==='request'){handleBrowserRelay(w,m);return}
  if(m.type==='cancel'){s.browserRequests.get(m.id)?.abort();return}
  if(m.type==='error'){browserStatus(w,String(m.message).slice(0,300));return}
  if(q(w,'.browser-frame-slot').hidden)return;
  if(m.type==='navigating'){browserWarning(w,'');browserStatus(w,'Loading…')}
  if(['location','loaded'].includes(m.type)){
   let url;try{url=new URL(m.url);if(!['http:','https:'].includes(url.protocol))return}catch{return}
   if(s.history[s.index]!==url.href){s.history=s.history.slice(0,s.index+1);s.history.push(url.href);s.index=s.history.length-1}browserHistoryState(w);
   if(m.type==='loaded'){browserStatus(w,s.browserWarning||String(m.title||url.hostname).slice(0,180));rememberBrowserPage(url.href,m.title)}
  }
 };window.addEventListener('message',message);
 q(w,'.web-address').onkeydown=e=>{if(e.key==='Enter')navigate(w,e.target.value)};
 bind(w,'home',()=>navigate(w,'atelier://home'));
 for(const action of ['back','forward'])bind(w,action,()=>{if(!q(w,'.browser-frame-slot').hidden)browserPost(w,{type:action});else{const index=s.index+(action==='back'?-1:1);if(index>=0&&index<s.history.length){s.index=index;showPage(w)}}});
 bind(w,'refresh',()=>{if(!q(w,'.browser-frame-slot').hidden&&s.browserReady)browserPost(w,{type:'reload'});else{if(s.browserFrame&&!s.browserReady){s.browserFrame.remove();s.browserFrame=null;clearTimeout(s.browserTimer)}showPage(w)}});
 for(const [action,delta]of [['zoom-out',-10],['zoom-in',10]])bind(w,action,()=>{s.zoom=Math.min(180,Math.max(70,s.zoom+delta));q(w,'.reader-zoom').textContent=s.zoom+'%';browserPost(w,{type:'zoom',value:s.zoom});const host=q(w,'.reader-document');if(host)host.style.fontSize=16*s.zoom/100+'px'});
 bind(w,'open-html',()=>{const picker=document.createElement('input');picker.type='file';picker.accept='.html,.htm,text/html';picker.onchange=async()=>{const file=picker.files[0];if(!file)return;if(file.size>4*1024*1024)return browserStatus(w,'HTML files must be smaller than 4 MB.');try{const f={id:uid(),name:file.name,type:'text',parent:'documents',content:await file.text(),modified:Date.now()};files.push(f);refreshFiles();navigate(w,'atelier://file/'+f.id)}catch(e){browserStatus(w,e.message)}};picker.click()});
 w.cleanup=()=>{s.browserClosed=true;s.readerAbort?.abort();for(const request of s.browserRequests.values())request.abort();clearTimeout(s.browserTimer);window.removeEventListener('message',message);s.browserFrame?.remove();s.browserFrame=null};showPage(w);
};renderers.browser=renderBrowser;
navigate=function(w,value){
 let url=String(value).trim();if(!url)return;
 if(!/^atelier:\/\/(home$|file\/)/.test(url)&&!/^https?:\/\//i.test(url)){
  if(/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(url))url='https://'+url;
  else if(/^[a-z][\w+.-]*:/i.test(url)){browserStatus(w,'Only HTTP and HTTPS website addresses are supported.');return}
  else url='https://www.google.com/search?q='+encodeURIComponent(url);
 }
 if(/^https?:/i.test(url)){try{const target=new URL(url);if(target.username||target.password)throw Error();url=target.href}catch{browserStatus(w,'Enter a valid website address.');return}}
 const s=w.state;s.history=s.history.slice(0,s.index+1);s.history.push(url);s.index=s.history.length-1;return showPage(w);
};
function showBrowserHome(w){
 const body=q(w,'.web-body');body.innerHTML='<div class="reader-home"><span class="reader-eyebrow">ATELIER BROWSER</span><h1>Your window to the web.</h1><form class="reader-search"><input aria-label="Search the web" placeholder="Search or enter website address"><button class="primary">Go</button></form><div class="reader-home-actions">'+button('GitHub','github')+button('Wikipedia','wiki')+button('ÉcoleDirecte','school')+'</div><div class="history-heading"><h3>History</h3>'+button('Clear','clear-history')+'</div><div class="browser-history">'+(prefs.browserHistory||[]).slice(0,20).map((h,i)=>'<button data-read-history="'+i+'"><span>'+esc(h.title||h.url)+'</span><small>'+new Date(h.time).toLocaleDateString('en-US')+'</small></button>').join('')+'</div><small>Websites open inside Atelier. Some sign-in providers, protected media and live connections may not work with this browser.</small></div>';
 q(w,'.reader-search').onsubmit=e=>{e.preventDefault();navigate(w,q(w,'.reader-search input').value)};bind(w,'school',()=>navigate(w,'https://www.ecoledirecte.com/'));bind(w,'github',()=>navigate(w,'https://github.com'));bind(w,'wiki',()=>navigate(w,'https://en.wikipedia.org/wiki/Main_Page'));bind(w,'clear-history',()=>{prefs.browserHistory=[];save();showBrowserHome(w)});qa(w,'[data-read-history]').forEach(b=>b.onclick=()=>navigate(w,prefs.browserHistory[+b.dataset.readHistory].url));browserStatus(w,'Ready');
}
showPage=async function(w){
 w.state.browserEpoch=(w.state.browserEpoch||0)+1;
 browserWarning(w,'');
 const s=w.state;s.readerAbort?.abort();const controller=s.readerAbort=new AbortController(),url=s.history[s.index];browserHistoryState(w);
 const remote=/^https?:/i.test(url);q(w,'.browser-frame-slot').hidden=!remote||!!s.readerMode;q(w,'.web-body').hidden=remote&&!s.readerMode;
 if(remote&&s.readerMode){await showRemoteReader(w,url,controller);return}
 if(remote){ensureBrowserFrame(w);if(s.browserReady)browserPost(w,{type:'navigate',url});browserStatus(w,'Loading…');return}
 if(url==='atelier://home'){showBrowserHome(w);return}
 if(url.startsWith('atelier://file/')){try{const f=files.find(f=>f.id===url.slice(15)&&visible(f));if(!f)throw Error('This HTML file is no longer available.');await showReaderDocument(w,new TextDecoder().decode(await fileBytes(f)),'https://local.invalid/',f.name,controller)}catch(e){browserStatus(w,e.message)}return}
 browserStatus(w,'This saved address is no longer supported.');showBrowserHome(w);
};
async function showRemoteReader(w,url,controller){
 const body=q(w,'.web-body');body.innerHTML='<div class="reader-home"><h2>Loading reading view…</h2></div>';browserStatus(w,'Reading view — scripts and sign-in forms are disabled');
 try{
  let result;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);
  for(let redirects=0;redirects<=8;redirects++){
   result=await browserRelayFetch({url,method:'GET',headers:{accept:'text/html,application/xhtml+xml,text/plain;q=0.8'}},signal);
   const location=Object.entries(result.headers).find(([key])=>key.toLowerCase()==='location')?.[1];
   if([301,302,303,307,308].includes(result.status)&&location){if(redirects===8)throw Error('Too many website redirects.');const target=new URL(location,url);if(!/^https?:$/.test(target.protocol)||target.username||target.password)throw Error('Unsupported website redirect.');url=target.href;continue}break;
  }
  if(result.status>=400)throw Error('The website refused this request (HTTP '+result.status+').');
  const type=Object.entries(result.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]||'';
  if(!/text\/|application\/xhtml\+xml/i.test(type))throw Error('Reading view supports HTML and text pages only.');
  if(result.body.byteLength>4*1024*1024)throw Error('This page exceeds the 4 MB reading limit.');
  let html=new TextDecoder().decode(result.body);if(/text\/plain/i.test(type))html='<pre>'+esc(html)+'</pre>';
  const title=await showReaderDocument(w,html,url,'',controller);
  if(title&&!controller.signal.aborted){w.state.history[w.state.index]=url;browserHistoryState(w);rememberBrowserPage(url,title);browserWarning(w,'Reading view: public content only. Scripts, forms and account sign-in are unavailable.')}
 }catch(error){if(controller.signal.aborted||w.state.readerAbort!==controller)return;body.innerHTML='<div class="reader-home"><h2>Reading view unavailable</h2><p>'+esc(error.name==='TimeoutError'?'The website took too long to respond.':error.message)+'</p></div>';browserStatus(w,'Reading view unavailable')}
}
