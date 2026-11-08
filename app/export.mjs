import {drawAnnotation,overlayPlacement} from './core.mjs';
import {background} from './paper.mjs';
import {store} from './storage.mjs';
import {drawReadingPage} from './ebooks.mjs';
import {exportTiles,drawInfinitePaper,visibleAnnotations} from './infinite.mjs';
import {addPdfComments,attachCommentImages} from './comments.mjs';
function pngBytes(canvas){if(canvas.toBuffer)return Promise.resolve(new Uint8Array(canvas.toBuffer('image/png')));return new Promise((resolve,reject)=>canvas.toBlob(async blob=>{if(!blob)reject(new Error('页面图像生成失败'));else resolve(new Uint8Array(await blob.arrayBuffer()));},'image/png'));}
export async function exportPdf(doc,onProgress=()=>{},adapters={}){
 const PDFLib=adapters.PDFLib||globalThis.PDFLib,{PDFDocument,degrees}=PDFLib;
 const makeCanvas=adapters.createCanvas||(()=>document.createElement('canvas'));
 const loadBinary=adapters.loadBinary||store.binary;
 const output=await PDFDocument.create();
 output.setTitle(doc.title);output.setCreator('墨页 InkNote');output.setProducer('InkNote / PDF-LIB');
 let original,raster=null,renderPage=null;
 if(doc.pages.some(p=>p.sourceIndex!==null)){
   const bytes=await loadBinary(doc.id);
   try{original=await PDFDocument.load(bytes);}
   catch(e){
    if(!/encrypt/i.test(e.message))throw e;
    // A password- or permission-protected PDF that PDF.js has opened: export page images instead of copying the
    // encrypted pages — but only where the author allows changes (PDF.js: null = no restrictions; 8 = modify, 32 = annotate).
    const pdf=adapters.pdf;if(!pdf)throw new Error('请先打开这份 PDF，再导出。');
    const allowed=await pdf.getPermissions().catch(()=>null);
    if(allowed&&!allowed.includes(8)&&!allowed.includes(32))throw new Error('这份 PDF 的作者设置了禁止修改，不能导出带批注的副本。批注仍保存在墨页里，也可以导出 .inknote 备份。');
    raster=pdf;renderPage=adapters.renderBackground||(await import('./pdf.mjs')).renderBackground;
   }
 }
 for(let i=0;i<doc.pages.length;i++){
   const page=doc.pages[i];let target;
   await attachCommentImages(output,page);
   if(adapters.prepareRich&&page.annotations.some(a=>a.type==='rich'))await adapters.prepareRich(page.annotations,3);
   if(page.infinite){
    for(const tile of exportTiles(page)){
     const canvas=makeCanvas(),scale=2;canvas.width=Math.ceil(tile.width*scale);canvas.height=Math.ceil(tile.height*scale);const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.translate(-tile.x,-tile.y);drawInfinitePaper(ctx,page,tile);visibleAnnotations(page.annotations,{x:tile.x,y:tile.y,w:tile.width,h:tile.height}).forEach(a=>drawAnnotation(ctx,a));
     const image=await output.embedPng(await pngBytes(canvas));target=output.addPage([tile.width,tile.height]);target.drawImage(image,{x:0,y:0,width:tile.width,height:tile.height});addPdfComments(output,target,page,PDFLib,tile);canvas.width=1;canvas.height=1;await new Promise(r=>setTimeout(r,0));
    }onProgress(i+1,doc.pages.length);continue;
   }
   if(page.sourceIndex!==null&&raster){
     const scale=3,canvas=makeCanvas();await renderPage(canvas,page,raster,{cssWidth:page.width,pixelRatio:scale});const ctx=canvas.getContext('2d');ctx.save();ctx.scale(canvas.width/page.width,canvas.height/page.height);page.annotations.forEach(a=>drawAnnotation(ctx,a));ctx.restore();
     const image=await output.embedPng(await pngBytes(canvas));target=output.addPage([page.width,page.height]);target.drawImage(image,{x:0,y:0,width:page.width,height:page.height});canvas.width=1;canvas.height=1;
     addPdfComments(output,target,page,PDFLib);onProgress(i+1,doc.pages.length);await new Promise(r=>setTimeout(r,0));continue;
   }
   if(page.sourceIndex!==null){const [copied]=await output.copyPages(original,[page.sourceIndex]);target=output.addPage(copied);}
   else target=output.addPage([page.width,page.height]);
   if(page.sourceIndex===null||page.annotations.length){
     const scale=2,canvas=makeCanvas();canvas.width=Math.ceil(page.width*scale);canvas.height=Math.ceil(page.height*scale);const ctx=canvas.getContext('2d');
     if(page.sourceIndex===null){if(page.reading)await drawReadingPage(ctx,page,scale,adapters);else background(ctx,page,scale);}
     ctx.scale(scale,scale);page.annotations.forEach(a=>drawAnnotation(ctx,a));
     const image=await output.embedPng(await pngBytes(canvas));
     const p=overlayPlacement(target.getCropBox(),target.getRotation().angle);
     target.drawImage(image,{x:p.x,y:p.y,width:p.width,height:p.height,rotate:degrees(p.rotation)});
     canvas.width=1;canvas.height=1;
   }
   addPdfComments(output,target,page,PDFLib);
   onProgress(i+1,doc.pages.length);await new Promise(r=>setTimeout(r,0));
 }
 return output.save();
}
