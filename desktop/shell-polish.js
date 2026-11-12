// Pointer-distance magnification with one sleeping animation loop for the Dock.
function installDockMotion(){
 const dock=$('#dock');let items=[],pointer=null,frame=0,last=0;
 const measure=()=>{const previous=new Map(items.map(item=>[item.el,item]));items=[...dock.querySelectorAll('[data-dock]')].map(el=>({...previous.get(el),el,art:el.querySelector('.dock-art'),center:el.offsetLeft+el.offsetWidth/2,size:el.offsetWidth,scale:previous.get(el)?.scale||1,velocity:previous.get(el)?.velocity||0}));};
 const wake=()=>{if(!frame){last=performance.now();frame=requestAnimationFrame(tick)}};
 const tick=now=>{frame=0;const dt=Math.min((now-last)/1000,.025)||1/60;last=now;let moving=false;
  const reduced=!motionDuration(100);const base=dock.getBoundingClientRect().left;
  for(const item of items){const distance=pointer===null?1:Math.min(1,Math.abs(pointer-base-item.center)/(item.size*2.6));const target=reduced?1:1+.52*(1+Math.cos(Math.PI*distance))/2;if(reduced){item.scale=1;item.velocity=0}item.scale+=(target-item.scale)*(1-Math.exp(-28*dt));item.velocity=0;if(Math.abs(target-item.scale)<.001&&Math.abs(item.velocity)<.005){item.scale=target;item.velocity=0}else moving=true;}
  const extra=items.map(item=>Math.max(0,item.scale-1)*item.size);const expansion=extra.reduce((a,b)=>a+b,0);let shift=-expansion/2;dock.style.setProperty('--dock-expansion',expansion.toFixed(2)+'px');dock.style.setProperty('--dock-rise',(Math.max(0,...items.map(item=>(item.scale-1)*item.size))*.3).toFixed(2)+'px');
  items.forEach((item,i)=>{item.el.style.transform='translate3d('+(shift+extra[i]/2).toFixed(2)+'px,0,0)';item.art.style.transform='translate3d(0,'+(-(item.scale-1)*16).toFixed(2)+'px,0) scale('+item.scale.toFixed(4)+')';item.el.style.setProperty('--label-bottom',(item.art.offsetHeight*item.scale+(item.scale-1)*16+24).toFixed(2)+'px');shift+=extra[i]});
  if(moving)wake();
 };
 dock.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;pointer=e.clientX;wake()});dock.addEventListener('pointerleave',()=>{pointer=null;wake()});
 dock.addEventListener('focusin',e=>{const item=e.target.closest('[data-dock]');if(item){pointer=dock.getBoundingClientRect().left+item.offsetLeft+item.offsetWidth/2;wake()}});dock.addEventListener('focusout',()=>{pointer=null;wake()});
 dock.addEventListener('click',e=>{const button=e.target.closest('[data-dock]');if(!button||!motionDuration(100)||button.classList.contains('dock-launching'))return;button.classList.add('dock-launching');setTimeout(()=>button.classList.remove('dock-launching'),520)});
 window.addEventListener('blur',()=>{pointer=null;wake()});window.addEventListener('resize',()=>{measure();wake()});
 const prior=renderDock;renderDock=function(){prior();measure();wake()};measure();
}
function bootStage(label,value){const overlay=$('#boot-screen');if(!overlay)return;overlay.querySelector('[data-boot-label]').textContent=label;overlay.querySelector('progress').value=value}
const bootDesktop=boot;
boot=async function(){
 const overlay=$('#boot-screen');document.body.classList.add('booting');bootStage('Preparing your desktop…',0);
 try{await bootDesktop();installDockMotion();bootStage('Ready',4);document.body.classList.remove('booting');if(overlay){await overlay.animate([{opacity:1},{opacity:0}],{duration:motionDuration(220),easing:'ease-out'}).finished;overlay.remove()}showWelcome()}
 catch(error){bootStage('Unable to finish starting. Reload to try again.',0);const retry=overlay?.querySelector('[data-boot-retry]');if(retry){retry.hidden=false;retry.onclick=()=>location.reload()}console.error('Desktop startup failed',error)}
};
