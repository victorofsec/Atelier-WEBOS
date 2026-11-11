import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const workerURL=new URL('./public/python-worker.mjs',import.meta.url);
// Run the actual worker handler, with only its browser transport adapted to Node.
const packageCache=await (await import('node:fs/promises')).mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(),'atelier-python-packages-'));
const source=(await readFile(workerURL,'utf8')).replace("'./vendor/python/pyodide.mjs'",JSON.stringify(new URL('./public/vendor/python/pyodide.mjs',import.meta.url).href)).replace("new URL('./vendor/python/',import.meta.url).href",JSON.stringify(fileURLToPath(new URL('./public/vendor/python/',import.meta.url)))).replace("packageBaseUrl:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/',","packageCacheDir:"+JSON.stringify(packageCache)+",");
const worker=new Worker('const {parentPort}=require("node:worker_threads");globalThis.self=globalThis;globalThis.postMessage=data=>parentPort.postMessage(data);import('+JSON.stringify('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))+').then(()=>parentPort.on("message",data=>self.onmessage({data})));',{eval:true});
const run=data=>new Promise((resolve,reject)=>{const output=[];const timeout=setTimeout(()=>{worker.terminate();reject(Error('Python timed out'))},60000);const listener=message=>{if(message.type==='output')output.push(message.text);if(message.type==='done'){clearTimeout(timeout);worker.off('message',listener);worker.off('error',reject);resolve({...message,output})}};worker.on('message',listener);worker.once('error',reject);worker.postMessage(data)});
try{
 let r=await run({mode:'script',code:'import math, sys\nprint(math.factorial(10))\nprint(sys.argv[1])\nprint(input())\nopen("result.txt", "w").write("saved by Python")',argv:['test.py','argument'],stdin:'hello',files:[]});
 assert.ok(r.output.includes('3628800'),r.output.join('\n'));assert.ok(r.output.includes('argument'));assert.ok(r.output.includes('hello'));assert.equal(new TextDecoder().decode(r.changes.find(c=>c.path==='result.txt').bytes),'saved by Python');
 await run({mode:'start',files:[]});await run({mode:'repl',code:'answer = 21'});r=await run({mode:'repl',code:'answer * 2'});assert.ok(r.output.includes('42'));
 r=await run({mode:'repl',code:'for i in range(2):'});assert.equal(r.more,true);r=await run({mode:'repl',code:'    print(i)'});assert.equal(r.more,true);r=await run({mode:'repl',code:''});assert.deepEqual(r.output,['0','1']);
 r=await run({mode:'script',code:'raise ValueError("fixture error")',files:[]});assert.match(r.output.join('\n'),/fixture error/);

 r=await run({mode:'pip',pipArgs:['install','snowballstemmer==2.2.0']});assert.equal(r.failed,undefined,r.output.join('\n'));assert.ok(r.requirements.includes('snowballstemmer==2.2.0'));
 r=await run({mode:'script',code:'import snowballstemmer\nprint(snowballstemmer.stemmer("english").stemWord("running"))',files:[]});assert.ok(r.output.includes('run'),r.output.join('\n'));
 r=await run({mode:'pip',pipArgs:['freeze']});assert.match(r.output.join('\n'),/snowballstemmer==2.2.0/);
 r=await run({mode:'script',requirements:['snowballstemmer==2.2.0'],code:'import snowballstemmer; print(snowballstemmer.stemmer("english").stemWord("running"))',files:[]});assert.ok(r.output.includes('run'));
 console.log('PASS pip package installation, restoration, import and freeze');
 console.log('PASS actual Python runtime: standard library, argv, stdin, saved files, persistent REPL, multiline input and exceptions');
}finally{await worker.terminate()}
