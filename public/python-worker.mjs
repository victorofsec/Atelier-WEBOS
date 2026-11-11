import {loadPyodide} from './vendor/python/pyodide.mjs';
let runtime,consoleProxy,restoredPackages='';
const send=(type,data={})=>postMessage({type,...data});
const ready=()=>runtime??=loadPyodide({indexURL:new URL('./vendor/python/',import.meta.url).href,packageBaseUrl:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/',stdout:text=>send('output',{text}),stderr:text=>send('output',{text})});
function walk(FS,path='/workspace',result={}){for(const name of FS.readdir(path)){if(name==='.'||name==='..')continue;const full=path+'/'+name,stat=FS.stat(full);if(FS.isDir(stat.mode))walk(FS,full,result);else if(FS.isFile(stat.mode))result[full.slice(11)]=FS.readFile(full)}return result}
function same(a,b){return a?.length===b?.length&&a.every((v,i)=>v===b[i])}
self.onmessage=async({data})=>{
 let py,before;try{
  py=await ready();
  const wanted=JSON.stringify(data.requirements||[]);
  if((data.requirements?.length&&restoredPackages!==wanted)||data.mode==='pip'){
   await py.loadPackage('micropip');
   if(data.requirements?.length&&restoredPackages!==wanted){send('output',{text:'Restoring Python packages…'});py.globals.set('_atelier_requirements',py.toPy(data.requirements));await py.runPythonAsync('import micropip\nawait micropip.install(list(_atelier_requirements))');restoredPackages=wanted}
  }
  if(data.mode==='pip'){
   const [command,...args]=data.pipArgs||[];py.globals.set('_atelier_pip_args',py.toPy(args));
   if(command==='install'){
    if(!args.length||args.some(a=>a.startsWith('-')))throw Error('Usage: pip install package [package==version] or pip install -r requirements.txt');
    send('output',{text:'Installing '+args.join(', ')+'…'});
    await py.runPythonAsync('import micropip\nawait micropip.install(list(_atelier_pip_args))');
    const requirements=JSON.parse(py.runPython('import json\njson.dumps([str(name) + "==" + str(dist.version) for name, dist in micropip.list().items() if name not in ("micropip", "pyodide", "packaging")])'));
    restoredPackages=JSON.stringify(requirements);send('output',{text:'Successfully installed '+args.join(', ')});send('done',{requirements,changes:[]});return;
   }
   if(command==='list'||command==='freeze'){await py.runPythonAsync('import micropip\nprint("\\n".join(str(name) + "==" + str(dist.version) for name, dist in micropip.list().items()))')}
   else if(command==='show'){await py.runPythonAsync('from importlib.metadata import metadata, version\nfor name in _atelier_pip_args:\n print("Name: " + name + "\\nVersion: " + version(name) + "\\nSummary: " + metadata(name).get("Summary", ""))')}
   else throw Error('Supported commands: pip install, list, freeze, show. Native OS packages cannot run in this Python environment.');
   send('done',{changes:[]});return;
  }
  const FS=py.FS;FS.mkdirTree('/workspace');
  // Fresh script invocations see the latest desktop files; REPL keeps its workspace.
  if(data.files){const clean=path=>{for(const name of FS.readdir(path)){if(name==='.'||name==='..')continue;const full=path+'/'+name;if(FS.isDir(FS.lstat(full).mode)){clean(full);FS.rmdir(full)}else FS.unlink(full)}};clean('/workspace');for(const f of data.files){if(f.path.split('/').some(p=>!p||p==='.'||p==='..'))continue;const full='/workspace/'+f.path;FS.mkdirTree(full.slice(0,full.lastIndexOf('/')));FS.writeFile(full,new Uint8Array(f.bytes))}}
  FS.chdir('/workspace');before=walk(FS);const stdin=(data.stdin||'').split('\n');if(!data.stdin)stdin.length=0;py.setStdin({stdin:()=>stdin.shift(),isatty:false});
  if(data.mode==='start'){consoleProxy?.destroy();await py.runPythonAsync('import sys, code\n_atelier_console = code.InteractiveConsole({"__name__": "__main__"})');consoleProxy=py.globals.get('_atelier_console');send('output',{text:py.runPython('"Python " + sys.version.split()[0] + " — type exit() to return to the shell."')});send('done',{more:false,changes:[]});return}
  let more=false;
  if(data.mode==='repl')more=consoleProxy.push(data.code);
  else{py.globals.set('_atelier_source',data.code);const argv=py.toPy(data.argv||['-c']);py.globals.set('_atelier_argv',argv);argv.destroy();await py.runPythonAsync('import sys\nsys.argv = list(_atelier_argv)\nexec(compile(_atelier_source, sys.argv[0], "exec"), {"__name__": "__main__", "__file__": sys.argv[0]})')}
  const after=walk(FS),changes=[];for(const path of new Set([...Object.keys(before),...Object.keys(after)]))if(!same(before[path],after[path]))changes.push({path,bytes:after[path]||null});send('done',{more,changes});
 }catch(error){if(!py)runtime=null;send('output',{text:String(error.message||error)});const changes=[];if(py&&before){const after=walk(py.FS);for(const path of new Set([...Object.keys(before),...Object.keys(after)]))if(!same(before[path],after[path]))changes.push({path,bytes:after[path]||null})}send('done',{more:false,failed:true,changes})}
};
