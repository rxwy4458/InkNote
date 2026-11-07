import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceToSegment,hitAnnotation,bounds,translate,overlayPlacement,intersects} from '../app/core.mjs';

test('橡皮擦命中笔迹，不误删相邻的空白区域',()=>{
 const stroke={type:'pen',width:3,points:[{x:10,y:10,p:1},{x:100,y:10,p:1}]};
 assert.equal(hitAnnotation(stroke,{x:50,y:16},5),true);
 assert.equal(hitAnnotation(stroke,{x:50,y:26},5),false);
 assert.equal(hitAnnotation(stroke,{x:0,y:10},5),false);
 assert.equal(distanceToSegment({x:40,y:20},{x:10,y:10},{x:10,y:10}),Math.hypot(30,10));
});
test('矩形中心留白不会被橡皮擦误判为边框',()=>{
 const a={type:'rect',x:10,y:20,w:100,h:80,width:2};
 assert.equal(hitAnnotation(a,{x:60,y:60},5),false);
 assert.equal(hitAnnotation(a,{x:10,y:60},5),true);
 assert.deepEqual(bounds({...a,w:-100}),{x:-90,y:20,w:100,h:80});
});
test('套索移动保留压力和笔迹形状',()=>{
 const a={type:'pen',width:2,points:[{x:0,y:0,p:.2},{x:20,y:30,p:.9}]};
 translate(a,15,-10);
 assert.deepEqual(a.points,[{x:15,y:-10,p:.2},{x:35,y:20,p:.9}]);
 assert.equal(intersects(bounds(a),{x:30,y:10,w:20,h:20}),true);
 assert.equal(intersects(bounds(a),{x:100,y:100,w:20,h:20}),false);
});
test('文字选择区域覆盖多行内容，移动后位置一致',()=>{
 const a={type:'text',text:'第一行\n第二行',x:40,y:70,size:16,w:120,h:46};
 assert.equal(hitAnnotation(a,{x:50,y:105}),true);
 translate(a,-10,20);assert.deepEqual(bounds(a),{x:30,y:90,w:120,h:46});
});
test('0/90/180/270 度与偏移裁切框的批注图层精确覆盖原页面',()=>{
 const box={x:17,y:29,width:400,height:600};
 for(const rotation of [0,90,180,270,-90,450]){
  const p=overlayPlacement(box,rotation),r=p.rotation*Math.PI/180;
  const points=[[0,0],[p.width,0],[0,p.height],[p.width,p.height]].map(([x,y])=>({x:p.x+x*Math.cos(r)-y*Math.sin(r),y:p.y+x*Math.sin(r)+y*Math.cos(r)}));
  const minX=Math.min(...points.map(x=>x.x)),minY=Math.min(...points.map(x=>x.y));
  const maxX=Math.max(...points.map(x=>x.x)),maxY=Math.max(...points.map(x=>x.y));
  assert.ok(Math.abs(minX-box.x)<1e-8,`left at ${rotation}`);assert.ok(Math.abs(minY-box.y)<1e-8,`bottom at ${rotation}`);
  assert.ok(Math.abs(maxX-box.x-box.width)<1e-8,`right at ${rotation}`);assert.ok(Math.abs(maxY-box.y-box.height)<1e-8,`top at ${rotation}`);
 }
});
