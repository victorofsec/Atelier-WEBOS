// Normalize only our own proxy URLs, never arbitrary percent-encoded remote URLs.
globalThis.AtelierNavigation={canonical(value,engineOrigin,base){
 let url=new URL(String(value),base||engineOrigin);
 for(let depth=0;url.origin===engineOrigin&&url.pathname.startsWith('/browse/');depth++){
  if(depth>=16)throw Error('Invalid nested browser address.');
  const hash=url.hash?decodeURIComponent(url.hash.slice(1)):'';
  url=new URL(decodeURIComponent(url.pathname.slice('/browse/'.length)));
  if(hash)url.hash=hash;
 }
 if(!['https:','http:'].includes(url.protocol)||url.origin===engineOrigin||url.username||url.password)throw Error('Invalid website address.');
 return url.href;
}};
