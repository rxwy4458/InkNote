import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {newInfinitePage} from '../app/infinite.mjs';
import {addThread,replyTo,commentTree,removeComment,commentPosition,validateComments,pdfAnchor,formatTimestamp} from '../app/comments.mjs';
import {exportPdf} from '../app/export.mjs';
import {readCommentImage,THUMB_SIZE} from '../app/comment-images.mjs';
const require=createRequire(import.meta.url),PDFLib=require('../app/vendor/pdf-lib.min.js');
let canvas;try{canvas=require('@napi-rs/canvas');}catch{canvas=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'@napi-rs/canvas'));}
test('楼中楼批注可以继续回复，全部自动记录时间',()=>{
 const p=newInfinitePage(),root=addThread(p,{x:100,y:100},'读到这里，有个想法',[],1793707200000),reply=replyTo(p,root.id,'补充一点',1793707260000),nested=replyTo(p,reply.id,'再补充一点',1793707320000);
 assert.equal(root.createdAt,1793707200000);assert.equal(nested.threadId,root.id);assert.equal(nested.parentId,reply.id);assert.deepEqual(commentTree(p,root.id).map(n=>n.depth),[0,1,2]);assert.match(formatTimestamp(root.createdAt),/2026/);
});
test('删除某一层只移除该分支，保留其他回复',()=>{
 const p=newInfinitePage(),root=addThread(p,{x:10,y:20},'根批注'),a=replyTo(p,root.id,'分支 A'),b=replyTo(p,root.id,'分支 B');replyTo(p,a.id,'A 的回复');
 assert.equal(removeComment(p,a.id),2);assert.deepEqual(p.comments.map(n=>n.id),[root.id,b.id]);
});
test('批注跟随选中的笔迹移动，笔迹删除后保留原定位',()=>{
 const p=newInfinitePage();p.annotations=[{id:'ink',type:'rect',x:50,y:60,w:100,h:50,width:2}];const root=addThread(p,{x:170,y:60},'关联批注',['ink']);
 assert.equal(commentPosition(p,root).x,166);p.annotations[0].x+=80;assert.equal(commentPosition(p,root).x,246);p.annotations=[];assert.equal(commentPosition(p,root).x,170);
});
test('备份恢复重建批注关系和笔迹引用，并拒绝循环',()=>{
 const p=newInfinitePage(),root=addThread(p,{x:10,y:20},'原文',['old']),child=replyTo(p,root.id,'回复');const restored=validateComments(p.comments,new Map([['old','new']]));
 assert.equal(restored[1].parentId,restored[0].id);assert.equal(restored[1].threadId,restored[0].id);assert.equal(restored[0].anchor.annotationIds[0],'new');assert.notEqual(restored[0].id,root.id);
 const bad=structuredClone(p.comments);bad[0].parentId=child.id;assert.throws(()=>validateComments(bad),/循环/);
});
test('PDF 导出保存中文批注内容与楼中楼回复关系',async()=>{
 const p=newInfinitePage('blank');p.timeCanvas=true;p.canvasCreatedAt=Date.now();const root=addThread(p,{x:100,y:160},'这是中文批注'),reply=replyTo(p,root.id,'这是楼中楼回复');
 const bytes=await exportPdf({id:'thread',title:'时间批注',pages:[p]},()=>{},{PDFLib,createCanvas:()=>canvas.createCanvas(1,1)});const out=await PDFLib.PDFDocument.load(bytes),annots=out.getPage(0).node.Annots();
 assert.equal(annots.size(),2);const first=out.context.lookup(annots.get(0)),second=out.context.lookup(annots.get(1));
 assert.equal(first.get(PDFLib.PDFName.of('Contents')).decodeText(),'这是中文批注');assert.equal(second.get(PDFLib.PDFName.of('Contents')).decodeText(),'这是楼中楼回复');assert.equal(String(second.get(PDFLib.PDFName.of('IRT'))),String(annots.get(0)));
 assert.deepEqual(pdfAnchor({x:20,y:30,width:400,height:580},90,{x:100,y:160}),{x:180,y:130});
});
test('长方形原图生成固定正方形缩略图，原始图片字节保留',async()=>{
 const c=canvas.createCanvas(400,100),ctx=c.getContext('2d');ctx.fillStyle='#315c49';ctx.fillRect(0,0,200,100);ctx.fillStyle='#bd6558';ctx.fillRect(200,0,200,100);const bytes=c.toBuffer('image/png');
 const image=await readCommentImage({size:bytes.length,name:'长图.png',arrayBuffer:async()=>bytes},{loadImage:canvas.loadImage,createCanvas:()=>canvas.createCanvas(1,1)});
 assert.equal(image.width,400);assert.equal(image.height,100);assert.deepEqual(Buffer.from(image.src.split(',')[1],'base64'),bytes);
 const thumbnail=await canvas.loadImage(image.thumbnail);assert.equal(thumbnail.width,THUMB_SIZE*2);assert.equal(thumbnail.height,THUMB_SIZE*2);
 const p=newInfinitePage(),root=addThread(p,{x:80,y:120},'',[],Date.now(),[image]);const restored=validateComments(p.comments);assert.equal(restored[0].images[0].thumbnail,image.thumbnail);assert.equal(restored[0].images[0].src,image.src);
 const out=await PDFLib.PDFDocument.load(await exportPdf({id:'photo',title:'图片批注',pages:[p]},()=>{},{PDFLib,createCanvas:()=>canvas.createCanvas(1,1)}));
 assert.ok(out.catalog.get(PDFLib.PDFName.of('Names')),'PDF 导出保留图片附件');assert.equal(root.body,'');
});
