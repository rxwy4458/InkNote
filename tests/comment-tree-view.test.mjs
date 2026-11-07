import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCommentTree} from '../app/comment-tree-view.mjs';
import {commentTree,replyTo} from '../app/comments.mjs';
import {createDiscussion} from '../app/discussion.mjs';

test('回复连接树保持真实父级：孙楼位于子楼内，同级回复回到原父级',()=>{
 const page=createDiscussion('回复关系','',1000,'主楼').pages[0],root=page.comments[0];
 const a=replyTo(page,root.id,'子楼 A'),b=replyTo(page,root.id,'子楼 B');
 const grandchild=replyTo(page,a.id,'A 的子楼'),deeper=replyTo(page,grandchild.id,'继续回复');
 const relationships=new Map();
 const html=renderCommentTree(commentTree(page,root.id),entry=>{
  relationships.set(entry.node.id,entry.children.map(child=>child.node.id));
  return `<article data-id="${entry.node.id}"></article>`;
 });
 assert.deepEqual(relationships.get(root.id),[a.id,b.id]);
 assert.deepEqual(relationships.get(a.id),[grandchild.id]);
 assert.deepEqual(relationships.get(grandchild.id),[deeper.id]);
 assert.deepEqual(relationships.get(b.id),[]);
 const stack=[],parentById=new Map();
 for(const token of html.matchAll(/<div\b[^>]*>|<\/div>|<article data-id="([^"]+)"/g)){
  if(token[1]){
   const node=stack.at(-1);node.id=token[1];
   parentById.set(node.id,stack.slice(0,-1).reverse().find(frame=>frame.id)?.id??null);
  }else if(token[0]==='</div>')stack.pop();else stack.push({});
 }
 assert.equal(stack.length,0);
 assert.deepEqual([...parentById],[[root.id,null],[a.id,root.id],[grandchild.id,a.id],[deeper.id,grandchild.id],[b.id,root.id]]);
});

test('折叠后的主楼没有残留回复连接线或隐藏子楼内容',()=>{
 const page=createDiscussion('折叠','',1000,'主楼').pages[0],root=page.comments[0];replyTo(page,root.id,'回复');
 const html=renderCommentTree(commentTree(page,root.id).filter(entry=>entry.depth===0),entry=>entry.node.body);
 assert.match(html,/主楼/);assert.doesNotMatch(html,/has-replies|comment-tree-children|回复/);
});
