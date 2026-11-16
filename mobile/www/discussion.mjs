import {uid,newPage} from './core.mjs';
import {roots,threadNodes,addThread,replyTo} from './comments.mjs';

const validFloor=value=>Number.isSafeInteger(value)&&value>0&&value<1e9;
export function ensureDiscussionFloors(page){
 const used=new Set(),missing=[];
 for(const root of roots(page)){if(validFloor(root.floorNumber)&&!used.has(root.floorNumber))used.add(root.floorNumber);else missing.push(root);}
 let candidate=1;
 for(const root of missing){while(used.has(candidate))candidate++;root.floorNumber=candidate;used.add(candidate++);}
 let maximum=0;for(const floor of used)maximum=Math.max(maximum,floor);
 page.nextFloorNumber=Math.max(validFloor(page.nextFloorNumber)?page.nextFloorNumber:1,maximum+1);
 return page;
}
export function addDiscussionFloor(page,text,now=Date.now(),images=[]){
 ensureDiscussionFloors(page);const number=page.nextFloorNumber;
 if(!validFloor(number))throw new Error('当前帖子的楼层编号已达到上限');
 const node=addThread(page,{x:46,y:110},text,[],now,images);
 node.floorNumber=number;page.nextFloorNumber=number+1;return node;
}

export function createDiscussion(title,folder='',now=Date.now(),content='',images=[]){
 const clean=String(title||'').trim();if(!clean)throw new Error('请填写帖子标题');
 const page={...newPage('blank'),timeCanvas:true,canvasCreatedAt:now,discussionPost:true,comments:[]};
 const root=addDiscussionFloor(page,content||clean,now,images);page.postId=root.id;
 return {id:uid(),title:clean.slice(0,160),kind:'discussion',canvasType:'discussion',color:'blue',folder,createdAt:now,updatedAt:now,lastPage:0,pages:[page]};
}
export function discussionStats(document){return document.pages.reduce((s,page)=>({threads:s.threads+roots(page).length,replies:s.replies+(page.comments||[]).filter(n=>n.parentId!==null).length,images:s.images+(page.comments||[]).reduce((n,c)=>n+(c.images?.length||0),0)}),{threads:0,replies:0,images:0});}
export function matchingThreads(page,query){const q=String(query||'').trim().toLocaleLowerCase();return roots(page).filter(root=>!q||threadNodes(page,root.id).some(node=>node.body.toLocaleLowerCase().includes(q)||(node.images||[]).some(image=>image.name.toLocaleLowerCase().includes(q))));}
export function discussionDraft(page,parentId=null){
 ensureDiscussionFloors(page);
 if(parentId!==null&&!(page.comments||[]).some(node=>node.id===parentId))throw new Error('要回复的内容已经不存在');
 return {pageId:page.id,anchor:{x:46,y:110},annotationIds:[],parentId,text:'',images:[]};
}
export function publishDiscussionDraft(page,draft,text=draft.text,now=Date.now()){
 if(draft.pageId!==page.id)throw new Error('发布位置已改变，请重新选择楼层');
 return draft.parentId===null?addDiscussionFloor(page,text,now,draft.images||[]):replyTo(page,draft.parentId,text,now,draft.images||[]);
}
export function discussionLayout(page){
 ensureDiscussionFloors(page);const result=new Map(),children=new Map();
 for(const node of page.comments||[]){const list=children.get(node.parentId)||[];list.push(node);children.set(node.parentId,list);}
 for(const root of roots(page)){
  const stack=[{node:root,depth:0,position:String(root.floorNumber),parentLabel:null}];
  while(stack.length){
   const entry=stack.pop();if(result.has(entry.node.id))continue;
   const label=entry.depth?entry.position:entry.position+'楼';
   result.set(entry.node.id,{...entry,label,floorNumber:root.floorNumber,threadId:root.id});
   const list=children.get(entry.node.id)||[];
   for(let i=list.length-1;i>=0;i--)stack.push({node:list[i],depth:entry.depth+1,position:entry.position+'.'+(i+1),parentLabel:label});
  }
 }
 return result;
}
