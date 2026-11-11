importScripts('/scramjet/scramjet.all.js');
importScripts('/navigation.js');
const {ScramjetServiceWorker}=$scramjetLoadWorker();
const engine=new ScramjetServiceWorker();
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>event.respondWith((async()=>{
 if(event.request.url.startsWith(location.origin+'/browse/')){
  const target=AtelierNavigation.canonical(event.request.url,location.origin);
  const wrapped=new URL(decodeURIComponent(new URL(event.request.url).pathname.slice('/browse/'.length)));
  if(wrapped.origin===location.origin)return Response.redirect(location.origin+'/browse/'+encodeURIComponent(target),307);
 }
 await engine.loadConfig();
 if(engine.route(event))return engine.fetch(event);
 return fetch(event.request);
})()));
