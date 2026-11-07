import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {newPage} from '../app/core.mjs';
import {newInfinitePage,spacingStep,pageHeader,marginX,stampParts,SPACINGS,drawInfinitePaper} from '../app/infinite.mjs';
import {background} from '../app/paper.mjs';

const {createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');
const pixel=(ctx,x,y)=>[...ctx.getImageData(Math.round(x),Math.round(y),1,1).data];
const reddish=([r,g,b])=>r>200&&r-g>20&&r-b>20;

test('线距：窄、标准、宽依次变大，旧页面没有设置时按标准处理',()=>{
 for(const template of ['ruled','grid','dot'])for(const make of [newPage,newInfinitePage]){
  const steps=SPACINGS.map(spacing=>spacingStep({...make(template),spacing}));
  assert.ok(steps[0]<steps[1]&&steps[1]<steps[2],`${template} ${steps}`);
  assert.equal(spacingStep(make(template)),steps[1]);
  assert.equal(spacingStep({...make(template),spacing:'huge'}),steps[1]);
 }
});

test('页面标题区：新页面留出标题和日期，旧页面保持原来的位置',()=>{
 const fresh={...newPage('ruled'),title:''},legacy=newPage('ruled'),time={...fresh,timeCanvas:true,canvasCreatedAt:0};
 assert.equal(pageHeader(fresh).legacy,false);assert.equal(pageHeader(legacy).legacy,true);
 assert.equal(pageHeader(legacy).bottom,0,'旧页面不额外占位');
 assert.ok(pageHeader(time).bottom>pageHeader(fresh).bottom,'时间画布给日期留位置');
 assert.ok(pageHeader(time).metaY>pageHeader(time).underline,'日期在标题线下方');
 const inf={...newInfinitePage('dot'),title:'',width:9000};
 assert.ok(pageHeader(inf).width<=700,'无限画布的标题框宽度有限');
 assert.ok(marginX(inf)<pageHeader(inf).x&&marginX(fresh)<pageHeader(fresh).x,'边距线在标题左侧');
});

test('日期和时间按北京时间显示',()=>{
 const s=stampParts(Date.UTC(2026,10,6,16,59));
 assert.equal(s.date,'2026年11月7日 星期六');assert.equal(s.time,'0:59');
});

test('边距线和标题绘制到纸张上，旧页面不画',()=>{
 const draw=page=>{const c=createCanvas(600,850),ctx=c.getContext('2d');background(ctx,page);return ctx;};
 const withMargin=draw({...newPage('ruled'),title:'Weekly review',margin:true,spacing:'wide'});
 assert.ok(reddish(pixel(withMargin,30,400)),'A4 横线页左侧有红色边距线');
 const withoutMargin=draw({...newPage('ruled'),title:'',margin:false});
 assert.ok(!reddish(pixel(withoutMargin,30,400)));
 const legacy=draw(newPage('ruled'));
 assert.ok(!reddish(pixel(legacy,30,400)),'旧页面没有边距线');
 const titled=withMargin.getImageData(38,14,120,30).data;let dark=0;for(let i=0;i<titled.length;i+=4)if(titled[i]<90)dark++;
 assert.ok(dark>20,'标题文字画在页面上（用于缩略图和导出）');
 const c=createCanvas(400,400),ctx=c.getContext('2d');const page={...newInfinitePage('grid'),title:'',margin:true};
 drawInfinitePaper(ctx,page,{x:0,y:0,width:400,height:400});
 assert.ok(reddish(pixel(ctx,34,300)),'无限画布也有边距基准线');
});
