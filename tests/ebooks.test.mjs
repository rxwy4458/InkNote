import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {parseBook,paginateBook,decodeText,zipPath,inspectZip,validateReading} from '../app/ebooks.mjs';
import {newInfinitePage,nonnegative,growExtent,visibleAnnotations,exportTiles,dateLabel} from '../app/infinite.mjs';
const require=createRequire(import.meta.url);
function dep(name){try{return require(name);}catch(e){if(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)return require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,name));throw e;}}
const JSZip=dep('jszip'),{xml2js}=dep('xml-js'),canvas=dep('@napi-rs/canvas');
const adapters={JSZip,xml2js,createCanvas:()=>canvas.createCanvas(1,1),loadImage:canvas.loadImage};

async function sampleEpub(extra={}){
 const z=new JSZip();for(const [k,v] of Object.entries(extra))z.file(k,v);z.file('mimetype','application/epub+zip',{compression:'STORE'});
 z.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
 z.file('OEBPS/book.opf','<package xmlns="http://www.idpf.org/2007/opf"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">墨页测试书</dc:title></metadata><manifest><item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="text/a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
 z.file('OEBPS/text/a.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>这是第一章的正文。</p><script>throw new Error("must never run")</script></body></html>');
 z.file('OEBPS/text/b.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1><p>这是第二章的正文。</p></body></html>');
 return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
test('EPUB 按 spine 顺序读取章节，排除脚本并保留中文标题',async()=>{
 const book=await parseBook(await sampleEpub(),'example.epub','epub',adapters);
 assert.equal(book.title,'墨页测试书');assert.deepEqual(book.chapters.map(c=>c.title),['第一章','第二章']);
 assert.ok(!JSON.stringify(book).includes('must never run'));
 const pages=await paginateBook(book,adapters);assert.equal(pages.length,2);assert.equal(pages[0].reading.chapter,'第一章');assert.equal(pages[1].reading.chapter,'第二章');assert.match(JSON.stringify(pages),/第二章的正文/);
});
test('TXT 支持 UTF-8、UTF-16 与常见中文 GBK 编码',async()=>{
 assert.equal(decodeText(new TextEncoder().encode('中文笔记')),'中文笔记');
 assert.equal(decodeText(new Uint8Array([0xff,0xfe,0x2d,0x4e,0x87,0x65])),'中文');
 assert.equal(decodeText(new Uint8Array([0xd6,0xd0,0xce,0xc4])),'中文');
 const book=await parseBook(new TextEncoder().encode('第一章\n\n正文段落\n下一段'),'notes.txt','txt',adapters);assert.equal(book.chapters[0].blocks.length,3);
});
test('FB2 可读取正文和书名',async()=>{
 const book=await parseBook(new TextEncoder().encode('<FictionBook><description><title-info><book-title>我的电子书</book-title></title-info></description><body><section><title><p>开始</p></title><p>这一段是正文。</p></section></body></FictionBook>'),'book.fb2','fb2',adapters);
 assert.equal(book.title,'我的电子书');assert.match(JSON.stringify(book.chapters),/这一段是正文/);
});
test('出版方 DRM 的 EPUB 给出明确说明；只做了字体混淆的 EPUB 照常打开',async()=>{
 const enc=alg=>`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/a.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
 await assert.rejects(parseBook(await sampleEpub({'META-INF/encryption.xml':enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc'),'META-INF/rights.xml':'<adept:rights xmlns:adept="http://ns.adobe.com/adept"/>'}),'drm.epub','epub',adapters),/版权保护（DRM）/);
 await assert.rejects(parseBook(await sampleEpub({'META-INF/encryption.xml':enc('http://www.w3.org/2001/04/xmlenc#aes256-cbc')}),'lcp.epub','epub',adapters),/版权保护（DRM）/);
 const book=await parseBook(await sampleEpub({'META-INF/encryption.xml':enc('http://www.idpf.org/2008/embedding')}),'fonts.epub','epub',adapters);assert.equal(book.chapters.length,2);
});
test('EPUB 资源地址不能跳出容器，异常压缩大小被拒绝',async()=>{
 assert.equal(zipPath('OEBPS/text/a.xhtml','../images/a.png'),'OEBPS/images/a.png');
 assert.throws(()=>zipPath('book.opf','../../outside'),/范围/);assert.throws(()=>zipPath('book.opf','https://example.com/a'),/地址/);
 const bytes=await sampleEpub(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=-1;for(let i=0;i<bytes.length-46;i++)if(v.getUint32(i,true)===0x02014b50){at=i;break;}assert.ok(at>=0);v.setUint32(at+24,0x30000000,true);assert.throws(()=>inspectZip(bytes),/1 GB|64 MB/);
});
test('电子书长文本分页后保留全部字符且版面范围有效',async()=>{
 const value='这是用来验证分页的内容。'.repeat(1400);const pages=await paginateBook({title:'长书',chapters:[{title:'正文',blocks:[{type:'paragraph',text:value}]}]},adapters);
 assert.ok(pages.length>5);assert.equal(pages.flatMap(p=>p.reading.blocks).map(b=>b.text).join(''),value);
 for(const p of pages){assert.ok(p.reading.blocks.every(b=>b.y<800));assert.ok(validateReading(p.reading));}
});
test('无限画布向右、向下扩展，左上坐标始终非负',()=>{
 const p=newInfinitePage();assert.deepEqual(nonnegative({x:-10,y:-40,p:.8}),{x:0,y:0,p:.8});
 assert.equal(growExtent(p,120000,240000),true);assert.ok(p.width>120000&&p.height>240000);assert.equal(growExtent(p,0,0),false);
 const annotations=[{type:'rect',x:10,y:10,w:20,h:20,width:1},{type:'rect',x:90000,y:80000,w:50,h:50,width:1}];
 assert.equal(visibleAnnotations(annotations,{x:0,y:0,w:800,h:600}).length,1);
});
test('日期和无限画布导出按实际内容分页',()=>{
 assert.equal(dateLabel('2026-11-03'),'2026年11月3日');assert.throws(()=>dateLabel('2026-02-30'),/无效/);
 const p=newInfinitePage();assert.equal(exportTiles(p).length,1);p.annotations=[{type:'rect',x:630,y:900,w:80,h:60,width:2}];assert.equal(exportTiles(p).length,4);
});
