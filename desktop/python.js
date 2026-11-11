function stopPython(w){w.state.pythonWorker?.terminate();w.state.pythonWorker=null;w.state.python=false;w.state.pythonMore=false;w.state.busy=false;w.state.pythonResolve?.();w.state.pythonResolve=null;if(windows.has(w.id)){shellPrint(w,'KeyboardInterrupt — Python session stopped.');render(w)}}
async function pythonFiles(parent,prefix='',out=[]){for(const f of files.filter(f=>f.parent===parent&&visible(f))){if(f.name.includes('/')||f.name==='.'||f.name==='..')continue;const path=prefix+f.name;if(f.type==='folder')await pythonFiles(f.id,path+'/',out);else out.push({path,bytes:await fileBytes(f),id:f.id,content:f.content})}return out}
function applyPythonChanges(w,changes){
 for(const change of changes){const parts=change.path.split('/');if(parts.some(p=>!p||p==='.'||p==='..'))continue;let parent=w.state.pythonRoot;for(const name of parts.slice(0,-1)){let folder=files.find(f=>f.parent===parent&&f.name===name&&visible(f)&&f.type==='folder');if(!folder){folder={id:uid(),parent,name,type:'folder',modified:Date.now()};files.push(folder)}parent=folder.id}const name=parts.at(-1);let f=files.find(f=>f.parent===parent&&f.name===name&&visible(f)),base=w.state.pythonBaseline?.find(x=>x.path===change.path);const concurrentlyChanged=f&&(!base||f.content!==base.content);
  if(change.bytes===null){if(f&&!concurrentlyChanged)f.deleted=true;continue}
  if(!f||concurrentlyChanged){f={id:uid(),parent,name:concurrentlyChanged?name+' (Python copy)':name};files.push(f)}
  try{f.content=new TextDecoder('utf-8',{fatal:true}).decode(change.bytes);if(f.content.includes('\0'))throw Error();f.type='text'}catch{let binary='';for(let i=0;i<change.bytes.length;i+=8192)binary+=String.fromCharCode(...change.bytes.subarray(i,i+8192));f.content='data:application/octet-stream;base64,'+btoa(binary);f.type='binary'}f.modified=Date.now();
 }if(changes.length)refreshFiles();
}
async function executePython(w,args,line){
 const s=w.state;
 if(!s.python&&['--help','-h'].includes(args[0]))return shellPrint(w,'python / python3          interactive Python console\npython script.py [args]   run a desktop file\npython -c "print(2 + 2)"   run Python code\npython script.py < input.txt   provide standard input\nexit() or Ctrl+D          leave the console\nCtrl+C / Stop            stop execution (resets the Python session)\nReal CPython via Pyodide, with its standard library.\nScripts read/write the current folder. No native processes or OS sockets.');
 if(s.python&&['exit()','quit()'].includes(line.trim())){s.python=false;s.pythonMore=false;render(w);return}
 s.busy=true;render(w);
 try{
  let code='',mode=s.python?'repl':'script',argv=['-c'],stdin='',pipArgs;
  if(!s.python&&args[0]==='-m'&&args[1]==='pip'){mode='pip';pipArgs=args.slice(2);if(pipArgs[0]==='install'&&pipArgs[1]==='-r'){const f=files.find(f=>f.id===resolveVirtual(pipArgs[2]||'',s.cwd));if(!f)throw Error('Requirements file not found.');pipArgs=['install',...new TextDecoder().decode(await fileBytes(f)).split(/\r?\n/).map(s=>s.replace(/\s+#.*$/,'').trim()).filter(s=>s&&!s.startsWith('#'))]}}
  if(mode==='pip'){}
  else if(s.python)code=line;
  else if(!args.length)mode='start';
  else if(['--version','-V'].includes(args[0]))code='import sys; print("Python " + sys.version.split()[0])';
  else{const inputIndex=args.indexOf('<');if(inputIndex>=0){const f=files.find(f=>f.id===resolveVirtual(args[inputIndex+1]||'',s.cwd));if(!f||f.type==='folder')throw Error('Standard input file not found.');stdin=new TextDecoder().decode(await fileBytes(f));args=args.slice(0,inputIndex)}if(args[0]==='-c'){if(args[1]===undefined)throw Error('Usage: python -c "code"');code=args[1];argv=['-c',...args.slice(2)]}else{const f=files.find(f=>f.id===resolveVirtual(args[0],s.cwd));if(!f||f.type==='folder')throw Error('Python file not found: '+args[0]);code=new TextDecoder().decode(await fileBytes(f));argv=[args[0],...args.slice(1)]}}
  const mounted=s.python?null:await pythonFiles(s.cwd);if(mounted){s.pythonRoot=s.cwd;s.pythonBaseline=mounted}
  if(!windows.has(w.id))return;
  if(!s.pythonWorker){shellPrint(w,'Loading Python…');s.pythonWorker=new Worker('python-worker.mjs',{type:'module'});w.cleanup=()=>{s.pythonWorker?.terminate();s.pythonResolve?.()}}
  await new Promise((resolve,reject)=>{s.pythonResolve=resolve;const worker=s.pythonWorker;worker.onerror=e=>{worker.terminate();s.pythonWorker=null;reject(Error(e.message||'Could not load Python.'))};worker.onmessage=async({data})=>{if(data.type==='output'){s.lines.push(data.text);if(s.lines.length>4000)s.lines=s.lines.slice(-3000);if(!s.pythonPaint)s.pythonPaint=setTimeout(()=>{s.pythonPaint=null;if(windows.has(w.id))render(w)},40)}if(data.type==='done'){if(data.requirements){prefs.pythonRequirements=data.requirements;save()}applyPythonChanges(w,data.changes||[]);s.python=(mode==='start'&&!data.failed)||mode==='repl';s.pythonMore=!!data.more;if(s.python)s.pythonBaseline=await pythonFiles(s.pythonRoot);resolve()}};worker.postMessage({mode,code,argv,stdin,pipArgs,requirements:prefs.pythonRequirements||[],files:mounted?.map(({path,bytes})=>({path,bytes}))})});
 }catch(e){shellPrint(w,'Python: '+e.message)}finally{s.pythonResolve=null;s.busy=false;if(windows.has(w.id))render(w)}
}
const beforePythonCommand=runCommand;
runCommand=function(w,line){if(w.state.busy)return;const [cmd,...args]=tokenize(line.trim());if(!w.state.python&&(cmd==='pip'||cmd==='pip3')){shellRecord(w,line);return executePython(w,['-m','pip',...args],line)}if(w.state.python||cmd==='python'||cmd==='python3'){shellRecord(w,line);return executePython(w,args,line)}return beforePythonCommand(w,line)};
const beforePythonPrompt=terminalPrompt;
terminalPrompt=function(s){return s.python?(s.pythonMore?'...':'>>>'):beforePythonPrompt(s)};
const beforePythonRenderer=renderTerminal;
renderTerminal=function(w){beforePythonRenderer(w);if(w.state.busy&&w.state.pythonWorker){const stop=document.createElement('button');stop.className='terminal-stop';stop.textContent='Stop Python · Ctrl+C';stop.onclick=()=>stopPython(w);q(w,'.terminal').append(stop);if(activeWindow===w)stop.focus()}w.body.onkeydown=e=>{if(e.ctrlKey&&e.key.toLowerCase()==='c'&&w.state.pythonWorker){e.preventDefault();stopPython(w)}if(e.ctrlKey&&e.key.toLowerCase()==='d'&&w.state.python&&!w.state.busy){e.preventDefault();w.state.python=false;w.state.pythonMore=false;render(w)}}};renderers.terminal=renderTerminal;
