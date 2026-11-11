import '/navigation.js';
const canonical=(value,base)=>AtelierNavigation.canonical(value,location.origin,base);
const parentOrigin='http://127.0.0.1:5173';
const client=crypto.randomUUID(),channel=new BroadcastChannel('atelier-http-v2');
const post=m=>parent.postMessage({atelierBrowser:1,...m},parentOrigin,m.body instanceof ArrayBuffer?[m.body]:[]);
const status=document.querySelector('#status');let frame,controller,connected=false;
channel.onmessage=({data:m})=>{
 if(!connected)return;
 if(m.type==='probe')channel.postMessage({type:'offer',id:m.id,client});
 if(m.client!==client)return;
 if(m.type==='request')post({type:'request',id:m.id,url:m.url,method:m.method,headers:m.headers,body:m.body});
 if(m.type==='cancel')post({type:'cancel',id:m.id});
};
window.addEventListener('message',async e=>{
 if(e.source!==parent||e.origin!==parentOrigin||e.data?.atelierBrowser!==1)return;
 const m=e.data;
 if(m.type==='response'){channel.postMessage({...m,client});return}
 if(m.type==='init'&&!connected){connected=true;try{await start();post({type:'ready'})}catch(error){status.textContent='Browser engine could not start: '+error.message;post({type:'error',message:status.textContent})}return}
 if(!frame)return;
 if(m.type==='navigate'){try{frame.go(canonical(m.url))}catch(error){post({type:'error',message:error.message})}}
 if(m.type==='back')frame.back();if(m.type==='forward')frame.forward();if(m.type==='reload')frame.reload();
 if(m.type==='zoom'){const zoom=Math.min(180,Math.max(70,Number(m.value)||100))/100;frame.frame.style.width=100/zoom+'%';frame.frame.style.height=100/zoom+'%';frame.frame.style.transformOrigin='0 0';frame.frame.style.transform=`scale(${zoom})`}
});
async function start(){
 if(!('serviceWorker'in navigator)||!('SharedWorker'in window))throw Error('This browser needs Service Workers and Shared Workers.');
 const {ScramjetController}=$scramjetLoadController();
 controller=new ScramjetController({prefix:'/browse/',flags:{captureErrors:false,sourcemaps:false},files:{wasm:'/scramjet/scramjet.wasm.wasm',all:'/scramjet/scramjet.all.js',sync:'/scramjet/scramjet.sync.js'}});
 await controller.init();
 const connection=new BareMux.BareMuxConnection('/baremux/worker.js');
 if(await connection.getTransport()!=='/transport.mjs?v=2')await connection.setTransport('/transport.mjs?v=2',[]);
 const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await registration.update();const installing=registration.installing;if(installing&&installing.state!=="activated")await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Browser update timed out.")),12000);installing.addEventListener("statechange",()=>{if(installing.state==="activated"){clearTimeout(timer);resolve()}else if(installing.state==="redundant"){clearTimeout(timer);reject(Error("Browser update failed."))}})});await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Service Worker did not take control.')),12000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true})});
 frame=controller.createFrame();frame.frame.title='Website';frame.frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-downloads');
 frame.addEventListener('navigate',e=>{post({type:'navigating',url:e.url})});
 frame.addEventListener('urlchange',e=>{try{post({type:'location',url:canonical(e.url)})}catch{}});
 frame.addEventListener('contextInit',e=>{
  // Keep target=_blank links and scripted windows inside the current browser.
  try{e.window.open=(url)=>{if(url)frame.go(canonical(url,frame.url));return null};e.window.document.addEventListener('click',event=>{const a=event.target.closest?.('a[target]');if(a&&a.target!=='_self'&&a.href){event.preventDefault();frame.go(canonical(a.getAttribute('href'),frame.url))}},true)}catch{}
 });
 frame.frame.addEventListener('load',()=>{let title='',url='';try{title=frame.frame.contentDocument.title}catch{}try{url=frame.url.href}catch{try{url=controller.decodeUrl(frame.frame.contentWindow.location.href)}catch{}}try{post({type:'loaded',title,url:canonical(url)})}catch{}});
 document.body.append(frame.frame);status.textContent='';
}
if(parent===window){status.innerHTML='<p>This is the isolated browser engine. Open the browser inside Atelier to use it.</p><p><a href="/source.zip">Source code and licenses</a></p>'}else post({type:'hello'});
