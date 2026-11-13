// Never render upstream diagnostic templates, proxy addresses or stack traces.
globalThis.AtelierFailure={async sanitize(response){
 if(response.status!==500||!response.headers.get('content-type')?.includes('text/html'))return response;
 const text=await response.clone().text();
 if(!text.includes('id="errorTrace"')||!text.includes('id="fetchedURL"'))return response;
 const contains=value=>text.includes(value)||text.includes(encodeURIComponent(value));
 const message=contains('Sign in to Atelier')?'Sign in to Atelier before opening websites.':contains('Browser connection unavailable')?'The browser connection is unavailable. Close this window and reopen Browser.':contains('too long')?'This website took too long to respond. Try again in a moment.':'The website could not be loaded through Atelier. Retry, or try another website.';
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page unavailable</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#f5f5f7,#27272b);color:light-dark(#25252a,#eee);font:15px system-ui;text-align:center}main{max-width:460px;padding:32px}h1{font-size:25px}p{line-height:1.6;opacity:.75}button{border:0;border-radius:10px;background:#287bd3;color:white;padding:12px 24px;font:inherit;cursor:pointer}</style><main><h1>Page unavailable</h1><p>${message}</p><button onclick="location.reload()">Try again</button></main></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}};
