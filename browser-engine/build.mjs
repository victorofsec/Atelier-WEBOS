import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const JSZip=require('jszip');
await fs.mkdir('dist',{recursive:true});
for(const name of ['index.html','runtime.mjs','transport.mjs','sw.js','navigation.js'])await fs.copyFile(name,'dist/'+name);
for(const [pkg,folder,names]of [['scramjet','scramjet',['scramjet.all.js','scramjet.sync.js','scramjet.wasm.wasm']],['bare-mux','baremux',['index.js','worker.js']]]){
 await fs.mkdir('dist/'+folder,{recursive:true});for(const name of names)await fs.copyFile('../node_modules/@mercuryworkshop/'+pkg+'/dist/'+name,'dist/'+folder+'/'+name);
}
const license=await fs.readFile('../node_modules/@mercuryworkshop/scramjet/LICENSE','utf8');
await fs.writeFile('dist/LICENSE.txt',license);
const zip=new JSZip();for(const name of ['index.html','runtime.mjs','transport.mjs','sw.js','navigation.js','build.mjs','README.md'])zip.file(name,await fs.readFile(name));
zip.file('LICENSE.txt',license);await fs.writeFile('dist/source.zip',await zip.generateAsync({type:'nodebuffer'}));
