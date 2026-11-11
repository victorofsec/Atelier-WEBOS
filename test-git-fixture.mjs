import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
export async function gitFixture(){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'atelier-smart-git-')),bare=path.join(root,'remote.git'),seed=path.join(root,'seed'),dir=path.join(root,'workspace');
 const command=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 command('init','--bare','--initial-branch=main',bare);command('-C',bare,'config','http.receivepack','true');await fsp.mkdir(seed);await fsp.mkdir(dir);command('init','--initial-branch=main',seed);command('-C',seed,'config','user.name','Fixture');command('-C',seed,'config','user.email','fixture@example.invalid');await fsp.writeFile(path.join(seed,'hello.txt'),'Original\n');command('-C',seed,'add','.');command('-C',seed,'commit','-m','Initial fixture');command('-C',seed,'push',bare,'main');
 const server=createServer((req,res)=>{const url=new URL(req.url,'http://local');const child=spawn('git',['http-backend'],{cwd:root,env:{...process.env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:req.method,CONTENT_TYPE:req.headers['content-type']||'',CONTENT_LENGTH:req.headers['content-length']||'',REMOTE_USER:'fixture'}});const chunks=[];child.stdout.on('data',d=>chunks.push(d));child.stderr.resume();req.pipe(child.stdin);child.on('close',()=>{const buffer=Buffer.concat(chunks);let index=buffer.indexOf('\r\n\r\n'),skip=4;if(index<0){index=buffer.indexOf('\n\n');skip=2}if(index<0){res.writeHead(502);res.end(buffer);return}for(const line of buffer.subarray(0,index).toString().split(/\r?\n/)){const colon=line.indexOf(':');if(colon<0)continue;const name=line.slice(0,colon),value=line.slice(colon+1).trim();if(name.toLowerCase()==='status')res.statusCode=parseInt(value);else res.setHeader(name,value)}res.end(buffer.subarray(index+skip))})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {env:{git,fs,pfs:fsp,dir},request:options=>http.request({...options,url:'http://127.0.0.1:'+server.address().port+new URL(options.url).pathname.replace(/^\/fixture/,'')+new URL(options.url).search}),head:()=>command('-C',bare,'rev-parse','main'),close:()=>new Promise(resolve=>server.close(resolve))};
}
