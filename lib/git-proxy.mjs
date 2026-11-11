// A narrow, authenticated smart-HTTP transport, not a general-purpose URL proxy.
export async function gitProxy(request,fetchRemote=fetch){
 const error=(message,status)=>new Response(message,{status,headers:{'Cache-Control':'no-store'}});
 if(!request.headers.get('x-atelier-user-id'))return error('Sign in to use Git.',401);
 const here=new URL(request.url),origin=request.headers.get('origin');
 if(origin&&origin!==here.origin)return error('Invalid origin.',403);
 let url;try{url=new URL(here.searchParams.get('url'))}catch{return error('Invalid repository URL.',400)}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!['github.com','gitlab.com','bitbucket.org'].includes(url.hostname))return error('Unsupported Git host.',403);
 const discovery=request.method==='GET'&&/^\/(?:[\w.-]+\/)+[\w.-]+\/info\/refs$/.test(url.pathname)&&['git-upload-pack','git-receive-pack'].includes(url.searchParams.get('service'));
 const rpc=request.method==='POST'&&/^\/(?:[\w.-]+\/)+[\w.-]+\/git-(upload|receive)-pack$/.test(url.pathname)&&!url.search;
 if(!discovery&&!rpc)return error('Only Git smart-HTTP endpoints are supported.',400);
 const headers=new Headers({'User-Agent':'Atelier-Git/1.0'});
 for(const name of ['accept','content-type','git-protocol']){const value=request.headers.get(name);if(value)headers.set(name,value)}
 const authorization=request.headers.get('x-git-authorization');if(authorization){if(!/^Basic [A-Za-z0-9+/=]+$/.test(authorization))return error('Invalid Git credentials.',400);headers.set('authorization',authorization)}
 if(Number(request.headers.get('content-length'))>32*1024*1024)return error('Git upload exceeds 32 MB.',413);
 const body=rpc?await request.arrayBuffer():undefined;if(body?.byteLength>32*1024*1024)return error('Git upload exceeds 32 MB.',413);
 try{
  const remote=await fetchRemote(url.href,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(110000)});
  if(remote.status>=300&&remote.status<400)return error('Repository redirected. Use its canonical HTTPS clone URL.',400);
  const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});for(const name of ['content-type','www-authenticate']){const value=remote.headers.get(name);if(value)responseHeaders.set(name,value)}
  return new Response(remote.body,{status:remote.status,headers:responseHeaders});
 }catch{return error('Could not reach the Git server. Try again.',502)}
}
