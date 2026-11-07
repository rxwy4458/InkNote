import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussion,discussionDraft,discussionStats,matchingThreads,ensureDiscussionFloors,publishDiscussionDraft,discussionLayout} from '../app/discussion.mjs';
import {replyTo,validateComments,commentTree,removeComment,roots} from '../app/comments.mjs';

test('一页一帖：标题、主楼和创建时间固定，新帖完全独立',()=>{
 const now=1793707200000,a=createDiscussion('阅读随想','个人',now,'今天读到的一个问题'),b=createDiscussion('另一页','',now+60000,'另一个问题');
 assert.equal(a.kind,'discussion');assert.equal(a.pages.length,1);
 assert.equal(a.createdAt,now);assert.equal(a.pages[0].canvasCreatedAt,now);
 assert.equal(a.pages[0].comments.length,1);assert.equal(a.pages[0].comments[0].body,'今天读到的一个问题');
 assert.equal(a.pages[0].comments[0].createdAt,now);
 assert.equal(discussionDraft(a.pages[0]).parentId,null);
 assert.equal(a.pages[0].comments[0].floorNumber,1);assert.equal(a.pages[0].nextFloorNumber,2);
 assert.notEqual(a.id,b.id);assert.notEqual(a.pages[0].id,b.pages[0].id);
 assert.throws(()=>createDiscussion('  '),/标题/);
});

test('同一个帖子可以连续发布 1楼、2楼、3楼，默认发布新楼层',()=>{
 const d=createDiscussion('同帖多楼','',1000,'第一楼'),p=d.pages[0];
 const second=publishDiscussionDraft(p,discussionDraft(p),'第二楼',2000);
 const third=publishDiscussionDraft(p,discussionDraft(p),'第三楼',3000);
 assert.equal(d.pages.length,1);assert.equal(p.nextFloorNumber,4);
 assert.deepEqual(roots(p).map(n=>n.floorNumber),[1,2,3]);
 assert.equal(second.parentId,null);assert.equal(second.threadId,second.id);
 assert.equal(third.parentId,null);assert.equal(third.createdAt,3000);
 assert.equal(discussionStats(d).threads,3);assert.equal(discussionStats(d).replies,0);
});

test('回复二楼、回复该回复、继续回复分别落在正确父级并显示完整层级',()=>{
 const p=createDiscussion('逐层回复','',1000,'第一楼').pages[0];
 const second=publishDiscussionDraft(p,discussionDraft(p),'第二楼',2000);
 const reply=publishDiscussionDraft(p,discussionDraft(p,second.id),'二楼的回复',2100);
 const nested=publishDiscussionDraft(p,discussionDraft(p,reply.id),'对回复的回复',2200);
 const deeper=publishDiscussionDraft(p,discussionDraft(p,nested.id),'继续下一层',2300);
 const layout=discussionLayout(p);
 assert.equal(roots(p).length,2);assert.equal(nested.parentId,reply.id);assert.equal(deeper.parentId,nested.id);
 assert.equal(deeper.threadId,second.id);assert.equal(deeper.createdAt,2300);
 assert.deepEqual([second,reply,nested,deeper].map(n=>layout.get(n.id).label),['2楼','2.1','2.1.1','2.1.1.1']);
 assert.deepEqual([second,reply,nested,deeper].map(n=>layout.get(n.id).depth),[0,1,2,3]);
 assert.equal(layout.get(nested.id).parentLabel,'2.1');assert.equal(layout.get(deeper.id).parentLabel,'2.1.1');
 assert.equal(discussionDraft(p).parentId,null);
});

test('删除楼层后保留原编号，新楼接续编号，搜索不会把第三楼改成第一楼',()=>{
 const p=createDiscussion('编号','',1000,'第一楼').pages[0];
 const second=publishDiscussionDraft(p,discussionDraft(p),'第二楼');
 const third=publishDiscussionDraft(p,discussionDraft(p),'第三楼保留');
 removeComment(p,second.id);
 const fourth=publishDiscussionDraft(p,discussionDraft(p),'第四楼');
 assert.deepEqual(roots(p).map(n=>n.floorNumber),[1,3,4]);assert.equal(fourth.floorNumber,4);
 const found=matchingThreads(p,'第三楼保留');assert.equal(found.length,1);
 assert.equal(discussionLayout(p).get(found[0].id).label,'3楼');
 const restored=structuredClone(p);restored.comments=validateComments(restored.comments);ensureDiscussionFloors(restored);
 assert.deepEqual(roots(restored).map(n=>n.floorNumber),[1,3,4]);assert.equal(restored.nextFloorNumber,5);
 assert.equal(discussionLayout(p).get(third.id).label,'3楼');
});

test('旧版帖子迁移补全楼层编号，保留已有正文、时间和三级回复',()=>{
 const p=createDiscussion('旧笔记','',1000,'原文').pages[0],root=p.comments[0];
 const reply=replyTo(p,root.id,'原回复',1100),nested=replyTo(p,reply.id,'原楼中楼',1200);
 delete root.floorNumber;delete p.nextFloorNumber;
 ensureDiscussionFloors(p);const layout=discussionLayout(p);
 assert.equal(root.floorNumber,1);assert.equal(p.nextFloorNumber,2);
 assert.equal(root.body,'原文');assert.equal(nested.parentId,reply.id);assert.equal(nested.createdAt,1200);
 assert.equal(layout.get(nested.id).label,'1.1.1');assert.equal(layout.get(nested.id).depth,2);
 assert.equal(publishDiscussionDraft(p,discussionDraft(p),'新二楼').floorNumber,2);
});

test('发布位置失效或内容为空时不会错误新增楼层，备份拒绝重复楼号',()=>{
 const p=createDiscussion('位置','',1000,'第一楼').pages[0];
 assert.throws(()=>publishDiscussionDraft(p,{...discussionDraft(p),pageId:'elsewhere'},'内容'),/位置/);
 assert.throws(()=>discussionDraft(p,'missing'),/不存在/);
 assert.throws(()=>publishDiscussionDraft(p,discussionDraft(p),' '),/内容/);
 assert.equal(p.nextFloorNumber,2);assert.equal(roots(p).length,1);
 const second=publishDiscussionDraft(p,discussionDraft(p),'第二楼');second.floorNumber=1;
 assert.throws(()=>validateComments(p.comments),/楼层编号/);
});

test('帖子支持楼中楼回复、内容搜索和图片，备份恢复保留日期及关系',()=>{
 const image={id:'image',name:'示意图.png',type:'image/png',width:1,height:1,src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',thumbnail:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
 const d=createDiscussion('一条帖子','',1793707200000,'主楼',[image]),p=d.pages[0],root=p.comments[0];
 const reply=replyTo(p,root.id,'补充说明',1793707260000),nested=replyTo(p,reply.id,'下一层解释',1793707320000);
 assert.deepEqual(discussionStats(d),{threads:1,replies:2,images:1});
 assert.equal(matchingThreads(p,'解释')[0].id,root.id);assert.equal(matchingThreads(p,'示意图')[0].id,root.id);
 assert.equal(matchingThreads(p,'无匹配').length,0);
 const restored=JSON.parse(JSON.stringify(d));restored.pages[0].comments=validateComments(restored.pages[0].comments);
 const nodes=commentTree(restored.pages[0],restored.pages[0].comments[0].id);
 assert.deepEqual(nodes.map(n=>n.depth),[0,1,2]);
 assert.equal(nodes[2].node.createdAt,nested.createdAt);
 assert.equal(nodes[0].node.images[0].src,image.src);
 assert.equal(restored.createdAt,d.createdAt);
});
