export function descendants(files,id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const f of files)if(ids.has(f.parent)&&!ids.has(f.id)){ids.add(f.id);changed=true}}return ids}
export function available(files,file){const seen=new Set();let f=file;while(f){if(f.deleted||seen.has(f.id))return false;seen.add(f.id);f=files.find(x=>x.id===f.parent)}return true}
export function moveItems(files,ids,parent){
 const target=files.find(f=>f.id===parent);if(!target||target.type!=='folder'||!available(files,target))return {ok:false,error:'Choose an existing folder.'};
 const set=new Set(ids);const items=files.filter(f=>set.has(f.id)&&!files.some(p=>set.has(p.id)&&p.id!==f.id&&descendants(files,p.id).has(f.id)));
 if(!items.length)return {ok:false,error:'No files selected.'};
 const names=new Set(files.filter(f=>f.parent===parent&&!f.deleted&&!set.has(f.id)).map(f=>f.name.toLowerCase()));
 for(const f of items){if(f.parent==='root')return {ok:false,error:'System folders cannot be moved.'};if(f.deleted)return {ok:false,error:'Restore this item first.'};if(descendants(files,f.id).has(parent))return {ok:false,error:'A folder cannot be moved inside itself.'};if(names.has(f.name.toLowerCase()))return {ok:false,error:'An item with this name already exists.'};names.add(f.name.toLowerCase())}
 for(const f of items){f.parent=parent;f.modified=Date.now()}return {ok:true,items};
}
export function intersects(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}
export function gridPosition(point,bounds){const columns=Math.max(1,Math.floor(bounds.width/104));const rows=Math.max(1,Math.floor(bounds.height/108));return {col:Math.max(0,Math.min(columns-1,Math.round((bounds.width-point.x-100)/104))),row:Math.max(0,Math.min(rows-1,Math.round(point.y/108)))}}
export function freeGridPosition(start,occupied,columns,rows){for(let i=0;i<columns*rows;i++){const slot=(start.col*rows+start.row+i)%(columns*rows),p={col:Math.floor(slot/rows),row:slot%rows};if(!occupied.has(p.col+':'+p.row))return p}return null}
export function calculate(a,b,operator){const result=operator==='+'?a+b:operator==='−'?a-b:operator==='×'?a*b:b===0?NaN:a/b;return Number.isFinite(result)?String(Number(result.toPrecision(12))):'Error'}
export function tokenize(command){const parts=command.match(/"[^"]*"|'[^']*'|\S+/g)||[];return parts.map(p=>p.replace(/^['"]|['"]$/g,''))}
export function windowGestureRect(rect,dx,dy,edge,viewport,min={width:440,height:300}){
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 if(!edge)return {...rect,left:clamp(rect.left+dx,96-rect.width,viewport.width-96),top:clamp(rect.top+dy,32,viewport.height-64)};
 let left=rect.left,top=rect.top,right=rect.left+rect.width,bottom=rect.top+rect.height;
 if(edge.includes('w'))left=clamp(left+dx,right-viewport.width*2,right-min.width);
 if(edge.includes('e'))right=clamp(right+dx,left+min.width,left+viewport.width*2);
 if(edge.includes('n'))top=clamp(top+dy,32,bottom-min.height);
 if(edge.includes('s'))bottom=clamp(bottom+dy,top+min.height,Math.max(top+min.height,viewport.height));
 return {left,top,width:right-left,height:bottom-top};
}
