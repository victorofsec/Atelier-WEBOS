// The prompt in the transcript is the exact prompt submitted by the user.
function terminalPrompt(s){return 'guest@atelier '+folderPath(s.cwd)+' %'}
renderTerminal=function(w){
 const s=w.state;s.cwd??='documents';s.lines??=['Atelier Shell 3.0','Type help for commands. Type apps to list applications.'];s.commands??=[];
 w.body.innerHTML='<div class="terminal"><div class="terminal-output" role="log" aria-live="polite"></div><form class="terminal-prompt"><label for="command-'+w.id+'"></label><input id="command-'+w.id+'" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Terminal command"></form></div>';
 q(w,'.terminal-output').innerHTML=s.lines.map(line=>typeof line==='string'?'<div class="terminal-line">'+esc(line)+'</div>':'<div class="terminal-line"><span class="shell-prompt">'+esc(line.prompt)+'</span> '+esc(line.command)+'</div>').join('');
 q(w,'label').textContent=terminalPrompt(s);const input=q(w,'input');input.disabled=!!s.busy;q(w,'form').hidden=!!s.busy;
 q(w,'form').onsubmit=e=>{e.preventDefault();runCommand(w,input.value)};
 input.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();if(s.historyIndex===undefined||s.historyIndex===s.commands.length)s.draft=input.value;s.historyIndex=Math.max(0,Math.min(s.commands.length,(s.historyIndex??s.commands.length)+(e.key==='ArrowUp'?-1:1)));input.value=s.historyIndex===s.commands.length?s.draft||'':s.commands[s.historyIndex];input.setSelectionRange(input.value.length,input.value.length)}if(e.ctrlKey&&e.key.toLowerCase()==='l'){e.preventDefault();s.lines=[];render(w)}if(e.ctrlKey&&e.key.toLowerCase()==='c'){e.preventDefault();input.value=''}};
 const terminal=q(w,'.terminal');terminal.onclick=e=>{if(!window.getSelection()?.toString()&&!e.target.closest('a,button'))input.focus()};terminal.scrollTop=terminal.scrollHeight;if(activeWindow===w&&!s.busy)input.focus();
};renderers.terminal=renderTerminal;
const basicShellCommand=runCommand;
function shellApp(name){const n=name.toLowerCase().replace(/\.app$/,'');return Object.keys(appNames).find(id=>id===n||appNames[id].toLowerCase()===n)||({code:'editor',safari:'browser',finder:'files',calc:'calculator',appstore:'store'})[n]}
function shellRecord(w,line){const s=w.state;s.commands.push(line);s.historyIndex=s.commands.length;s.draft='';s.lines.push({prompt:terminalPrompt(s),command:line})}
function shellPrint(w,text){if(text)w.state.lines.push(String(text));if(windows.has(w.id))render(w)}
runCommand=function(w,line){
 const s=w.state;if(s.busy)return;const [cmd,...args]=tokenize(line.trim());
 if(cmd==='git'){shellRecord(w,line);s.busy=true;render(w);return queueGit(()=>terminalGit(w,args)).then(text=>shellPrint(w,text)).catch(e=>shellPrint(w,'git: '+e.message)).finally(()=>{s.busy=false;if(windows.has(w.id))render(w)})}
 if(cmd==='help'){shellRecord(w,line);return shellPrint(w,'Files: ls, cd, pwd, cat, mkdir, touch, mv, rm, echo text > file\nApps: apps, open -a "App Name", open <file>, or type an app name\nPython: python, python3, python script.py, python -c "code"\nShell: clear, date, whoami, history, exit; ↑/↓ history, Ctrl+L clear\nGit: init, clone, status, add, commit, log, branch, checkout, switch,\n     config, remote, fetch, pull, push, auth, help\nQuote names with spaces. Files live in your Atelier desktop.')}
 if(cmd==='apps'||cmd==='whoami'||cmd==='history'||cmd==='exit'){shellRecord(w,line);if(cmd==='exit')return closeWindow(w);return shellPrint(w,cmd==='apps'?Object.entries(appNames).map(([id,name])=>id+' — '+name+(installed(id)?'':' (install from App Store)')).join('\n'):cmd==='whoami'?'guest':s.commands.map((c,i)=>(i+1)+'  '+c).join('\n'))}
 const app=cmd==='open'&&args[0]==='-a'?shellApp(args.slice(1).join(' ')):shellApp(cmd||'');
 if(app){shellRecord(w,line);render(w);openApp(app,true);return}
 if(cmd==='echo'&&(args.includes('>')||args.includes('>>'))){shellRecord(w,line);const index=args.findIndex(a=>a==='>'||a==='>>'),name=args[index+1];if(!name||args.length!==index+2||name.includes('/'))return shellPrint(w,'Usage: echo "text" > filename');let f=files.find(f=>f.parent===s.cwd&&f.name===name&&visible(f));if(f?.type==='folder')return shellPrint(w,'Is a directory.');if(!f){f={id:uid(),parent:s.cwd,name,type:'text',content:''};files.push(f)}f.content=(args[index]==='>>'?f.content||'':'')+args.slice(0,index).join(' ')+'\n';f.modified=Date.now();refreshFiles();render(w);return}
 return basicShellCommand(w,line);
};

// Serialize Git mutations across terminal windows. The Git app shares this repository.
let gitQueue=Promise.resolve();
function queueGit(fn){const next=gitQueue.then(fn,fn);gitQueue=next.catch(()=>{});return next}
let gitAuth=null;
const gitHttp={async request({url,method='GET',headers={},body}){
 const chunks=[];if(body)for await(const chunk of body)chunks.push(chunk);
 const requestHeaders=new Headers();for(const [key,value]of Object.entries(headers))if(['content-type','accept','git-protocol'].includes(key.toLowerCase()))requestHeaders.set(key,value);
 if(headers.authorization||headers.Authorization)requestHeaders.set('X-Git-Authorization',headers.authorization||headers.Authorization);
 const response=await fetch('/api/git?url='+encodeURIComponent(url),{method,headers:requestHeaders,body:method==='GET'?undefined:new Blob(chunks),signal:AbortSignal.timeout(120000)});
 if(!response.ok&&![401,403].includes(response.status))throw new Error('Remote returned '+response.status+': '+(await response.text()).slice(0,200));
 return {url,method,statusCode:response.status,statusMessage:response.statusText,headers:Object.fromEntries(response.headers),body:(async function*(){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;yield value}}finally{reader.releaseLock()}})()};
}};
function validateGitURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!['github.com','gitlab.com','bitbucket.org'].includes(url.hostname))throw new Error('Use a credential-free HTTPS repository URL on github.com, gitlab.com or bitbucket.org.');return url.href.replace(/\/$/,'')}
async function gitAuthFor(w,url){const host=new URL(url).hostname;if(gitAuth?.host===host)return {username:gitAuth.username,password:gitAuth.token};const username=await ask('Git username','','Account name for '+host,false,'text',w);if(!username)throw new Error('Authentication cancelled.');const token=await ask('Git access token','','Token for '+host+'. Kept in memory until reload; never saved to the cloud.',false,'password',w);if(!token)throw new Error('Authentication cancelled.');gitAuth={host,username,token};return {username,password:token}}
async function syncFilesToGit(env){
 const root=env.rootId||prefs.gitRootId;if(!root)return;const paths=new Set();
 async function walk(parent,path){for(const f of files.filter(f=>f.parent===parent&&visible(f))){if(f.name==='.git'||/[\\/]/.test(f.name)||f.name==='.'||f.name==='..')continue;const full=path+'/'+f.name;paths.add(full);if(f.type==='folder'){try{await env.pfs.mkdir(full)}catch{}await walk(f.id,full)}else{let data=f.content||'';if(/^(data:|assets\/|\/api\/blob\/|blob:)/.test(data))data=new Uint8Array(await (await fetch(data)).arrayBuffer());await env.pfs.writeFile(full,data,typeof data==='string'?'utf8':undefined)}}}
 await walk(root,env.dir);
 async function clean(path){for(const name of await env.pfs.readdir(path)){if(name==='.git')continue;const full=path+'/'+name,stat=await env.pfs.stat(full);if(stat.isDirectory()){await clean(full);if(!paths.has(full))await env.pfs.rmdir(full)}else if(!paths.has(full))await env.pfs.unlink(full)}}await clean(env.dir);
}
async function syncGitToFiles(env){
 const root=env.rootId||prefs.gitRootId;if(!root)return;const seen=new Set();
 async function walk(path,parent){for(const name of await env.pfs.readdir(path)){if(name==='.git')continue;const full=path+'/'+name,stat=await env.pfs.stat(full);let f=files.find(f=>f.parent===parent&&f.name===name&&visible(f));if(!f){f={id:uid(),parent,name};files.push(f)}seen.add(f.id);f.modified=Date.now();f.type=stat.isDirectory()?'folder':'text';if(stat.isDirectory())await walk(full,f.id);else{const bytes=await env.pfs.readFile(full);try{f.content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(f.content.includes('\0'))throw Error()}catch{let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));f.content='data:application/octet-stream;base64,'+btoa(binary);f.type='binary'}}}}
 await walk(env.dir,root);const children=new Set();function collect(parent){for(const f of files.filter(f=>f.parent===parent)){children.add(f.id);if(f.type==='folder')collect(f.id)}}collect(root);files=files.filter(f=>!children.has(f.id)||seen.has(f.id));refreshFiles();
}
async function terminalGit(w,args){
 const [command,...rest]=args;if(!command||command==='help')return 'Git commands\n  git init [-b main]           initialize in the current folder\n  git clone <https-url> [name] clone into a new folder\n  git status | add . | add <file> | commit -m "message"\n  git log [--oneline] | branch [name] | checkout <branch>\n  git switch [-c] <branch> | config user.name "Your Name"\n  git config user.email "you@example.com"\n  git remote -v | remote add origin <https-url>\n  git fetch | pull | push [-u] [origin] [branch]\n  git auth logout             forget the session access token\nRepositories are independent and selected from the current folder.\nHTTPS remotes: GitHub, GitLab, Bitbucket. SSH and Git LFS are not supported.';
 if(command==='auth'){if(rest[0]!=='logout')throw new Error('Use git auth logout. Authentication is requested when a remote requires it.');gitAuth=null;return 'Git credentials removed from this session.'}
 // Migrate the old shared workspace without discarding its files or Git history.
 if(!prefs.gitRootId&&Object.keys(prefs.gitSnapshot||{}).length)await gitEnvironment();
 prefs.gitRepositories??={};if(prefs.gitRootId&&!prefs.gitRepositories[prefs.gitRootId])prefs.gitRepositories[prefs.gitRootId]={snapshot:prefs.gitSnapshot||{}};
 let root=w.state.cwd;while(root&&!prefs.gitRepositories[root])root=files.find(f=>f.id===root)?.parent;
 if(command==='clone'){
  const url=validateGitURL(rest[0]),name=rest[1]||new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.git$/,'');
  if(!name||/[\\/]/.test(name)||name==='.'||name==='..'||files.some(f=>f.parent===w.state.cwd&&f.name===name&&visible(f)))throw new Error('Destination already exists or is invalid. Choose a new folder name.');
  const folder={id:uid(),name,type:'folder',parent:w.state.cwd,modified:Date.now()};files.push(folder);
  const env=await gitEnvironment(folder.id);env.rootId=folder.id;const {git,fs,dir}=env;
  try{await git.clone({fs,dir,http:gitHttp,url,singleBranch:true,onAuth:url=>gitAuthFor(w,url),onAuthFailure:()=>{gitAuth=null;throw new Error('Credentials rejected. Check the token permissions.')}});await syncGitToFiles(env);await saveGit(env)}catch(e){files=files.filter(f=>f.id!==folder.id&&f.parent!==folder.id);delete prefs.gitRepositories[folder.id];gitWorkspace?.delete?.(folder.id);throw e}
  prefs.gitRootId=folder.id;await save();return 'Cloned into '+name+'. Use cd '+name+' to enter the repository.';
 }
 if(command==='init')root=w.state.cwd;
 if(!root||root==='root')throw new Error('Not a Git repository. Run git init in a project folder or git clone <https-url>.');
 const env=await gitEnvironment(root);env.rootId=root;const {git,fs,dir}=env;prefs.gitRootId=root;
 if(command==='init'){await git.init({fs,dir,defaultBranch:rest[0]==='-b'?rest[1]:'main'});await syncFilesToGit(env);await saveGit(env);return 'Initialized Git repository in '+folderPath(root)}
 let current=w.state.cwd;const relative=[];while(current&&current!==root){const folder=files.find(f=>f.id===current);if(folder)relative.unshift(folder.name);current=folder?.parent;}if(current!==root)throw new Error('Not inside the repository. Use cd to enter '+folderPath(root)+'.');
 await syncFilesToGit(env);let result='';const options={fs,dir};const branch=await git.currentBranch({...options,fullname:false});
 if(command==='status'){const matrix=await git.statusMatrix(options);result='On branch '+(branch||'(detached)')+'\n'+(matrix.filter(([,h,work,stage])=>h!==work||work!==stage).map(([name,h,work,stage])=>(stage!==h?'staged ':work!==h?'modified ':'')+(work===0?'deleted ':h===0?'new ':'')+name).join('\n')||'Working tree clean.')}
 else if(command==='add'){if(!rest.length)throw new Error('Usage: git add . | git add <file>');const selected=rest.map(p=>{if(p==='-A')return '';const parts=[...relative];for(const piece of p.split('/')){if(piece==='..'){if(!parts.length)throw new Error('Path outside the repository.');parts.pop()}else if(piece&&piece!=='.')parts.push(piece)}return parts.join('/')});for(const [filepath,,work]of await git.statusMatrix(options)){if(!selected.some(p=>!p||filepath===p||filepath.startsWith(p+'/')))continue;if(work)await git.add({...options,filepath});else await git.remove({...options,filepath})}result='Changes staged.'}
 else if(command==='commit'){const matrix=await git.statusMatrix(options);if(!matrix.some(([,head,,stage])=>head!==stage))throw new Error('Nothing staged to commit. Use git add first.');const index=rest.indexOf('-m');if(index<0||!rest[index+1])throw new Error('Usage: git commit -m "message"');const name=await git.getConfig({...options,path:'user.name'})||prefs.name,email=await git.getConfig({...options,path:'user.email'})||cloud.user?.email;if(!email)throw new Error('Set your identity with git config user.email "you@example.com".');const oid=await git.commit({...options,message:rest[index+1],author:{name,email}});result='['+(branch||'HEAD')+' '+oid.slice(0,7)+'] '+rest[index+1]}
 else if(command==='log'){result=(await git.log({...options,depth:30})).map(c=>rest.includes('--oneline')?c.oid.slice(0,7)+' '+c.commit.message.trim():'commit '+c.oid+'\nAuthor: '+c.commit.author.name+' <'+c.commit.author.email+'>\n\n    '+c.commit.message.trim()).join('\n')}
 else if(command==='config'){const [path,...value]=rest;if(!['user.name','user.email'].includes(path))throw new Error('Supported keys: user.name, user.email. Use git remote for remote URLs.');if(value.length){await git.setConfig({...options,path,value:value.join(' ')});result='Identity updated.'}else result=await git.getConfig({...options,path})||'(not set)'}
 else if(command==='remote'){if(rest[0]==='add'){if(!rest[1]||!rest[2])throw new Error('Usage: git remote add origin <https-url>');await git.addRemote({...options,remote:rest[1],url:validateGitURL(rest[2])});result='Remote added.'}else if(rest[0]==='remove'){await git.deleteRemote({...options,remote:rest[1]});result='Remote removed.'}else if(!rest.length||rest[0]==='-v')result=(await git.listRemotes(options)).map(r=>r.remote+'\t'+r.url).join('\n')||'No remotes.';else throw new Error('Use git remote -v, add or remove.')}
 else if(command==='branch'){if(rest[0]){await git.branch({...options,ref:rest[0]});result='Created branch '+rest[0]}else result=(await git.listBranches(options)).map(b=>(b===branch?'* ':'  ')+b).join('\n')}
 else if(command==='checkout'||command==='switch'){const create=['-b','-c'].includes(rest[0]),ref=rest[create?1:0];if(!ref)throw new Error('Specify a branch.');if(create)await git.branch({...options,ref});await git.checkout({...options,ref});await syncGitToFiles(env);result='Switched to '+ref}
 else if(['fetch','pull','push'].includes(command)){const positionals=rest.filter(x=>x!=='-u'),remote=positionals[0]||'origin',ref=positionals[1]||branch;if(positionals.some(x=>x.startsWith('-')))throw new Error('Unsupported option. Use git '+command+' [origin] [branch].');const remotes=await git.listRemotes(options),target=remotes.find(r=>r.remote===remote);if(!target)throw new Error('Add a remote with git remote add '+remote+' <https-url>.');validateGitURL(target.url);const network={...options,http:gitHttp,remote,ref,onAuth:url=>gitAuthFor(w,url),onAuthFailure:()=>{gitAuth=null;throw new Error('Credentials rejected. Check your token and repository permissions.')}};if(command==='pull'){await git.pull({...network,singleBranch:true,fastForwardOnly:true,author:{name:prefs.name,email:cloud.user?.email||'local@atelier.invalid'}});await syncGitToFiles(env)}else if(command==='push'){await git.push(network);if(rest.includes('-u')){await git.setConfig({...options,path:'branch.'+ref+'.remote',value:remote});await git.setConfig({...options,path:'branch.'+ref+'.merge',value:'refs/heads/'+ref})}}else await git.fetch(network);result=command+' completed: '+remote+(ref?' / '+ref:'')}
 else throw new Error('Unsupported command: '+command+'. Type git help.');
 await saveGit(env);return result;
}
