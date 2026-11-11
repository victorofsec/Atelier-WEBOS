import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {calculate,moveItems,available,gridPosition,freeGridPosition,intersects,descendants,tokenize} from './public/model.js';
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
check('Decimal arithmetic',()=>assert.equal(calculate(.1,.2,'+'),'0.3'));
check('Division by zero',()=>assert.equal(calculate(7,0,'÷'),'Error'));
check('Quoted terminal arguments',()=>assert.deepEqual(tokenize('mv "my file.txt" Documents'),['mv','my file.txt','Documents']));
const fixture=()=>[{id:'desktop',type:'folder',name:'Desktop',parent:'root'},{id:'documents',type:'folder',name:'Documents',parent:'root'},{id:'a',type:'folder',name:'A',parent:'desktop'},{id:'b',type:'folder',name:'B',parent:'a'},{id:'c',type:'text',name:'note.txt',parent:'b'}];
check('Reject cycles without changing data',()=>{const f=fixture();assert.equal(moveItems(f,['a'],'b').ok,false);assert.equal(f[2].parent,'desktop')});
check('System folders stay in Home',()=>assert.equal(moveItems(fixture(),['desktop'],'documents').ok,false));
check('Child not moved twice with its parent',()=>{const f=fixture();assert.equal(moveItems(f,['a','c'],'documents').ok,true);assert.equal(f[4].parent,'b')});
check('Batch moves are atomic on name collisions',()=>{const f=fixture();f.push({id:'dup',name:'A',type:'text',parent:'documents'});assert.equal(moveItems(f,['c','a'],'documents').ok,false);assert.equal(f[4].parent,'b')});
check('Deleted ancestors hide descendants',()=>{const f=fixture();f[2].deleted=true;assert.equal(available(f,f[4]),false)});
check('Grid placement avoids occupied cells',()=>assert.deepEqual(freeGridPosition({col:0,row:0},new Set(['0:0']),3,4),{col:0,row:1}));
check('Rectangle selection detects overlap',()=>assert.equal(intersects({left:0,top:0,right:100,bottom:100},{left:50,top:50,right:110,bottom:120}),true));
const html=await fs.readFile(new URL('./public/desktop.html',import.meta.url),'utf8');
const errors=[];const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
const dom=new JSDOM(html,{url:'http://localhost:5173',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
const {window}=dom;const context=dom.getInternalVMContext();
window.indexedDB=indexedDB;window.structuredClone=structuredClone;window.matchMedia=()=>({matches:true});window.fetch=async()=>({json:async()=>JSON.parse(await fs.readFile(new URL('./public/assets/catalog.json',import.meta.url),'utf8'))});
window.Element.prototype.animate=function(){return {finished:Promise.resolve(),cancel(){}}};window.Element.prototype.setPointerCapture=function(){};
window.HTMLDialogElement.prototype.showModal=function(){this.open=true};window.HTMLDialogElement.prototype.close=function(value){this.returnValue=value;this.open=false;this.dispatchEvent(new window.Event('close'))};
window.Audio=class extends window.EventTarget{constructor(){super();this.paused=true;this.duration=30;this.currentTime=0;this.volume=.5}async play(){this.paused=false;this.dispatchEvent(new window.Event('play'))}pause(){this.paused=true;this.dispatchEvent(new window.Event('pause'))}};
const icons=(await fs.readFile(new URL('./public/icons.js',import.meta.url),'utf8')).replaceAll('export const','const');
const model=(await fs.readFile(new URL('./public/model.js',import.meta.url),'utf8')).replaceAll('export function','function');
const readerModule=await import('./desktop/vendor/browser.js');window.testReaderEngine={...readerModule,preparePage:(html,base)=>readerModule.preparePage(html,base,window),fetchPageText:(url,signal)=>readerModule.fetchPageText(url,signal,window.fetch)};
const source=(await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/boot\(\);\s*$/,'').replace("await import('./vendor/git.js')","await globalThis.testGitModuleLoader()").replace("import('./vendor/browser.js')","Promise.resolve(globalThis.testReaderEngine)");
vm.runInContext(icons+'\n'+model+'\nconst isAvailable=available;\n'+source,context);
const run=code=>vm.runInContext(code,context);
await run('boot()');
check('Startup ends on an empty desktop',()=>{assert.equal(run('windows.size'),0);assert.equal(window.document.querySelector('#boot-screen'),null);assert.equal(window.document.body.classList.contains('booting'),false)});
check('Desktop boots in English',()=>{assert.equal(window.document.documentElement.lang,'en');assert.equal(window.document.querySelector('#active-app').textContent,'Finder')});
check('Every application renders',()=>{run("Object.keys(renderers).filter(app=>!['paint','archive','git','documents'].includes(app)&&installed(app)).forEach(app=>openApp(app,true))");assert.equal(run('windows.size'),run("Object.keys(renderers).filter(app=>!['paint','archive','git','documents'].includes(app)&&installed(app)).length"));assert.equal(errors.length,0,errors.join('\n'))});
check('Finder windows keep independent folders',()=>{run("globalThis.a=openApp('files',true,{folder:'desktop'});globalThis.b=openApp('files',true,{folder:'documents'});");assert.equal(run('a.state.folder'),'desktop');assert.equal(run('b.state.folder'),'documents');run("q(a,'[data-folder=downloads]').click()");assert.equal(run('a.state.folder'),'downloads');assert.equal(run('b.state.folder'),'documents')});
check('Calculator renders all keys at its initial dimensions',()=>{run("globalThis.c=openApp('calculator',true);calc(c,'1');calc(c,'2');calc(c,'+');calc(c,'3');calc(c,'=')");assert.equal(run('c.state.value'),'15');assert.equal(run("qa(c,'.calc-grid button').length"),20);assert.equal(run('c.el.style.height'),'480px')});
check('Calculator instances keep independent results',()=>{run("globalThis.d=openApp('calculator',true)");assert.equal(run('d.state.value'),'0');assert.equal(run('c.state.value'),'15')});
check('Dock right click exposes real window actions',()=>{window.document.querySelector('[data-dock=files]').dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:200}));const text=window.document.querySelector('#context').textContent;assert.match(text,/New Window/);assert.match(text,/Quit Finder/)});
check('Dock new window creates a separate instance',()=>{const before=run('windows.size');[...window.document.querySelectorAll('#context button')].find(b=>b.textContent.includes('New Window')).click();assert.equal(run('windows.size'),before+1)});
check('Desktop-to-Finder drag is handled once',()=>{run("files.push({id:'drag-test',name:'Drag.txt',parent:'desktop',type:'text',content:'test',modified:Date.now()});refreshFiles();b.state.folder='documents';render(b)");const area=run("q(b,'.file-grid')");const event=new window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[],getData:()=>JSON.stringify({ids:['drag-test']})}});area.dispatchEvent(event);assert.equal(run("files.find(f=>f.id==='drag-test').parent"),'documents');assert.equal(run("files.filter(f=>f.id==='drag-test').length"),1)});
check('Multi-selection moves all selected items',()=>{run("files.push({id:'drag-two',name:'Two.txt',parent:'desktop',type:'text',content:'',modified:Date.now()});moveFiles(['drag-test','drag-two'],'downloads')");assert.equal(run("files.filter(f=>['drag-test','drag-two'].includes(f.id)&&f.parent==='downloads').length"),2)});
check('Restore preserves a folder hierarchy',()=>{run("trashItems(['inspiration']);files.find(f=>f.id==='inspiration').deleted=false;refreshFiles()");assert.equal(run("visible(files.find(f=>f.id==='inspiration'))"),true)});
check('Music catalog distinguishes official previews from supplied full tracks',()=>{assert.ok(run('catalog.length')>=10);assert.equal(run("catalog.every(t=>t.preview?t.src.includes('itunes.apple.com')&&t.url.includes('music.apple.com'):t.userProvided&&t.src==='assets/music/billie-jean.mp3')"),true)});
await run('playTrack(catalog[0],catalog)');
check('Music playback state synchronizes across windows',()=>{assert.equal(run('player.paused'),false);run('player.pause()');assert.equal(run('player.paused'),true)});
check('Terminal writes only to the virtual filesystem',()=>{run("globalThis.t=openApp('terminal',true);runCommand(t,'touch test-terminal.txt')");assert.equal(run("files.some(f=>f.name==='test-terminal.txt'&&f.parent==='documents')"),true)});
check('Photo edits persist in the shared model',()=>{run("globalThis.p=openApp('photos',true,{photo:'alpine',edit:true});q(p,'[data-action=rotate]').click()");assert.equal(run("files.find(f=>f.id==='alpine').edits.rotation"),90)});
check('Lock and unlock lifecycle',()=>{run('lock()');assert.equal(window.document.querySelector('#lock').classList.contains('hidden'),false);run('unlock()')});
await new Promise(resolve=>setTimeout(resolve,5));assert.equal(window.document.querySelector('#lock').classList.contains('hidden'),true);
await run('save()');

check('Marquee selects intersecting files only',()=>{
 run("b.state.folder='downloads';render(b)");const area=run("q(b,'.file-grid')"),cards=[...area.querySelectorAll('[data-file]')];
 cards.forEach((el,i)=>el.getBoundingClientRect=()=>({left:30+i*140,top:30,right:130+i*140,bottom:130}));
 const pointer=(type,x,y)=>new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 const down=pointer('pointerdown',10,10);Object.defineProperty(down,'target',{value:area});area.onpointerdown(down);area.dispatchEvent(pointer('pointermove',140,140));area.dispatchEvent(pointer('pointerup',140,140));
 assert.equal(run('b.selection.size'),1);assert.equal(cards[0].getAttribute('aria-selected'),'true');
});
check('Desktop selection stays in the desktop layer below the Dock',()=>{const area=window.document.querySelector('#desktop-files');const event=new window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:20,clientY:80});Object.defineProperty(event,'target',{value:area});area.onpointerdown(event);const box=window.document.querySelector('.desktop-selection');assert.equal(box.parentElement.id,'desktop');assert.equal(window.document.body.querySelector(':scope > .selection-box'),null);area.dispatchEvent(new window.MouseEvent('pointerup',{bubbles:true}));assert.equal(window.document.querySelector('.desktop-selection'),null)});
check('Desktop grid coordinates persist after re-render',()=>{
 const area=window.document.querySelector('#desktop-files');area.getBoundingClientRect=()=>({left:10,top:39,width:1200,height:650});
 run("files.push({id:'position-test',name:'Position.txt',type:'text',parent:'desktop',content:'',modified:Date.now()});assignDesktopPositions(['position-test'],{x:650,y:220});renderDesktop()");
 const before=JSON.stringify(run("files.find(f=>f.id==='position-test').position"));run('renderDesktop()');assert.equal(JSON.stringify(run("files.find(f=>f.id==='position-test').position")),before);
});
check('Closing one instance does not close its siblings',()=>{const other=run('b.id');run('closeWindow(a)');assert.equal(run('windows.has(b.id)'),true);assert.equal(run('windows.has(a.id)'),false)});


check('Dock retains image nodes across window changes',()=>{const image=window.document.querySelector('[data-dock=files] img');run("globalThis.stable=openApp('files',true);minimizeWindow(stable);focusWindow(stable);closeWindow(stable)");assert.equal(window.document.querySelector('[data-dock=files] img'),image)});
check('All eight resize handles replace the visible corner',()=>{assert.equal(run("c.el.querySelectorAll('[data-resize]').length"),8);assert.equal(run("c.el.querySelector('.resize')"),null)});
check('Dragging is allowed beyond both edges',()=>{assert.equal(run("windowGestureRect({left:100,top:100,width:600,height:400},-300,0,'',{width:1200,height:800}).left"),-200);assert.equal(run("windowGestureRect({left:100,top:100,width:600,height:400},3000,0,'',{width:1200,height:800}).left"),1104)});
check('Resizing preserves opposite edges and minimum size',()=>{for(const edge of ['n','ne','e','se','s','sw','w','nw']){const r=run("windowGestureRect({left:200,top:200,width:600,height:400},50,40,'"+edge+"',{width:1200,height:900},{width:300,height:200})");assert.ok(r.width>=300&&r.height>=200);if(edge.includes('w'))assert.equal(r.left+r.width,800);if(edge.includes('n'))assert.equal(r.top+r.height,600)}});
check('Desktop pointer deactivates windows',()=>{run('focusWindow(c)');const area=window.document.querySelector('#desktop-files');const e=new window.MouseEvent('pointerdown',{button:0,clientX:10,clientY:10,cancelable:true});Object.defineProperty(e,'target',{value:area});area.onpointerdown(e);area.dispatchEvent(new window.Event('pointerup'));assert.equal(run('activeWindow'),null);assert.equal(run('[...windows.values()].every(w=>w.el.classList.contains("inactive"))'),true)});
check('Lock accepts unfocused typing and reveals code',()=>{run("prefs.pin='1234';lock()");const input=window.document.querySelector('#unlock-pin');input.blur();for(const key of '1234')window.document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));assert.equal(input.value,'1234');window.document.querySelector('#unlock-eye').click();assert.equal(input.type,'text');window.document.querySelector('#unlock-eye').click();assert.equal(input.type,'password');window.document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))});
await new Promise(resolve=>setTimeout(resolve,5));check('Enter unlocks the correct code',()=>{assert.equal(window.document.querySelector('#lock').classList.contains('hidden'),true);run("prefs.pin=''")});
check('Independent lock wallpaper and sync toggle',()=>{run("globalThis.settingsTest=openApp('settings',true);q(settingsTest,'[data-same-wall]').click();qa(settingsTest,'[data-lockwall]')[1].click()");assert.equal(run('prefs.lockSameWallpaper'),false);assert.equal(run('prefs.lockWall'),'assets/coast.jpg');assert.notEqual(run('prefs.wall'),run('prefs.lockWall'));run("q(settingsTest,'[data-same-wall]').click()");assert.equal(run('prefs.lockSameWallpaper'),true);assert.equal(window.document.querySelector('#desktop').style.getPropertyValue('--lock-wall'),window.document.querySelector('#desktop').style.getPropertyValue('--wall'))});
check('Control Center controls real sound and appearance',()=>{window.document.querySelector('#control-btn').click();window.document.querySelector('.cc-mute').click();assert.equal(run('player.volume'),0);window.document.querySelector('.cc-mute').click();assert.ok(run('player.volume')>0);const theme=run('prefs.theme');window.document.querySelector('.cc-theme').click();assert.notEqual(run('prefs.theme'),theme);assert.equal(window.document.querySelectorAll('#control .cc-tile').length,2)});
run("globalThis.photoGridTest=openApp('photos',true)");const photoNode=run("q(photoGridTest,'.photo-card')");run('resizePhotoGrid(photoGridTest,230)');await new Promise(resolve=>setTimeout(resolve,35));
check('Photo resizing retains cards and applies the latest size',()=>{assert.equal(run("q(photoGridTest,'.photo-card')"),photoNode);assert.match(run("q(photoGridTest,'.photo-grid').style.gridTemplateColumns"),/230px/)});


check('File extensions select readers instead of Notes',()=>{run("files.push({id:'extension-test',name:'report.txt',type:'text',content:'Report',parent:'documents'});openFile(files.at(-1))");assert.equal(run('activeWindow.app'),'textedit');assert.equal(run("fileKind({name:'scan.pdf',type:'text'})"),'pdf');assert.equal(run("fileKind({name:'code.js',type:'text'})"),'code');assert.equal(run("fileKind({name:'portrait.png',type:'text'})"),'image')});
check('Sheets block only their owning window',()=>{run("globalThis.sheetPromise=ask('Rename','Report','','', 'text',c)");assert.equal(window.document.querySelector('#dialog').open,false);assert.ok(run("c.el.querySelector('.app-sheet')"));assert.equal(run('c.body.inert'),true);run('focusWindow(b)');assert.equal(run('activeWindow'),run('b'));run("c.el.querySelector('[data-cancel]').click()");assert.equal(run('c.body.inert'),false)});
const importList=[new window.File(['one'],'One.txt',{type:'text/plain'}),new window.File(['two'],'Two.txt',{type:'text/plain'})];window.testImports=importList;const importing=run("readImports(testImports,'documents')");importList.length=0;await importing;
check('Multiple imports survive picker reset',()=>{assert.ok(run("files.some(f=>f.name==='One.txt'&&f.content==='one')"));assert.ok(run("files.some(f=>f.name==='Two.txt'&&f.content==='two')"))});
check('Music progress fill follows the thumb',()=>{run("globalThis.musicTest=openApp('music',true);player.duration=100;player.currentTime=42;player.dispatchEvent(new Event('timeupdate'))");assert.equal(run("q(musicTest,'.music-seek').value"),'42');assert.equal(run("q(musicTest,'.music-seek').style.getPropertyValue('--range-progress')"),'42%')});
await run("playedHistory=[];forwardHistory=[];currentTrack=null;shuffle=false;playTrack(catalog[0],catalog)");await run('playTrack(catalog[1],catalog)');run('nextTrack(-1)');
check('Previous returns to the actual previous song',()=>assert.equal(run('currentTrack.id'),run('catalog[0].id')));run('nextTrack(1)');check('Next returns forward after previous',()=>assert.equal(run('currentTrack.id'),run('catalog[1].id')));
check('Daily and yearly calendar views render',()=>{run("globalThis.calTest=openApp('calendar',true);q(calTest,'[data-view=year]').click()");assert.equal(run("qa(calTest,'[data-month]').length"),12);run("q(calTest,'[data-view=day]').click()");assert.equal(run("qa(calTest,'[data-hour]').length"),24)});
check('Reminder time input exists',()=>{run("globalThis.remTest=openApp('reminders',true)");assert.ok(run("q(remTest,'input[type=time]')"))});
check('Browser has internal search and local HTML controls',()=>{run("globalThis.browserTest=openApp('browser',true)");assert.equal(run("q(browserTest,'iframe')"),null);assert.ok(run("q(browserTest,'[data-action=open-html]')"));assert.ok(run("q(browserTest,'.reader-search')"))});
check('Fullscreen restores the window and changes green control',()=>{run('zoomWindow(c)');assert.equal(run('c.maximized'),true);assert.equal(run("c.el.querySelector('.max').title"),'Restore');assert.equal(run('c.el.style.top'),'0px');run('zoomWindow(c)');assert.equal(run('c.maximized'),false)});
check('Browser fullscreen preserves bars; only maximized app windows hide them',()=>{Object.defineProperty(window.document,'fullscreenElement',{configurable:true,value:window.document.documentElement});run('focusWindow(c);syncImmersive()');assert.equal(window.document.body.classList.contains('immersive'),false);run('zoomWindow(c)');assert.equal(window.document.body.classList.contains('immersive'),true);run('zoomWindow(c)');assert.equal(window.document.body.classList.contains('immersive'),false);Object.defineProperty(window.document,'fullscreenElement',{configurable:true,value:null});run('syncImmersive()')});
check('Alt CapsLock displays and commits the switcher',()=>{window.document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key:'CapsLock',altKey:true,bubbles:true,cancelable:true}));assert.ok(window.document.querySelector('#app-switcher'));window.document.body.dispatchEvent(new window.KeyboardEvent('keyup',{key:'Alt',bubbles:true}));assert.equal(window.document.querySelector('#app-switcher'),null)});
check('Store installs a working editor',()=>{run("globalThis.storeTest=openApp('store',true);q(storeTest,'[data-install=editor]').click()");assert.equal(run("installed('editor')"),true);run("q(storeTest,'[data-install=editor]').click()");assert.equal(run('activeWindow.app'),'editor');assert.ok(run("q(activeWindow,'.code-editor')"))});
check('Task Manager exposes actual window termination',()=>{run("globalThis.taskTest=openApp('tasks',true)");assert.equal(run("qa(taskTest,'[data-end]').length"),run('windows.size'))});



let writes=0,remoteVersion=0;window.remoteRevision='new';
window.fetch=async(url,options)=>{if(url==='/api/state'){if(options?.method==='PUT'){const payload=JSON.parse(options.body);assert.equal(options.headers['If-Match'],undefined);if(payload.baseRevision!==window.remoteRevision)return {ok:false,status:409,json:async()=>({error:'revision_conflict'})};writes++;window.remoteSnapshot=payload.state;window.remoteRevision='"version-'+(++remoteVersion)+'"';return {ok:true,status:200,headers:{get:()=> 'W/'+window.remoteRevision},json:async()=>({saved:true,revision:window.remoteRevision})}}return {ok:true,status:200,headers:{get:()=> 'W/'+window.remoteRevision},json:async()=>({state:window.remoteSnapshot||null,revision:window.remoteRevision,user:{id:window.cloudTestUser||'account-a',email:'test@example.invalid'}})}}throw Error('Unexpected test request '+url)};
await run('loadCloud()');run('clearTimeout(cloud.timer)');
check('First cloud save succeeds despite rewritten HTTP ETags',()=>{assert.equal(run('cloud.user.id'),'account-a');assert.equal(run('cloud.dirty'),false);assert.equal(writes,1)});
const savedWrites=writes;await run('loadCloud()');
check('Reloading a saved desktop does not write or mark pending',()=>{assert.equal(writes,savedWrites);assert.equal(run('cloud.dirty'),false)});
run("globalThis.syncSettings=openApp('settings',true)");check('Settings has only cloud synchronization, no backup controls',()=>{assert.equal(run("q(syncSettings,'[data-action=backup],.restore-backup,[data-action=load-cloud]')"),null);assert.ok(run("q(syncSettings,'[data-sync-status]')"))});
run("files.push({id:'offline-note',name:'Offline.txt',type:'text',parent:'documents',content:'Pending local edit'})");await run('save()');run('clearTimeout(cloud.timer)');const pendingCache=await run("readLocalSession('session:account-a')");
check('Unsynced edits retain their base and pending state',()=>{assert.equal(pendingCache.pending,true);assert.ok(pendingCache.files.some(f=>f.id==='offline-note'));assert.equal(pendingCache.baseRevision,window.remoteRevision);assert.ok(pendingCache.baseState)});
window.remoteSnapshot=structuredClone(window.remoteSnapshot);window.remoteSnapshot.files.push({id:'other-device',name:'Remote.txt',type:'text',parent:'documents',content:'Remote edit'});window.remoteRevision='"other-device"';await run('flushCloud()');
check('Concurrent device changes are merged and saved automatically',()=>{assert.equal(run('cloud.dirty'),false);assert.ok(window.remoteSnapshot.files.some(f=>f.id==='offline-note'));assert.ok(window.remoteSnapshot.files.some(f=>f.id==='other-device'));assert.equal(run("q(syncSettings,'[data-sync-status]').textContent"),'Saved to your account')});
run("files.find(f=>f.id==='offline-note').content='Local conflict'");await run('save()');run('clearTimeout(cloud.timer)');window.remoteSnapshot.files.find(f=>f.id==='offline-note').content='Remote conflict';window.remoteRevision='"conflict"';await run('flushCloud()');
check('Two edits to one file keep both versions without a stuck conflict',()=>{assert.ok(window.remoteSnapshot.files.some(f=>f.content==='Local conflict'));assert.ok(window.remoteSnapshot.files.some(f=>f.content==='Remote conflict'));assert.equal(run('cloud.dirty'),false);assert.equal(run('cloud.conflict'),false)});
const legacyState=run('structuredClone({files,prefs})');await run("new Promise(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({files,prefs,owner:'account-a',pending:true,baseRevision:'W/\"new\"'},'session:account-a');tx.oncomplete=resolve})");window.remoteSnapshot=null;window.remoteRevision='new';await run('loadCloud()');
check('Previously blocked W/new caches recover automatically',()=>{assert.equal(run('cloud.dirty'),false);assert.ok(window.remoteSnapshot.files.some(f=>f.id==='offline-note'))});
window.cloudTestUser='account-b';window.remoteSnapshot=null;window.remoteRevision='new';await run('loadCloud()');run('clearTimeout(cloud.timer);cloud.ready=false;cloud.dirty=false');
check('Switching accounts does not copy another account files',()=>{assert.equal(run('cloud.user.id'),'account-b');assert.equal(run("files.some(f=>f.id==='offline-note')"),false)});

check('Terminal history preserves prompt, path, styling and command text',()=>{run("globalThis.shell=openApp('terminal',true);runCommand(shell,'echo hello')");assert.equal(run("q(shell,'.shell-prompt').textContent"),'guest@atelier Home / Documents %');assert.equal(run("q(shell,'label').textContent"),'guest@atelier Home / Documents %');assert.match(run("q(shell,'.terminal-output').textContent"),/echo hellohello/);run("runCommand(shell,'cd ..')");assert.equal(run("q(shell,'label').textContent"),'guest@atelier Home %');assert.equal(run("qa(shell,'.shell-prompt')[1].textContent"),'guest@atelier Home / Documents %')});
check('Terminal launches named apps and open -a',()=>{run("runCommand(shell,'calculator')");assert.equal(run('activeWindow.app'),'calculator');run('runCommand(shell,\'open -a "App Store"\')');assert.equal(run('activeWindow.app'),'store')});
check('Expanded Music player stays inside its existing window',()=>{run("globalThis.musicTest=openApp('music',true)");const rect=run('musicTest.el.style.cssText');run("q(musicTest,'[aria-label=\"Expand player\"]').click()");assert.equal(run('musicTest.state.theater'),true);assert.equal(run('musicTest.maximized'),false);assert.equal(run('musicTest.el.style.cssText'),rect);run("q(musicTest,'[data-action=library]').click()");assert.equal(run('musicTest.state.theater'),false);assert.equal(run('musicTest.el.style.cssText'),rect)});
run('globalThis.realGitEnvironment=gitEnvironment');
const {gitFixture}=await import('./test-git-fixture.mjs');const fixtureGit=await gitFixture();
window.testGitEnvironment=fixtureGit.env;const repositoryEnvs=new Map();window.makeGitEnvironment=async rootId=>{if(repositoryEnvs.has(rootId))return repositoryEnvs.get(rootId);const dir=fixtureGit.env.dir+'/'+rootId;await fixtureGit.env.pfs.mkdir(dir,{recursive:true});const env={...fixtureGit.env,dir,rootId};repositoryEnvs.set(rootId,env);return env};window.testGitRequest=fixtureGit.request;window.TextDecoder=TextDecoder;window.TextEncoder=TextEncoder;
try{
 run("gitEnvironment=makeGitEnvironment;gitHttp.request=testGitRequest;prefs.gitRootId=null;prefs.gitSnapshot={};prefs.gitRepositories={};shell.state.cwd='documents';cloud.ready=false");
 await run("runCommand(shell,'git clone https://github.com/fixture/remote.git FixtureRepo')");
 assert.match(run("shell.state.lines.at(-1)"),/Cloned into/);assert.equal(run('shell.state.cwd'),'documents');run("runCommand(shell,'cd FixtureRepo')");
 assert.equal(run("files.find(f=>f.name==='hello.txt'&&f.parent===shell.state.cwd).content"),'Original\n');
 await run("runCommand(shell,'git config user.name Fixture')");
 await run('runCommand(shell,\'git config user.email "fixture@example.invalid"\')');
 run('runCommand(shell,\'echo "Changed through the shell" > hello.txt\')');
 await run("runCommand(shell,'git add .')");
 await run('runCommand(shell,\'git commit -m "Terminal commit"\')');
 const oldHead=fixtureGit.head();await run("runCommand(shell,'git push -u origin main')");
 assert.match(run('shell.state.lines.at(-1)'),/push completed/);assert.notEqual(fixtureGit.head(),oldHead);
 await run("runCommand(shell,'git fetch')");assert.match(run('shell.state.lines.at(-1)'),/fetch completed/);
 await run("runCommand(shell,'git pull')");assert.match(run('shell.state.lines.at(-1)'),/pull completed/);
 await run("runCommand(shell,'git switch -c feature')");assert.match(run('shell.state.lines.at(-1)'),/Switched to feature/);
 await run("runCommand(shell,'git log --oneline')");assert.match(run('shell.state.lines.at(-1)'),/Terminal commit/);
 assert.ok(Object.keys(run('prefs.gitRepositories[shell.state.cwd].snapshot')).some(p=>p.includes('/.git/')));
 run("runCommand(shell,'cd ..')");await run("runCommand(shell,'git clone https://github.com/fixture/remote.git SecondRepo')");assert.match(run('shell.state.lines.at(-1)'),/Cloned into/);assert.equal(run('Object.keys(prefs.gitRepositories).length'),2);run("runCommand(shell,'cd FixtureRepo')");await run("runCommand(shell,'git branch')");assert.match(run('shell.state.lines.at(-1)'),/feature/);run("runCommand(shell,'cd ../SecondRepo')");await run("runCommand(shell,'git branch')");assert.doesNotMatch(run('shell.state.lines.at(-1)'),/feature/);
 console.log('PASS multiple isolated clones and terminal Git: actual smart-HTTP clone, edit, add, commit, push, fetch, pull, branch, history and cloud snapshot');
}finally{await fixtureGit.close()}


const nativeFs=await import('node:fs'),nodePath=await import('node:path'),nodeOs=await import('node:os');const migrationDir=await fs.mkdtemp(nodePath.join(nodeOs.tmpdir(),'atelier-git-migrate-'));const actualGit=(await import('isomorphic-git')).default;
window.testGitModuleLoader=async()=>({default:actualGit,LightningFS:class{constructor(name){const base=nodePath.join(migrationDir,name);nativeFs.mkdirSync(base,{recursive:true});this.promises={};for(const method of ['mkdir','readdir','readFile','writeFile','stat','lstat','unlink','rmdir','readlink','symlink','rename'])this.promises[method]=async(...args)=>{args[0]=nodePath.join(base,args[0]);if(method==='rename')args[1]=nodePath.join(base,args[1]);return fs[method](...args)}}}});
run("prefs.gitSnapshot=Object.values(prefs.gitRepositories)[0].snapshot;prefs.gitRepositories={};prefs.gitRootId=null;gitWorkspace=null;gitEnvironment=realGitEnvironment");
await run('globalThis.migratedGit=gitEnvironment()');window.migratedGit=await run('migratedGit');
check('Legacy shared Git workspace migrates without losing files or history',()=>{assert.equal(run("files.find(f=>f.parent===prefs.gitRootId&&f.name==='hello.txt').content"),'Changed through the shell\n');assert.ok(run('Object.keys(prefs.gitRepositories[prefs.gitRootId].snapshot).length')>0)});
assert.equal((await actualGit.log({fs:window.migratedGit.fs,dir:window.migratedGit.dir}))[0].commit.message.trim(),'Terminal commit');
await run("globalThis.freshGit=gitEnvironment('independent-fixture')");const fresh=await run('freshGit');assert.deepEqual(await fresh.pfs.readdir(fresh.dir),[]);assert.ok((await window.migratedGit.pfs.readdir(window.migratedGit.dir)).includes('.git'));


run("globalThis.browserTest=openApp('browser',true);cloud.ready=false");

window.open=()=>{throw Error('External browsing is forbidden')};
await run("navigate(browserTest,'https://github.com/path')");
check('Web pages use a separate-origin sandboxed engine',()=>{const frame=run("q(browserTest,'.browser-engine')");assert.equal(frame.src,'http://127.0.0.1:5174/');assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-forms allow-downloads');assert.equal(run("q(browserTest,'.browser-frame-slot').hidden"),false);assert.equal(window.location.href,'http://localhost:5173/')});
let engineMessages=[];const engineWindow=run('browserTest.state.browserFrame.contentWindow');engineWindow.postMessage=(message,origin)=>engineMessages.push({message,origin});
window.dispatchEvent(new window.MessageEvent('message',{origin:'https://evil.example',source:engineWindow,data:{atelierBrowser:1,type:'ready'}}));
check('Untrusted origins cannot control the browser bridge',()=>assert.equal(run('browserTest.state.browserReady'),undefined));
window.dispatchEvent(new window.MessageEvent('message',{origin:run('BROWSER_ENGINE_ORIGIN'),source:engineWindow,data:{atelierBrowser:1,type:'ready'}}));
check('Ready engine receives internal navigation',()=>{assert.equal(engineMessages[0].message.url,'https://github.com/path');assert.equal(engineMessages[0].origin,run('BROWSER_ENGINE_ORIGIN'))});
window.dispatchEvent(new window.MessageEvent('message',{origin:run('BROWSER_ENGINE_ORIGIN'),source:engineWindow,data:{atelierBrowser:1,type:'loaded',url:'https://github.com/next',title:'Repository'}}));
check('Page navigation updates address and independent history',()=>{assert.equal(run("q(browserTest,'.web-address').value"),'https://github.com/next');assert.equal(run('prefs.browserHistory[0].title'),'Repository')});
run("q(browserTest,'[data-action=back]').click()");assert.equal(engineMessages.at(-1).message.type,'back');
await run("navigate(browserTest,'atelier://home')");
check('Home preserves the live engine without external navigation',()=>{assert.equal(run("q(browserTest,'.browser-frame-slot').hidden"),true);assert.ok(run("q(browserTest,'.reader-home')"));assert.equal(window.location.href,'http://localhost:5173/')});
run("files.push({id:'reader-local',name:'Local.html',type:'text',parent:'documents',content:'<h1>Local HTML</h1><script>window.pwned=true</script>'})");await run("navigate(browserTest,'atelier://file/reader-local')");
check('Local HTML remains isolated and sanitized',()=>{assert.equal(run("q(browserTest,'.reader-document').shadowRoot.querySelector('h1').textContent"),'Local HTML');assert.equal(window.pwned,undefined)});
await run("navigate(browserTest,'javascript:alert(1)')");assert.match(run("q(browserTest,'.reader-status').textContent"),/Only HTTP/);
run('browserTest.cleanup()');check('Closing browser removes its transport and frame',()=>assert.equal(run('browserTest.state.browserFrame'),null));
const originalFetch=window.fetch;window.fetch=async()=>({status:401,ok:false});
run("cloud.busy=false;cloud.running=null;cloud.loading=null;clearTimeout(cloud.timer);cloud.guest=false;files.push({id:'private-test',name:'Secret.txt',parent:'documents',type:'text'});localOwner='previous-account'");
await run('loadCloud()');
check('Anonymous sessions discard previous account files and stop retries',()=>{assert.equal(run('cloud.guest'),true);assert.equal(run("files.some(f=>f.id==='private-test')"),false);assert.equal(run('cloud.user'),null);assert.equal(run('cloud.dirty'),false)});
await run("files.push({id:'guest-test',name:'Temporary.txt',parent:'documents',type:'text'});save();flushCloud()");
check('Guest edits stay in memory without cloud writes',()=>{assert.equal(run('cloud.dirty'),false);assert.equal(run('cloud.ready'),false);assert.match(run('cloud.status'),/Guest session/)});
window.fetch=originalFetch;
check('No runtime DOM exceptions' ,()=>assert.deepEqual(errors,[]));
for(const name of run('Object.keys(appNames).filter(name=>!extraApps[name])'))assert.ok((await fs.stat(new URL('./public/assets/icons/'+name+'.png',import.meta.url))).size>0);
console.log(count+' tests passed. DOM and state tests; no browser layout or audio-output verification.');
dom.window.close();
