import {uid,newPage} from './core.mjs';
export const DIRECT_BOOK_FORMATS=['epub','txt','fb2','html','htm','cbz','md'];
export const CONVERT_BOOK_FORMATS=['mobi','azw','azw3','azw4','prc','rtf','docx','odt','chm','lit','lrf','pdb','snb','tcr','djvu','cbr'];
const MAX_EXPANDED=1024*1024*1024;
const local=n=>String(n||'').split(':').at(-1).toLowerCase();
const elements=n=>(n?.elements||[]).filter(x=>x.type==='element');
function descendants(n,name){const result=[];for(const x of elements(n)){if(local(x.name)===name)result.push(x);result.push(...descendants(x,name));}return result;}
function text(n){if(n?.type==='text')return n.text||'';if(n?.type==='cdata')return n.cdata||'';if(['script','style','iframe','object','audio','video'].includes(local(n?.name)))return '';return (n?.elements||[]).map(text).join('');}
function plain(s){return s.replace(/\u0000/g,'').replace(/[\t\r ]+/g,' ').trim();}
export function decodeText(bytes){
 bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
 if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be').decode(bytes.subarray(2));
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}
}
export function zipPath(base,href){
 const raw=String(href||'').split('#')[0].split('?')[0];if(/^[a-z]+:|^[/\\]|\\/i.test(raw))throw new Error('电子书包含无效资源地址');
 let decoded;try{decoded=decodeURIComponent(raw);}catch{throw new Error('电子书资源地址编码无效');}
 if(/^[a-z]+:|^[/\\]|\\/i.test(decoded))throw new Error('电子书资源地址无效');
 const parts=base.split('/').slice(0,-1).filter(Boolean);for(const p of decoded.split('/')){if(p==='..'){if(!parts.length)throw new Error('电子书资源超出文件范围');parts.pop();}else if(p&&p!=='.')parts.push(p);}return parts.join('/');
}
export function inspectZip(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0)throw new Error('电子书不是有效的 ZIP 容器');
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
 if(count>3000||count===65535||offset+size>end)throw new Error('电子书资源过多或容器无效');let pos=offset,total=0;const names=new Set();
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw new Error('电子书目录损坏');
  const flags=v.getUint16(pos+8,true),expanded=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),el=v.getUint16(pos+30,true),cl=v.getUint16(pos+32,true);
  if(flags&1)throw new Error('该电子书使用加密容器，需要先使用原阅读软件导出未加密副本');
  if(expanded>64*1024*1024||(total+=expanded)>MAX_EXPANDED)throw new Error('电子书解压内容超过 1 GB，或单个资源超过 64 MB');
  if(pos+46+nl+el+cl>offset+size)throw new Error('电子书目录越界');
  const name=new TextDecoder('utf-8').decode(bytes.subarray(pos+46,pos+46+nl));const safe=zipPath('',name);if(names.has(safe))throw new Error('电子书包含重复资源');names.add(safe);pos+=46+nl+el+cl;
 }
 return {count,expandedBytes:total};
}
function parseXml(s,adapters){
 if(/<!ENTITY/i.test(s))throw new Error('电子书 XML 实体声明不受支持');
 s=s.replace(/<!DOCTYPE[^>]*>/gi,'').replace(/&nbsp;/g,'&#160;').replace(/&copy;/g,'&#169;');
 const parse=adapters.xml2js||globalThis.xml2js;if(!parse)throw new Error('XML 解析组件未加载');return parse(s,{compact:false,ignoreComment:true,ignoreDeclaration:true,ignoreInstruction:true,alwaysChildren:true});
}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
const allowedImage=/^image\/(png|jpeg|gif|webp)$/i;
async function resourceImage(zip,file,mime){if(!allowedImage.test(mime))return null;const item=zip.file(file);if(!item)return null;const bytes=await item.async('uint8array');if(bytes.length>12*1024*1024)return null;return 'data:'+mime+';base64,'+base64(bytes);}
async function extractBlocks(node,resolveImage){
 const out=[];
 async function walk(n){
  const name=local(n.name);if(['script','style','nav','head','iframe','object','audio','video','svg'].includes(name))return;
  if(name==='img'||name==='image'){const src=n.attributes?.src||n.attributes?.['xlink:href']||n.attributes?.href;const image=src?await resolveImage(src):null;if(image)out.push({type:'image',src:image});return;}
  if(/^h[1-6]$/.test(name)){const value=plain(text(n));if(value)out.push({type:'heading',text:value});return;}
  if(['p','li','blockquote','pre','title','subtitle','v'].includes(name)){
   const value=plain(text(n));if(value)out.push({type:'paragraph',text:value});
   for(const image of [...descendants(n,'img'),...descendants(n,'image')])await walk(image);return;
  }
  const children=elements(n);if(!children.length){const value=plain(text(n));if(value)out.push({type:'paragraph',text:value});return;}
  for(const child of children)await walk(child);
 }
 await walk(node);return out;
}
async function epub(bytes,name,adapters){
 inspectZip(bytes);const ZIP=adapters.JSZip||globalThis.JSZip;if(!ZIP)throw new Error('EPUB 解压组件未加载');const zip=await ZIP.loadAsync(bytes);
 const container=zip.file('META-INF/container.xml');if(!container)throw new Error('EPUB 缺少 META-INF/container.xml');
 // Publisher DRM (Adobe ADEPT, Readium LCP, Apple FairPlay…) encrypts the chapters themselves. Font obfuscation
 // (IDPF / Adobe font mangling) is not DRM and is fine: only the fonts are scrambled.
 const rights=zip.file('META-INF/rights.xml')||zip.file('META-INF/license.lcpl')||zip.file('META-INF/sinf.xml'),enc=zip.file('META-INF/encryption.xml');
 if(rights||(enc&&[...(await enc.async('string')).matchAll(/<(?:\w+:)?EncryptionMethod[^>]*Algorithm="([^"]+)"/g)].some(m=>!/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(m[1]))))throw new Error('这本 EPUB 使用了出版方的版权保护（DRM），内容是加密的，墨页无法读取。请在购买它的阅读软件中阅读，或向出版方索取无 DRM 的版本。');
 const xml=parseXml(await container.async('string'),adapters);const root=descendants(xml,'rootfile')[0]?.attributes?.['full-path'];if(!root)throw new Error('EPUB 缺少内容索引');const opfPath=zipPath('',root),opfFile=zip.file(opfPath);if(!opfFile)throw new Error('EPUB 内容索引不存在');
 const opf=parseXml(await opfFile.async('string'),adapters);const title=plain(text(descendants(opf,'title')[0]))||name;const author=plain(text(descendants(opf,'creator')[0]));const manifest=new Map(descendants(opf,'item').map(n=>[n.attributes?.id,n.attributes]));
 const imageTypes=new Map([...manifest.values()].filter(n=>n?.href).map(n=>[zipPath(opfPath,n.href),n['media-type']]));
 const chapters=[];
 for(const ref of descendants(opf,'itemref')){
  if(ref.attributes?.linear==='no')continue;const item=manifest.get(ref.attributes?.idref);if(!item?.href||!['application/xhtml+xml','text/html'].includes(item['media-type']))continue;
  const file=zipPath(opfPath,item.href),entry=zip.file(file);if(!entry)continue;const xhtml=parseXml(await entry.async('string'),adapters),body=descendants(xhtml,'body')[0]||xhtml;
  const blocks=await extractBlocks(body,async src=>{const f=zipPath(file,src);return resourceImage(zip,f,imageTypes.get(f)||'');});if(!blocks.length)continue;
  chapters.push({title:blocks.find(b=>b.type==='heading')?.text||`第 ${chapters.length+1} 章`,blocks});
 }
 if(!chapters.length)throw new Error('EPUB 中没有可读取的章节；加密或固定版式电子书可能需要先转换');return {title,author,chapters,format:'EPUB'};
}
async function fb2(bytes,name,adapters){
 const tree=parseXml(decodeText(bytes),adapters),title=plain(text(descendants(tree,'book-title')[0]))||name,images=new Map();
 for(const b of descendants(tree,'binary')){const a=b.attributes||{},s=text(b).replace(/\s/g,'');if(allowedImage.test(a['content-type']||'')&&s.length<16*1024*1024&&/^[A-Za-z\d+/=]*$/.test(s))images.set(a.id,'data:'+a['content-type']+';base64,'+s);}
 const chapters=[];for(const body of descendants(tree,'body')){if(body.attributes?.name==='notes')continue;const sections=elements(body).filter(n=>local(n.name)==='section');for(const n of sections.length?sections:[body]){const blocks=await extractBlocks(n,async src=>images.get(src.replace(/^#/,''))||null);if(blocks.length)chapters.push({title:plain(text(descendants(n,'title')[0]))||`第 ${chapters.length+1} 章`,blocks});}}
 if(!chapters.length)throw new Error('FB2 中没有可读取的正文');return {title,author:'',chapters,format:'FB2'};
}
async function cbz(bytes,name,adapters){inspectZip(bytes);const ZIP=adapters.JSZip||globalThis.JSZip;const zip=await ZIP.loadAsync(bytes);const files=Object.keys(zip.files).filter(f=>/\.(png|jpe?g|webp|gif)$/i.test(f)&&!zip.files[f].dir).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));const chapters=[];for(const f of files){const ext=f.split('.').at(-1).toLowerCase(),mime='image/'+(ext==='jpg'?'jpeg':ext);const src=await resourceImage(zip,f,mime);if(src)chapters.push({title:`第 ${chapters.length+1} 页`,blocks:[{type:'image',src}]});}if(!chapters.length)throw new Error('CBZ 中没有可读取的图片');return {title:name,author:'',chapters,format:'CBZ'};}
export async function parseBook(bytes,name,format,adapters={}){
 bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);format=format.toLowerCase();name=name.replace(/\.[^.]+$/,'');
 if(format==='epub')return epub(bytes,name,adapters);if(format==='fb2')return fb2(bytes,name,adapters);if(format==='cbz')return cbz(bytes,name,adapters);
 let s=decodeText(bytes);if(s.length>10*1024*1024)throw new Error('文本内容超过 1000 万字符，请先拆分');
 if(format==='html'||format==='htm'){
  if(typeof DOMParser==='undefined')throw new Error('HTML 阅读需要桌面渲染环境');const d=new DOMParser().parseFromString(s,'text/html');d.querySelectorAll('script,style,iframe,object,nav').forEach(n=>n.remove());s=d.body.innerText||d.body.textContent||'';
 }
 const blocks=s.replace(/\r\n?/g,'\n').split(/\n+/).map(plain).filter(Boolean).map(t=>({type:/^(第[〇零一二三四五六七八九十百千\d]+[章节回部卷]|chapter\s+\d+|#{1,3}\s)/i.test(t)?'heading':'paragraph',text:t}));
 if(!blocks.length)throw new Error('文本文件没有正文');return {title:name,author:'',format:format.toUpperCase(),chapters:[{title:name,blocks}]};
}
export function imageFor(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('电子书插图读取失败'));image.src=src;});}
export async function paginateBook(book,adapters={}){
 const canvas=adapters.createCanvas?.()||document.createElement('canvas'),ctx=canvas.getContext('2d'),loadImage=adapters.loadImage||imageFor;const pages=[],width=595.28,height=841.89,margin=46,bottom=height-58,contentWidth=width-margin*2;
 let current,y;
 const next=(chapter)=>{if(pages.length>=2000)throw new Error('电子书分页超过 2000 页，请先拆分');current={...newPage('blank'),reading:{bookTitle:book.title,chapter,blocks:[],number:pages.length+1}};pages.push(current);y=89;};
 for(const chapter of book.chapters){next(chapter.title);for(const block of chapter.blocks){
  if(block.type==='image'){
   const image=await loadImage(block.src),ratio=Math.min(contentWidth/image.width,(bottom-110)/image.height,1.5),w=image.width*ratio,h=image.height*ratio;if(y+h>bottom&&current.reading.blocks.length)next(chapter.title);current.reading.blocks.push({type:'image',src:block.src,x:margin+(contentWidth-w)/2,y,w,h});y+=h+20;continue;
  }
  const size=block.type==='heading'?23:15.5,lineHeight=block.type==='heading'?36:27;ctx.font=`${block.type==='heading'?'600 ':''}${size}px "Segoe UI","Microsoft YaHei",sans-serif`;let line='';const lines=[];
  for(const ch of [...block.text]){if(ctx.measureText(line+ch).width>contentWidth&&line){lines.push(line);line='';}line+=ch;}if(line)lines.push(line);
  if(block.type==='heading'&&y+lineHeight*2>bottom&&current.reading.blocks.length)next(chapter.title);
  for(const t of lines){if(y+lineHeight>bottom)next(chapter.title);current.reading.blocks.push({type:'line',text:t,x:margin,y,size,heading:block.type==='heading'});y+=lineHeight;}y+=block.type==='heading'?13:12;
 }}
 return pages;
}
const imageCache=new Map();
export async function drawReadingPage(ctx,page,scale=1,adapters={}){
 ctx.save();ctx.scale(scale,scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,page.width,page.height);ctx.fillStyle='#80868b';ctx.font='9px "Segoe UI","Microsoft YaHei",sans-serif';ctx.fillText(page.reading.chapter.slice(0,52),46,37);ctx.strokeStyle='#e3e3e3';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(46,51);ctx.lineTo(page.width-46,51);ctx.stroke();ctx.textBaseline='top';
 for(const b of page.reading.blocks){if(b.type==='line'){ctx.fillStyle=b.heading?'#1f1f1f':'#3c4043';ctx.font=`${b.heading?'600 ':''}${b.size}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.fillText(b.text,b.x,b.y);}else{try{const loader=adapters.loadImage||imageFor;if(!imageCache.has(b.src)){if(imageCache.size>30)imageCache.delete(imageCache.keys().next().value);imageCache.set(b.src,loader(b.src));}const image=await imageCache.get(b.src);ctx.drawImage(image,b.x,b.y,b.w,b.h);}catch{ctx.fillStyle='#9aa0a6';ctx.font='12px sans-serif';ctx.fillText('[插图无法显示]',b.x,b.y);}}}
 ctx.fillStyle='#80868b';ctx.font='9px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.fillText(String(page.reading.number),page.width/2,page.height-32);ctx.restore();
}
export function validateReading(value){
 if(!value||typeof value.bookTitle!=='string'||typeof value.chapter!=='string'||!Array.isArray(value.blocks)||value.blocks.length>600)throw new Error('备份中的电子书页面无效');
 const finite=n=>Number.isFinite(n)&&n>=0&&n<=20000;
 const blocks=value.blocks.map(b=>{if(!finite(b.x)||!finite(b.y))throw new Error('电子书页面位置无效');if(b.type==='line'&&typeof b.text==='string'&&b.text.length<2000&&finite(b.size))return {type:'line',text:b.text,x:b.x,y:b.y,size:b.size,heading:!!b.heading};if(b.type==='image'&&typeof b.src==='string'&&b.src.length<17*1024*1024&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z\d+/=]+$/i.test(b.src)&&finite(b.w)&&finite(b.h))return {type:'image',src:b.src,x:b.x,y:b.y,w:b.w,h:b.h};throw new Error('电子书页面元素无效');});
 return {bookTitle:value.bookTitle.slice(0,300),chapter:value.chapter.slice(0,300),number:Number.isInteger(value.number)&&value.number>0?value.number:1,blocks};
}
