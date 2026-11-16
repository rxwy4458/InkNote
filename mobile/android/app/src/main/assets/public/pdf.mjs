import * as pdfjs from './vendor/pdf.min.mjs';
import {background} from './paper.mjs';
export {background} from './paper.mjs';
export {exportPdf} from './export.mjs';
import {store} from './storage.mjs';
import {drawReadingPage} from './ebooks.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
const base=new URL('./vendor/',import.meta.url).href;
const cache=new Map();
export async function readPdf(bytes,passwordPrompt){
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',iccUrl:base+'iccs/',isEvalSupported:false,enableXfa:false});
 let password;
 task.onPassword=(update,reason)=>{if(!passwordPrompt){task.destroy();return;}Promise.resolve(passwordPrompt(reason===2)).then(p=>{if(p===null)task.destroy();else{password=p;update(p);}}).catch(()=>task.destroy());};
 let pdf;
 try{pdf=await task.promise;}
 catch(e){
  // Publisher DRM (Adobe ADEPT, FileOpen, LCP…) is not the PDF standard password protection: say so plainly.
  if(/unknown (crypt|encryption)|unsupported encryption|encryption.*not supported|EBX_HANDLER|Adobe\.APS|FOPN|lcp/i.test(String(e?.message)))throw new Error('这份 PDF 使用了出版方的版权保护（DRM），只能在指定的阅读软件中打开，墨页无法读取。');
  throw e;
 }
 return {pdf,password};
}
export async function documentPdf(doc,passwordPrompt){
 if(!doc.pages.some(p=>p.sourceIndex!==null))return null;
 if(cache.has(doc.id))return cache.get(doc.id);
 const bytes=await store.binary(doc.id);if(!bytes)throw new Error('找不到原始 PDF，请从备份恢复。');
 const {pdf}=await readPdf(bytes,passwordPrompt);cache.set(doc.id,pdf);return pdf;
}
export function cachePdf(id,pdf){cache.set(id,pdf);}
export async function releasePdfs(keep){for(const [id,pdf] of [...cache]){if(id!==keep){cache.delete(id);await pdf.destroy();}}}
export async function renderBackground(canvas,page,pdf,{pixelRatio=1,cssWidth=page.width}={}){
 const scale=cssWidth/page.width*pixelRatio;
 canvas.width=Math.max(1,Math.round(page.width*scale));canvas.height=Math.max(1,Math.round(page.height*scale));
 const ctx=canvas.getContext('2d',{alpha:false});
 if(page.sourceIndex!==null){const p=await pdf.getPage(page.sourceIndex+1);const viewport=p.getViewport({scale});await p.render({canvasContext:ctx,viewport,background:'#ffffff'}).promise;}
 else if(page.reading)await drawReadingPage(ctx,page,scale);
 else background(ctx,page,scale);
}
export async function pdfTextMatches(doc,query,passwordPrompt){
 const pdf=await documentPdf(doc,passwordPrompt);
 const normalize=s=>s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
 const result=[];const q=normalize(query);
 for(let i=0;i<doc.pages.length;i++){
   const p=doc.pages[i];let text='';if(p.sourceIndex!==null){const page=await pdf.getPage(p.sourceIndex+1);text=(await page.getTextContent()).items.map(t=>t.str).join(' ');}
   text+=' '+p.annotations.map(a=>a.type==='text'?a.text:a.type==='rich'?a.plain||'':'').join(' ');
   if(p.reading)text+=' '+p.reading.blocks.filter(b=>b.type==='line').map(b=>b.text).join('');
   text+=' '+(p.comments||[]).map(n=>n.body).join(' ');
   if(normalize(text).includes(q))result.push(i);
 }
 return result;
}
