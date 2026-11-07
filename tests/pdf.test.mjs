import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {exportPdf} from '../app/export.mjs';
import {newInfinitePage} from '../app/infinite.mjs';
const require=createRequire(import.meta.url);
const PDFLib=require('../app/vendor/pdf-lib.min.js');
const resolve=name=>{try{return require.resolve(name);}catch(e){if(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)return require.resolve(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,name));throw e;}};
const canvasAPI=require(resolve('@napi-rs/canvas'));
globalThis.DOMMatrix=canvasAPI.DOMMatrix;
globalThis.Path2D=canvasAPI.Path2D;
globalThis.ImageData=canvasAPI.ImageData;
const pdfjs=await import(pathToFileURL(resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const fonts=fileURLToPath(new URL('../app/vendor/standard_fonts/',import.meta.url)).split(path.sep).join('/');

test('实际导出的批注在四种旋转、偏移裁切框与重排页面上保持原位',async()=>{
 const binary=new Uint8Array(await readFile(new URL('../samples/reading-sample.pdf',import.meta.url)));
 const source=await pdfjs.getDocument({data:binary.slice(),standardFontDataUrl:fonts,isEvalSupported:false}).promise;
 const indices=[1,3,0,2];
 const pages=[];
 for(const index of indices){const viewport=(await source.getPage(index+1)).getViewport({scale:1});pages.push({id:'p'+index,sourceIndex:index,width:viewport.width,height:viewport.height,template:'blank',annotations:[{id:'red-box',type:'rect',x:50,y:80,w:150,h:60,width:3,color:'#ff0000'}]});}
 const exported=await exportPdf({id:'test',title:'PDF integration test',pages},()=>{},{PDFLib,createCanvas:()=>canvasAPI.createCanvas(1,1),loadBinary:async()=>binary});
 const result=await pdfjs.getDocument({data:exported,standardFontDataUrl:fonts,isEvalSupported:false}).promise;
 assert.equal(result.numPages,4);
 for(let i=0;i<4;i++){
  const p=await result.getPage(i+1),v=p.getViewport({scale:1});
  assert.equal(v.width,pages[i].width);assert.equal(v.height,pages[i].height);
  const c=canvasAPI.createCanvas(v.width,v.height),ctx=c.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
  const pixels=ctx.getImageData(0,0,c.width,c.height).data;let minX=Infinity,minY=Infinity,maxX=-1,maxY=-1,count=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const n=(y*c.width+x)*4;if(pixels[n]>210&&pixels[n+1]<60&&pixels[n+2]<60){count++;minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}}
  assert.ok(count>500,'批注必须真实出现在导出的 PDF 中');
  assert.ok(Math.abs(minX-49)<3&&Math.abs(maxX-201)<3,`第 ${i+1} 页水平位置 ${minX}–${maxX}`);
  assert.ok(Math.abs(minY-79)<3&&Math.abs(maxY-141)<3,`第 ${i+1} 页垂直位置 ${minY}–${maxY}`);
  const text=(await p.getTextContent()).items.map(t=>t.str).join(' ');assert.match(text,/A space for your thoughts/,'原始 PDF 文本仍可检索');
 }
 await result.destroy();await source.destroy();
});
test('新建纸张与中文文字批注可以生成有效的 PDF',async()=>{
 const data=await exportPdf({id:'blank',title:'中文笔记',pages:[{id:'n',sourceIndex:null,width:400,height:580,template:'grid',annotations:[{id:'t',type:'text',text:'墨页笔记\n记录一个想法',x:35,y:40,size:18,color:'#315c49'}]}]},()=>{},{PDFLib,createCanvas:()=>canvasAPI.createCanvas(1,1)});
 const p=await PDFLib.PDFDocument.load(data);assert.equal(p.getPageCount(),1);assert.equal(p.getTitle(),'中文笔记');
 const resources=p.getPage(0).node.Resources();assert.ok(resources?.get(PDFLib.PDFName.of('XObject')),'导出包含绘制后的纸张和批注');
});
test('无限画布跨页内容导出为 A4，远处的批注保持位置',async()=>{
 const page=newInfinitePage('grid');page.annotations=[{id:'far',type:'rect',x:630,y:900,w:80,h:60,width:3,color:'#ff0000'}];
 const bytes=await exportPdf({id:'infinite',title:'无限画布测试',pages:[page]},()=>{},{PDFLib,createCanvas:()=>canvasAPI.createCanvas(1,1)});
 const pdf=await pdfjs.getDocument({data:bytes}).promise;assert.equal(pdf.numPages,4);
 const p=await pdf.getPage(4),v=p.getViewport({scale:1}),c=canvasAPI.createCanvas(v.width,v.height),ctx=c.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
 const pixels=ctx.getImageData(35,58,2,2).data;assert.ok(pixels.some((_,i)=>i%4===0&&pixels[i]>200&&pixels[i+1]<90),'右下角分页保留远处矩形');await pdf.destroy();
});
