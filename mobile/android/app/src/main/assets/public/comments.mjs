import {uid,bounds} from './core.mjs';
export function formatTimestamp(time){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(time));}
function body(value,allowEmpty=false){const s=String(value||'').trim();if(!s&&!allowEmpty)throw new Error('请写一点批注内容，或插入图片');if(s.length>20000)throw new Error('单条批注最多 20000 字');return s;}
export function validateImages(images){
 if(images===undefined)return [];if(!Array.isArray(images)||images.length>12)throw new Error('每条批注最多 12 张图片');let total=0;
 return images.map(image=>{if(!image||typeof image.src!=='string'||!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z\d+/=]+$/i.test(image.src)||image.src.length>17*1024*1024||(total+=image.src.length)>64*1024*1024)throw new Error('批注图片数据无效或过大');if(![image.width,image.height].every(n=>Number.isFinite(n)&&n>0&&n<=30000))throw new Error('批注图片尺寸无效');return {id:typeof image.id==='string'?image.id:uid(),name:String(image.name||'图片').slice(0,160),src:image.src,thumbnail:typeof image.thumbnail==='string'&&image.thumbnail.length<300000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/=]+$/i.test(image.thumbnail)?image.thumbnail:undefined,width:image.width,height:image.height};});
}
export function roots(page){return (page.comments||[]).filter(n=>n.parentId===null);}
export function threadNodes(page,rootId){return (page.comments||[]).filter(n=>n.threadId===rootId);}
export function commentPosition(page,root){
 const anchor=root.anchor||{x:45,y:100},linked=page.annotations.filter(a=>(anchor.annotationIds||[]).includes(a.id));
 if(linked.length){const boxes=linked.map(bounds);return{x:Math.max(12,Math.max(...boxes.map(b=>b.x+b.w))+16),y:Math.max(12,Math.min(...boxes.map(b=>b.y)))};}
 return {x:Math.max(12,anchor.x),y:Math.max(12,anchor.y)};
}
export function addThread(page,position,text,annotationIds=[],now=Date.now(),images=[]){
 page.comments??=[];if(page.comments.length>=5000)throw new Error('当前页批注达到 5000 条，请新建一页继续');
 const pictures=validateImages(images),id=uid(),node={id,threadId:id,parentId:null,body:body(text,pictures.length>0),images:pictures,createdAt:now,updatedAt:now,anchor:{x:Math.max(12,position.x),y:Math.max(12,position.y),annotationIds:[...annotationIds]}};page.comments.push(node);return node;
}
export function replyTo(page,parentId,text,now=Date.now(),images=[]){
 const parent=(page.comments||[]).find(n=>n.id===parentId);if(!parent)throw new Error('原批注不存在');if(page.comments.length>=5000)throw new Error('当前页批注达到 5000 条');
 const pictures=validateImages(images),node={id:uid(),threadId:parent.threadId,parentId,body:body(text,pictures.length>0),images:pictures,createdAt:now,updatedAt:now};page.comments.push(node);return node;
}
export function editComment(page,id,text,now=Date.now()){const node=page.comments.find(n=>n.id===id);if(!node)throw new Error('批注不存在');node.body=body(text,(node.images||[]).length>0);node.updatedAt=now;return node;}
export function removeComment(page,id){const removed=new Set([id]);let changed=true;while(changed){changed=false;for(const n of page.comments||[])if(n.parentId&&removed.has(n.parentId)&&!removed.has(n.id)){removed.add(n.id);changed=true;}}page.comments=(page.comments||[]).filter(n=>!removed.has(n.id));return removed.size;}
export function commentTree(page,rootId){const nodes=threadNodes(page,rootId),byId=new Map(nodes.map(n=>[n.id,n])),children=new Map();for(const n of nodes){const list=children.get(n.parentId)||[];list.push(n);children.set(n.parentId,list);}const result=[],queue=[{id:rootId,depth:0}];while(queue.length){const {id,depth}=queue.pop(),node=byId.get(id);if(!node)continue;result.push({node,depth});for(const n of [...(children.get(id)||[])].reverse())queue.push({id:n.id,depth:depth+1});}return result;}
export function validateComments(value,annotationIds=new Map()){
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>5000)throw new Error('备份中的批注数量无效');
 const original=new Map(),map=new Map();for(const n of value){if(!n||typeof n.id!=='string'||original.has(n.id))throw new Error('备份批注标识无效');original.set(n.id,n);map.set(n.id,uid());}
 const result=[],floors=new Set();
 for(const n of value){
  const images=validateImages(n.images),text=body(n.body,images.length>0);if(!Number.isFinite(n.createdAt)||n.createdAt<0||n.createdAt>8e15)throw new Error('批注时间无效');let root=n,seen=new Set();
  while(root.parentId!==null){if(seen.has(root.id))throw new Error('批注回复关系存在循环');seen.add(root.id);root=original.get(root.parentId);if(!root)throw new Error('批注的父级不存在');}
  const node={id:map.get(n.id),threadId:map.get(root.id),parentId:n.parentId===null?null:map.get(n.parentId),body:text,images,createdAt:n.createdAt,updatedAt:Number.isFinite(n.updatedAt)?n.updatedAt:n.createdAt};
  if(n.parentId===null){const a=n.anchor;if(!a||![a.x,a.y].every(v=>Number.isFinite(v)&&v>=0&&v<1e12))throw new Error('批注定位无效');node.anchor={x:a.x,y:a.y,annotationIds:(Array.isArray(a.annotationIds)?a.annotationIds:[]).map(id=>annotationIds.get(id)).filter(Boolean)};
   if(n.floorNumber!==undefined){if(!Number.isSafeInteger(n.floorNumber)||n.floorNumber<1||n.floorNumber>=1e9||floors.has(n.floorNumber))throw new Error('备份中的楼层编号无效或重复');floors.add(n.floorNumber);node.floorNumber=n.floorNumber;}
  }
  result.push(node);
 }
 return result;
}
export function pdfAnchor(crop,rotation,point){
 const r=((rotation%360)+360)%360,{x,y,width:w,height:h}=crop;
 if(r===90)return{x:x+point.y,y:y+point.x};if(r===180)return{x:x+w-point.x,y:y+point.y};if(r===270)return{x:x+w-point.y,y:y+h-point.x};return{x:x+point.x,y:y+h-point.y};
}
export function addPdfComments(output,target,page,PDFLib,tile){
 const {PDFHexString,PDFString,PDFName}=PDFLib,refs=new Map(),rootMap=new Map(roots(page).map(n=>[n.id,n]));
 for(const node of page.comments||[]){const root=rootMap.get(node.threadId);if(!root)continue;const pos=commentPosition(page,root);if(tile&&(pos.x<tile.x||pos.x>=tile.x+tile.width||pos.y<tile.y||pos.y>=tile.y+tile.height))continue;
  const p=pdfAnchor(target.getCropBox(),target.getRotation().angle,{x:pos.x-(tile?.x||0),y:pos.y-(tile?.y||0)}),date=new Date(node.createdAt).toISOString().replace(/[-:]/g,'').replace('T','').slice(0,14);
  const content=node.body+(node.images?.length?'\n\n附图保存在 PDF 文件附件中：\n'+node.images.map((image,i)=>attachmentName(node,image,i)).join('\n'):'');
  const dict=output.context.obj({Type:'Annot',Subtype:'Text',Rect:[p.x-8,p.y-8,p.x+8,p.y+8],Contents:PDFHexString.fromText(content),T:PDFHexString.fromText('我'),NM:PDFString.of(node.id),M:PDFString.of('D:'+date+'Z'),Name:'Comment',F:4});
  const ref=output.context.register(dict);refs.set(node.id,{ref,dict});target.node.addAnnot(ref);
 }
 for(const n of page.comments||[]){if(n.parentId&&refs.has(n.id)&&refs.has(n.parentId)){refs.get(n.id).dict.set(PDFName.of('IRT'),refs.get(n.parentId).ref);refs.get(n.id).dict.set(PDFName.of('RT'),PDFName.of('R'));}}
}
function attachmentName(node,image,index){const match=image.src.match(/^data:image\/(\w+);/),ext=match?.[1]==='jpeg'?'jpg':match?.[1]||'png';return `批注-${node.id.slice(0,8)}-${index+1}.${ext}`;}
export async function attachCommentImages(output,page){for(const node of page.comments||[])for(let i=0;i<(node.images||[]).length;i++){const image=node.images[i],comma=image.src.indexOf(','),bytes=Uint8Array.from(atob(image.src.slice(comma+1)),c=>c.charCodeAt(0));await output.attach(bytes,attachmentName(node,image,i),{mimeType:image.src.slice(5,image.src.indexOf(';')),description:image.name,creationDate:new Date(node.createdAt)});}}
