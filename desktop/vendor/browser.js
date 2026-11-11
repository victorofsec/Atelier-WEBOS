import createDOMPurify from 'dompurify';
const purifiers=new WeakMap();
export function safePageURL(value,base){try{if(typeof value!=='string'||!value.trim())return null;const u=new URL(value,base);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
export function preparePage(html,base,win=window){
 let purifier=purifiers.get(win);if(!purifier){purifier=createDOMPurify(win);purifiers.set(win,purifier)}
 const source=new win.DOMParser().parseFromString(html,'text/html');
 const title=source.title||source.querySelector('h1')?.textContent||new URL(base).hostname;
 const fragment=purifier.sanitize(source.body.innerHTML,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['a','p','div','span','article','section','main','header','footer','nav','aside','h1','h2','h3','h4','h5','h6','br','hr','ul','ol','li','dl','dt','dd','strong','b','em','i','u','s','small','sub','sup','blockquote','pre','code','table','thead','tbody','tfoot','tr','th','td','caption','figure','figcaption','img','details','summary','abbr','time'],ALLOWED_ATTR:['href','src','alt','title','id','colspan','rowspan','open','datetime','start'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 for(const link of fragment.querySelectorAll('a')){const raw=link.getAttribute('href');if(raw?.startsWith('#'))link.setAttribute('href',raw);else{const url=safePageURL(raw,base);if(url)link.setAttribute('href',url);else link.removeAttribute('href')}link.draggable=false}
 for(const img of fragment.querySelectorAll('img')){const raw=img.getAttribute('src')||'',url=safePageURL(raw,base);if(url){img.src=url;img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.loading='lazy'}else if(/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(raw))img.src=raw;else img.remove()}
 return {fragment,title:title.trim().slice(0,180),scriptsRemoved:!!source.querySelector('script'),formsRemoved:!!source.querySelector('form')};
}
export async function fetchPageText(url,signal,fetcher=fetch){
 const response=await fetcher(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal});
 if(!response.ok)throw new Error('The site returned HTTP '+response.status+'.');
 if(response.type==='opaque')throw new Error('This site does not allow direct access.');
 const type=response.headers.get('content-type')||'';
 if(type&&!/text\/|application\/(json|xhtml\+xml)/i.test(type))throw new Error('This address is not an HTML or text page.');
 const limit=4*1024*1024;if(Number(response.headers.get('content-length'))>limit)throw new Error('This page exceeds the 4 MB reading limit.');
 let text='';if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('This page exceeds the 4 MB reading limit.')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}finally{reader.releaseLock()}}else{text=await response.text();if(text.length>limit)throw new Error('This page exceeds the 4 MB reading limit.')}
 return {text,url:response.url||url,type};
}
