// Build real parent/child containers so connector lines follow each branch.
// Iterative traversal also permits long discussions without recursive calls.
export function renderCommentTree(entries,renderItem){
 const byId=new Map(entries.map(entry=>[entry.node.id,{...entry,children:[]}]));
 const roots=[];
 for(const entry of byId.values()){
  const parent=byId.get(entry.node.parentId);
  if(parent)parent.children.push(entry);else roots.push(entry);
 }
 const output=[],stack=roots.slice().reverse().map(entry=>({entry})),seen=new Set();
 while(stack.length){
  const task=stack.pop();
  if(task.close){output.push(task.close);continue;}
  const entry=task.entry;if(seen.has(entry.node.id))continue;seen.add(entry.node.id);
  output.push(`<div class="comment-tree-node ${entry.depth?'':'comment-tree-root'} ${entry.children.length?'has-replies':''}">`,renderItem(entry));
  if(entry.children.length){
   output.push('<div class="comment-tree-children">');stack.push({close:'</div></div>'});
   for(let i=entry.children.length-1;i>=0;i--)stack.push({entry:entry.children[i]});
  }else output.push('</div>');
 }
 return `<div class="comment-tree">${output.join('')}</div>`;
}
