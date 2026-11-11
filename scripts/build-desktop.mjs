import fs from 'node:fs/promises';
const core=await fs.readFile('desktop/core.js','utf8'),upgrade=await fs.readFile('desktop/upgrade.js','utf8');
await fs.writeFile('public/app.js',core+'\n'+await fs.readFile('desktop/cloud.js','utf8')+'\n'+upgrade+'\n'+await fs.readFile('desktop/terminal.js','utf8')+'\n'+await fs.readFile('desktop/python.js','utf8')+'\n'+await fs.readFile('desktop/browser.js','utf8')+'\n'+await fs.readFile('desktop/browser-proxy.js','utf8')+'\n'+await fs.readFile('desktop/shell-polish.js','utf8')+'\nboot();\n');
const {build}=await import('esbuild');
await build({entryPoints:['pdf','docx','ppt','paint','zip','git','browser'].map(n=>'desktop/vendor/'+n+'.js'),bundle:true,inject:['desktop/vendor/buffer-shim.js'],splitting:true,format:'esm',outdir:'public/vendor',minify:true,target:'es2022',legalComments:'linked'});
await fs.copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/vendor/pdf.worker.min.mjs');
for(const path of ['cmaps','standard_fonts','wasm'])await fs.cp('node_modules/pdfjs-dist/'+path,'public/vendor/'+path,{recursive:true});
let notices=await fs.readFile('THIRD-PARTY-LICENSE.txt','utf8');
for(const name of ['pdfjs-dist','docx-preview','jszip','@web-ppt/core','fabric','isomorphic-git','@isomorphic-git/lightning-fs','pyodide','buffer','dompurify']){
 const base='node_modules/'+name,entries=await fs.readdir(base);const license=entries.find(n=>/^licen[sc]e/i.test(n));if(license)notices+='\n\n'+name+'\n'+await fs.readFile(base+'/'+license,'utf8');
}
await fs.writeFile('public/OPEN-SOURCE-LICENSES.txt',notices);

await fs.mkdir('public/vendor/python',{recursive:true});
for(const name of ['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'])await fs.copyFile('node_modules/pyodide/'+name,'public/vendor/python/'+name);
