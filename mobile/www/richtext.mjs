// Rich text for canvas text boxes and posts: Markdown (with LaTeX math), pasted/dropped HTML, sanitising,
// and a raster of a box for thumbnails, page pictures and PDF export.
//
// Storage format: a small HTML subset (p, h1–h3, strong, em, u, s, code, pre, mark, sub, sup, br, hr,
// blockquote, ul/ol/li, table rows/cells, a[href], span[style=color]) plus math as
// <span class="math" data-tex="…"> (inline) or <span class="math math-display" data-tex="…"> (display).
// Only the TeX source is stored; KaTeX renders it whenever the box is shown.
import {MarkdownIt,katex} from './vendor/richtext-libs.mjs';

export const RICH_CSS=`.rich{font-family:"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.55;overflow-wrap:anywhere;word-break:normal;white-space:normal;text-align:left}
.rich p,.rich h1,.rich h2,.rich h3,.rich ul,.rich ol,.rich blockquote,.rich pre,.rich table{margin:0 0 .5em}
.rich>:last-child,.rich li>:last-child{margin-bottom:0}
.rich h1{font-size:1.6em;font-weight:700;line-height:1.3}
.rich h2{font-size:1.32em;font-weight:700;line-height:1.35}
.rich h3{font-size:1.12em;font-weight:700}
.rich strong{font-weight:700}
.rich ul,.rich ol{padding-left:1.5em}
.rich li{margin:.12em 0}
.rich li>p{margin:0}
.rich blockquote{padding:.1em 0 .1em .85em;border-left:3px solid #cfc8d8;color:#5c5664}
.rich code{font-family:Consolas,"Cascadia Mono","Courier New",monospace;font-size:.9em;background:#f0ecf4;border-radius:4px;padding:.08em .32em}
.rich pre{background:#f5f2f8;border-radius:8px;padding:.6em .8em;white-space:pre-wrap;line-height:1.45}
.rich pre code{background:none;padding:0;font-size:.88em}
.rich mark{background:#ffeb8a;color:inherit;border-radius:2px;padding:0 .08em}
.rich a{color:#1a62c9;text-decoration:underline}
.rich hr{border:0;border-top:1px solid #d6d0dc;margin:.6em 0}
.rich table{border-collapse:collapse}
.rich td,.rich th{border:1px solid #d6d0dc;padding:.22em .55em;vertical-align:top}
.rich th{background:#f3eff7;font-weight:700}
.rich .math-display{display:block;text-align:center;margin:.35em 0;overflow:hidden}
.rich .katex{font-size:1.08em}
.rich .math-error{color:#b3261e;font-family:Consolas,monospace;font-size:.9em}`;

if(typeof document!=='undefined'&&!document.getElementById('rich-style')){const s=document.createElement('style');s.id='rich-style';s.textContent=RICH_CSS;document.head.append(s);}

// ---------- Markdown with math ----------
const md=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:false});
const OPEN='',CLOSE='';
function closingDollar(s,from){
 if(from>=s.length||/\s/.test(s[from]))return -1;
 for(let j=from;j<s.length;j++){if(s[j]==='\n'&&s[j+1]==='\n')return -1;if(s[j]==='\\'){j++;continue;}if(s[j]==='$'){if(/\s/.test(s[j-1])||/\d/.test(s[j+1]||''))return -1;return j;}}
 return -1;
}
export function extractMath(src){
 const math=[];let out='',i=0;const put=(tex,display)=>{math.push({tex:tex.trim(),display});out+=OPEN+(math.length-1)+CLOSE;};
 while(i<src.length){
  if(src.startsWith('```',i)&&(i===0||src[i-1]==='\n')){const end=src.indexOf('\n```',i+3);const stop=end<0?src.length:(src.indexOf('\n',end+4)<0?src.length:src.indexOf('\n',end+4));out+=src.slice(i,stop);i=stop;continue;}
  if(src[i]==='`'){const j=src.indexOf('`',i+1);if(j>0&&!src.slice(i,j).includes('\n\n')){out+=src.slice(i,j+1);i=j+1;continue;}}
  if(src[i]==='\\'&&(src[i+1]==='['||src[i+1]==='(')){const close=src[i+1]==='['?'\\]':'\\)',j=src.indexOf(close,i+2);if(j>0){put(src.slice(i+2,j),src[i+1]==='[');i=j+2;continue;}}
  if(src[i]==='\\'&&src[i+1]==='$'){out+='\\$';i+=2;continue;}
  if(src.startsWith('$$',i)){const j=src.indexOf('$$',i+2);if(j>0){put(src.slice(i+2,j),true);i=j+2;continue;}}
  if(src[i]==='$'){const j=closingDollar(src,i+1);if(j>0){put(src.slice(i+1,j),false);i=j+1;continue;}}
  out+=src[i];i++;
 }
 return {text:out,math};
}
function mathHTML(tex,display){return `<span class="math${display?' math-display':''}" data-tex="${tex.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}"></span>`;}
export function markdownToHtml(src){
 const {text,math}=extractMath(String(src||'').replace(/\r\n?/g,'\n'));
 let html=md.render(text);
 html=html.replace(new RegExp(`<p>${OPEN}(\\d+)${CLOSE}</p>`,'g'),(_,n)=>`<p>${mathHTML(math[n].tex,true)}</p>`).replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`,'g'),(_,n)=>mathHTML(math[n].tex,math[n].display));
 return sanitizeHtml(html);
}
export function looksLikeMarkdown(s){return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.+\|)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\$[^$\n]+\$|\$\$|\\\(|\\\[|\[[^\]\n]+\]\([^)]+\)/.test(s);}
export function plainToHtml(s){const esc=t=>t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return String(s||'').replace(/\r\n?/g,'\n').split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');}
export function textToHtml(s){return looksLikeMarkdown(s)?markdownToHtml(s):plainToHtml(s);}

// ---------- Sanitising (pasted HTML, Markdown output, edited boxes) ----------
const DROP=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','NOSCRIPT','TEMPLATE','HEAD','META','LINK','TITLE','SVG','CANVAS','VIDEO','AUDIO','BUTTON','INPUT','SELECT','TEXTAREA','FORM','IMG','PICTURE','SOURCE','MAP','AREA','DIALOG']);
const BLOCKS=new Set(['P','DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','FIGURE','FIGCAPTION','ADDRESS','DL','DT','DD','CENTER']);
const SIMPLE={B:'strong',STRONG:'strong',I:'em',EM:'em',CITE:'em',VAR:'em',DFN:'em',U:'u',INS:'u',S:'s',STRIKE:'s',DEL:'s',CODE:'code',KBD:'code',SAMP:'code',TT:'code',MARK:'mark',SUB:'sub',SUP:'sup',H1:'h1',H2:'h2',H3:'h3',H4:'h3',H5:'h3',H6:'h3',BLOCKQUOTE:'blockquote',PRE:'pre',UL:'ul',OL:'ol',LI:'li',TABLE:'table',THEAD:'thead',TBODY:'tbody',TFOOT:'tbody',TR:'tr',TD:'td',TH:'th',HR:'hr',BR:'br'};
const NO_TEXT_CHILDREN=new Set(['UL','OL','TABLE','THEAD','TBODY','TR']);
let colorCtx;
function hexColor(v){
 if(!v||typeof document==='undefined')return null;colorCtx??=document.createElement('canvas').getContext('2d');
 colorCtx.fillStyle='#010203';colorCtx.fillStyle=v;const c=colorCtx.fillStyle;if(c==='#010203'&&!/^#?010203$/i.test(v))return null;
 if(c.startsWith('#'))return {hex:c,a:1};const m=c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);if(!m)return null;
 return {hex:'#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join(''),a:m[4]===undefined?1:+m[4]};
}
function luminance(hex){const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
function texOf(n){
 if(n.matches?.('.math[data-tex]'))return {tex:n.getAttribute('data-tex'),display:n.classList.contains('math-display')};
 if(n.matches?.('.katex,.katex-display,math,mjx-container')){const a=n.querySelector?.('annotation[encoding="application/x-tex"]')||(n.tagName==='ANNOTATION'?n:null);
  if(a)return {tex:a.textContent,display:n.classList?.contains('katex-display')||!!n.closest?.('.katex-display')||n.getAttribute?.('display')==='block'||n.getAttribute?.('display')==='true'};}
 if(n.tagName==='SCRIPT'&&/^math\/tex/i.test(n.getAttribute('type')||''))return {tex:n.textContent,display:/mode=display/i.test(n.getAttribute('type'))};
 return null;
}
function sanitizeInto(src,parent,doc){
 for(const n of [...src.childNodes]){
  if(n.nodeType===3){
   const insidePre=!!parent.closest?.('pre');
   let text=insidePre?n.data:n.data.replace(/[\t\n\r ]+/g,' ');
   if(!insidePre&&!text.trim()&&(NO_TEXT_CHILDREN.has(parent.tagName)||parent===parent.ownerDocument?.body||parent.nodeType===11||!parent.tagName))continue;
   parent.append(doc.createTextNode(text));continue;
  }
  if(n.nodeType!==1)continue;
  const math=texOf(n);if(math&&math.tex?.trim()){const s=doc.createElement('span');s.className='math'+(math.display?' math-display':'');s.setAttribute('data-tex',math.tex.trim().slice(0,4000));parent.append(s);continue;}
  const tag=n.tagName.toUpperCase();if(DROP.has(tag))continue;
  if(tag==='A'){const href=n.getAttribute('href')||'';const a=doc.createElement('a');if(/^(https?:|mailto:)/i.test(href))a.setAttribute('href',href.slice(0,2000));sanitizeInto(n,a,doc);if(a.childNodes.length)parent.append(a);continue;}
  if(BLOCKS.has(tag)){
   const inline=parent.tagName&&/^(P|H1|H2|H3|TD|TH|PRE|STRONG|EM|U|S|CODE|MARK|A|SPAN|SUB|SUP)$/.test(parent.tagName)||parent.tagName==='LI'&&tag!=='P';
   if(inline||[...n.children].some(c=>BLOCKS.has(c.tagName)||SIMPLE[c.tagName]&&/^(h1|h2|h3|ul|ol|table|pre|blockquote|p)$/.test(SIMPLE[c.tagName]))){
    const before=parent.childNodes.length;sanitizeInto(n,parent,doc);if(inline&&parent.childNodes.length>before)parent.append(doc.createElement('br'));continue;
   }
   const p=doc.createElement('p');sanitizeInto(n,p,doc);if(p.textContent.trim()||p.querySelector('.math,br'))parent.append(p);continue;
  }
  let el=null;const mapped=SIMPLE[tag];
  if(mapped)el=doc.createElement(mapped);
  if(el&&(mapped==='td'||mapped==='th'))for(const k of ['colspan','rowspan']){const v=+n.getAttribute(k);if(v>1&&v<=20)el.setAttribute(k,String(v));}
  // styles carried by spans/fonts (and on any element): bold, italic, underline, strike, colour, highlight
  const st=n.style||{},wrap=[];
  if(!mapped||mapped==='strong'||mapped==='em'||mapped==='span'){
   const w=st.fontWeight;if((w==='bold'||+w>=600)&&mapped!=='strong')wrap.push('strong');
   if(st.fontStyle==='italic'&&mapped!=='em')wrap.push('em');
   const deco=(st.textDecorationLine||st.textDecoration||'');if(/underline/.test(deco))wrap.push('u');if(/line-through/.test(deco))wrap.push('s');
  }
  const color=hexColor(st.color||n.getAttribute?.('color'));const bg=hexColor(st.backgroundColor);
  let target=parent;
  for(const w of wrap){const x=doc.createElement(w);target.append(x);target=x;}
  if(color&&color.a>.4&&luminance(color.hex)<.7&&!/^#(000000|1f1f1f|1d1b20|212121|202124)$/i.test(color.hex)&&!el?.matches?.('h1,h2,h3,th')){const s=doc.createElement('span');s.setAttribute('style','color:'+color.hex);target.append(s);target=s;}
  if(bg&&bg.a>.4&&luminance(bg.hex)>.45&&luminance(bg.hex)<.97&&tag!=='TD'&&tag!=='TH'&&tag!=='TR'&&tag!=='TABLE'&&tag!=='PRE'&&tag!=='CODE'){const m=doc.createElement('mark');target.append(m);target=m;}
  if(el){if(mapped==='br'||mapped==='hr'){target.append(el);continue;}target.append(el);sanitizeInto(n,el,doc);
   if(!el.childNodes.length&&!/^(td|th|tr|li)$/.test(mapped))el.remove();}
  else sanitizeInto(n,target,doc);
  for(let x=target;x&&x!==parent&&!x.childNodes.length;){const up=x.parentNode;x.remove();x=up;}
 }
}
// Wrap loose inline runs at the top level into paragraphs so every box is made of blocks.
function blockify(root,doc){
 let run=null;
 for(const n of [...root.childNodes]){
  const block=n.nodeType===1&&/^(P|H1|H2|H3|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(n.tagName)||n.nodeType===1&&n.matches('.math-display');
  if(block){run=null;continue;}
  if(n.nodeType===3&&!n.data.trim()&&!run){n.remove();continue;}
  if(!run){run=doc.createElement('p');root.insertBefore(run,n);}
  if(n.nodeType===1&&n.tagName==='BR'&&run.childNodes.length&&n.nextSibling?.nodeType===1&&n.nextSibling.tagName==='BR'){n.nextSibling.remove();n.remove();run=null;continue;}
  run.append(n);
 }
 // trim the whitespace that HTML indentation leaves at the start and end of blocks
 root.querySelectorAll('p,h1,h2,h3,li,blockquote,td,th').forEach(b=>{const f=b.firstChild,l=b.lastChild;if(f?.nodeType===3)f.data=f.data.replace(/^\s+/,'');if(l?.nodeType===3)l.data=l.data.replace(/\s+$/,'');});
 root.querySelectorAll('li>p:only-child').forEach(p=>p.replaceWith(...p.childNodes));
 root.querySelectorAll('p').forEach(p=>{while(p.lastChild?.nodeType===1&&p.lastChild.tagName==='BR'&&p.childNodes.length>1)p.lastChild.remove();if(!p.textContent.trim()&&!p.querySelector('.math,br'))p.remove();});
}
export function sanitizeHtml(html){
 if(typeof DOMParser==='undefined')throw new Error('需要浏览器环境');
 const src=new DOMParser().parseFromString('<!doctype html><body>'+String(html||''),'text/html').body;
 const doc=document.implementation.createHTMLDocument(''),root=doc.createElement('div');sanitizeInto(src,root,doc);blockify(root,doc);
 return root.innerHTML.slice(0,400000);
}

// ---------- Showing and editing ----------
export function renderMath(root){
 root.querySelectorAll('.math[data-tex]').forEach(m=>{
  const display=m.classList.contains('math-display');
  try{m.innerHTML=katex.renderToString(m.getAttribute('data-tex'),{displayMode:display,throwOnError:false,output:'html',strict:'ignore',trust:false,maxSize:40,maxExpand:500});}
  catch{m.innerHTML=`<span class="math-error">${m.getAttribute('data-tex').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`;}
  m.setAttribute('contenteditable','false');
 });
}
export function renderInto(el,html){el.innerHTML=html;renderMath(el);}
export function storageFrom(el){const c=el.cloneNode(true);c.querySelectorAll('.math[data-tex]').forEach(m=>{m.textContent='';m.removeAttribute('contenteditable');});return sanitizeHtml(c.innerHTML);}
export function richPlainText(html){
 if(typeof DOMParser==='undefined')return String(html||'').replace(/<[^>]+>/g,' ');
 const b=new DOMParser().parseFromString('<body>'+String(html||''),'text/html').body;b.querySelectorAll('.math[data-tex]').forEach(m=>{m.textContent=' '+m.getAttribute('data-tex')+' ';});
 b.querySelectorAll('p,h1,h2,h3,li,blockquote,pre,tr,br').forEach(x=>x.append('\n'));return b.textContent.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function textToRich(text){return plainToHtml(text);}

// ---------- Measuring and rasterising (thumbnails, page pictures, PDF export) ----------
let measureBox;
export function measureRich(a){
 if(typeof document==='undefined')return a.h||24;
 if(!measureBox){measureBox=document.createElement('div');measureBox.setAttribute('aria-hidden','true');measureBox.style.cssText='position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style';document.body.append(measureBox);}
 const el=document.createElement('div');el.className='rich';el.style.cssText=`width:${a.w}px;font-size:${a.size}px;color:${a.color}`;renderInto(el,a.html);measureBox.append(el);
 const h=Math.ceil(el.offsetHeight);el.remove();return Math.max(h,Math.ceil(a.size*1.55));
}
let katexCss=null;
async function katexInlineCss(){
 katexCss??=(async()=>{
  const base=new URL('./vendor/katex/',import.meta.url),css=await (await fetch(new URL('katex.min.css',base))).text(),files=[...new Set([...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map(m=>m[1]))];
  const data=await Promise.all(files.map(async f=>{const b=new Uint8Array(await (await fetch(new URL(f,base))).arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return [f,'data:font/woff2;base64,'+btoa(s)];}));
  let out=css;for(const [f,u] of data)out=out.split(`url(${f})`).join(`url(${u})`);return out;
 })();
 return katexCss;
}
const rasterCache=new Map();
function rasterKey(a,scale){return `${a.id}|${a.w}|${a.h}|${a.size}|${a.color}|${scale}|${a.html.length}|${hash(a.html)}`;}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
export function cachedRaster(a){for(const s of [3,2,1]){const r=rasterCache.get(rasterKey(a,s));if(r)return r;}return null;}
export async function rasterRich(a,scale=2){
 scale=Math.max(1,Math.min(3,Math.round(scale)));const key=rasterKey(a,scale);if(rasterCache.has(key))return rasterCache.get(key);
 const h=a.h||measureRich(a),w=a.w,doc=document.implementation.createHTMLDocument(''),root=doc.createElement('div');
 root.className='rich';root.setAttribute('style',`width:${w}px;font-size:${a.size}px;color:${a.color};margin:0;padding:0`);renderInto(root,a.html);
 const math=!!root.querySelector('.katex'),css=RICH_CSS+(math?await katexInlineCss():'');
 const xhtml=new XMLSerializer().serializeToString(root);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w*scale)}" height="${Math.ceil(h*scale)}" viewBox="0 0 ${w} ${h}"><style><![CDATA[${css}]]></style><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
 const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
 try{await img.decode();}catch{return null;}
 rasterCache.set(key,img);if(rasterCache.size>240)rasterCache.delete(rasterCache.keys().next().value);
 return img;
}
export async function prepareRich(annotations,scale=2){for(const a of annotations||[])if(a.type==='rich'){if(!a.h)a.h=measureRich(a);await rasterRich(a,scale);}}

// ---------- HTML → Markdown (pasting formatted content into a post, which is stored as Markdown) ----------
export function htmlToMarkdown(html){
 const root=new DOMParser().parseFromString('<body>'+sanitizeHtml(html),'text/html').body;
 const inline=n=>[...n.childNodes].map(c=>{
  if(c.nodeType===3)return c.data.replace(/([*_`\\$])/g,'\\$1');if(c.nodeType!==1)return '';const t=c.tagName,inner=inline(c);
  if(c.matches('.math[data-tex]'))return c.classList.contains('math-display')?`\n$$${c.getAttribute('data-tex')}$$\n`:`$${c.getAttribute('data-tex')}$`;
  if(t==='STRONG')return inner.trim()?`**${inner}**`:inner;if(t==='EM')return inner.trim()?`*${inner}*`:inner;if(t==='S')return inner.trim()?`~~${inner}~~`:inner;
  if(t==='CODE')return '`'+c.textContent+'`';if(t==='BR')return '\n';if(t==='A'){const h=c.getAttribute('href');return h?`[${inner}](${h})`:inner;}
  return inner;}).join('');
 const block=(n,depth=0)=>[...n.childNodes].map(c=>{
  if(c.nodeType===3)return c.data.trim()?c.data:'';if(c.nodeType!==1)return '';const t=c.tagName;
  if(/^H[1-3]$/.test(t))return '#'.repeat(+t[1])+' '+inline(c).trim()+'\n\n';
  if(t==='P')return inline(c).trim()+'\n\n';
  if(t==='PRE')return '```\n'+c.textContent.replace(/\n$/,'')+'\n```\n\n';
  if(t==='BLOCKQUOTE')return block(c,depth).trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
  if(t==='UL'||t==='OL')return [...c.children].map((li,i)=>'  '.repeat(depth)+(t==='OL'?`${i+1}. `:'- ')+[...li.childNodes].map(x=>x.nodeType===1&&/^(UL|OL)$/.test(x.tagName)?'\n'+block({childNodes:[x]},depth+1).trimEnd():x.nodeType===1&&x.tagName==='P'?inline(x):inline({childNodes:[x]})).join('').trim()).join('\n')+'\n\n';
  if(t==='HR')return '---\n\n';
  if(t==='TABLE'){const rows=[...c.querySelectorAll('tr')].map(r=>[...r.children].map(x=>inline(x).replace(/\|/g,'\\|').trim()));if(!rows.length)return '';const w=Math.max(...rows.map(r=>r.length));const line=r=>'| '+[...r,...Array(w-r.length).fill('')].join(' | ')+' |';return [line(rows[0]),'| '+Array(w).fill('---').join(' | ')+' |',...rows.slice(1).map(line)].join('\n')+'\n\n';}
  if(c.matches('.math-display'))return `$$${c.getAttribute('data-tex')}$$\n\n`;
  return inline({childNodes:[c]});}).join('');
 return block(root).replace(/\n{3,}/g,'\n\n').trim();
}
const mdCache=new Map();
// Post body as readable plain text (library card previews): Markdown marks removed, formulas kept as TeX.
export function postPlain(body){return richPlainText(postHtml(String(body||''))).replace(/\s+/g,' ');}
export function postHtml(body){let h=mdCache.get(body);if(h===undefined){h=markdownToHtml(body);mdCache.set(body,h);if(mdCache.size>500)mdCache.delete(mdCache.keys().next().value);}return h;}
