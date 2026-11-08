import {icon} from './icons.mjs';
import {writeZip,readZip,readEntry,isZip} from './bundle.mjs';
import {renderInto,renderMath,storageFrom,sanitizeHtml,markdownToHtml,textToHtml,plainToHtml,richPlainText,extractMath,measureRich,prepareRich,cachedRaster,htmlToMarkdown,postHtml,postPlain} from './richtext.mjs';
import {uid,escapeHTML as E,clamp,COLORS,MARKERS,newPage,bounds,inside,intersects,hitAnnotation,translate,drawAnnotation,distanceToSegment,PAPER,setRichPainter} from './core.mjs';
setRichPainter(cachedRaster);
import {store} from './storage.mjs';
import {newInfinitePage,nonnegative,growExtent,visibleAnnotations,drawInfinitePaper,dateLabel,contentExtent,setPaperAccent,pageHeader,SPACINGS} from './infinite.mjs';
import {parseBook,paginateBook,validateReading,DIRECT_BOOK_FORMATS,CONVERT_BOOK_FORMATS} from './ebooks.mjs';
import {formatTimestamp,roots,threadNodes,commentPosition,addThread,replyTo,editComment,removeComment,commentTree,validateComments} from './comments.mjs';
import {readCommentImage} from './comment-images.mjs';
import {renderCommentTree} from './comment-tree-view.mjs';
import {createDiscussion,discussionStats,matchingThreads,discussionDraft,ensureDiscussionFloors,publishDiscussionDraft,discussionLayout} from './discussion.mjs';
import {readPdf,documentPdf,cachePdf,releasePdfs,renderBackground,exportPdf,pdfTextMatches,background} from './pdf.mjs';
import {PRESETS,VARIANTS,MODES,DEFAULT_THEME,applyTheme,currentTheme,swatch} from './theme.mjs';

const $=s=>document.querySelector(s);
const app=$('#app'),view=$('#view'),modal=$('#modal'),modalForm=$('#modal-form');
// Split view: the right pane is a second, independent instance of this page (index.html?pane=split&doc=ID).
// Each side edits and saves its own note; the same note is never open on both sides.
const params=new URLSearchParams(location.search),EMBED=params.get('pane')==='split'&&window.parent!==window,EMBED_DOC=EMBED?params.get('doc'):null;
const host=()=>EMBED?window.parent.__inknoteHost:null;
const S={accent:{primary:'#65558f',tertiary:'#7e5260'},theme:null,toolbarDock:'bottom',scrollMode:'continuous',eraserMode:'stroke',eraserSize:18,clipboard:null,editingText:null,split:null,splitRatio:.5,docs:[],folders:['学习','工作','个人'],view:'all',query:'',sort:'updated',list:false,active:null,tabs:[],page:0,tool:'pen',color:COLORS[0],marker:MARKERS[0],width:2.3,markerWidth:16,textSize:17,penOnly:false,zoom:1,sidebar:true,selection:new Set(),pdf:null,renderEpoch:0,find:[],findIndex:0,findQuery:'',findOpen:false,commentsOpen:false,commentDraft:null,activeThread:null,collapsedThreads:new Set()};
const history=new Map(),pending=new Map();let saveTimer,saveChain=Promise.resolve(),saving=0,saveError=false,gesture=null,textarea=null,importing=false,closing=false,thumbObserver,navigation=0,viewportObserver,viewportFrame;
const doc=()=>S.docs.find(d=>d.id===S.active);
const page=()=>doc()?.pages[S.page];
function pageSnapshot(){return doc().pages.map(p=>({...p,annotations:structuredClone(p.annotations),comments:structuredClone(p.comments||[])}));}
function toast(message,error=false){const el=document.createElement('div');el.className='toast'+(error?' error':'');el.innerHTML=icon(error?'info':'check')+`<span>${E(message)}</span>`;$('#toasts').append(el);setTimeout(()=>el.remove(),error?7000:3200);}
function failure(e){console.error(e);toast(e?.message||'操作未完成，请重试。',true);}
function run(fn){return Promise.resolve().then(fn).catch(failure);}
function status(){const el=$('#save-status');if(el){el.innerHTML=saveError?icon('info')+'<span>保存失败，按 Ctrl+S 重试</span>':saving||pending.size?'<i class="loading-inline"></i><span>正在保存…</span>':icon('check')+'<span>已保存</span>';el.classList.toggle('error',saveError);el.title=saveError?'保存失败':'笔记保存在本机';}}
function save(touch=true){const d=doc();if(!d)return;if(touch)d.updatedAt=Date.now();pending.set(d.id,d);clearTimeout(saveTimer);status();saveTimer=setTimeout(()=>run(flush),120);}
async function flush(){
 clearTimeout(saveTimer);const entries=[...pending];pending.clear();if(!entries.length)return saveChain;
 saving++;status();const job=async()=>{let failed=false;for(const [id,d] of entries){try{await store.save(d);}catch(e){pending.set(id,d);failed=true;}}saveError=failed;if(failed)throw new Error('本机保存失败。请检查磁盘空间，并导出备份。');};
 saveChain=saveChain.catch(()=>{}).then(job);
 try{await saveChain;if(EMBED)for(const [id] of entries){try{host()?.docSaved?.(id);}catch{}}}finally{saving--;status();}
}
function remember(before){const d=doc();if(!d)return;const h=history.get(d.id)||{undo:[],redo:[]};h.undo.push(before);if(h.undo.length>40)h.undo.shift();h.redo=[];history.set(d.id,h);if(page().infinite){const e=contentExtent(page());growExtent(page(),e.width,e.height);}save();refreshHistory();updateThumb(S.page);updatePageCount();renderComments();if(doc().kind==='discussion')refreshDiscussionStats();}
async function undo(redo=false){finishText();const h=history.get(S.active);if(!h)return;const from=redo?h.redo:h.undo,to=redo?h.undo:h.redo;if(!from.length)return;to.push(pageSnapshot());doc().pages=from.pop();S.page=clamp(S.page,0,doc().pages.length-1);S.selection.clear();save();if(doc().kind==='discussion'){S.commentDraft=discussionDraft(page());renderComments();refreshHistory();refreshDiscussionStats();return;}renderThumbList();await showPage();refreshHistory();}
function refreshHistory(){const h=history.get(S.active);const u=$('[data-action="undo"]'),r=$('[data-action="redo"]');if(u)u.disabled=!h?.undo.length;if(r)r.disabled=!h?.redo.length;}
function relative(t){const diff=Math.max(0,Date.now()-t);if(diff<60000)return '刚刚编辑';if(diff<3600000)return `${Math.floor(diff/60000)} 分钟前`;if(diff<86400000)return `${Math.floor(diff/3600000)} 小时前`;return new Date(t).toLocaleDateString('zh-CN',{month:'short',day:'numeric'});}
function modalShell(title,content,subtitle=''){return `<div class="modal-head"><h2>${E(title)}</h2><button type="button" class="icon-btn" data-modal-close aria-label="关闭" title="关闭 (Esc)">${icon('close')}</button></div>${subtitle?`<p class="modal-subtitle">${E(subtitle)}</p>`:''}${content}`;}
function closeModal(){modal.close();modalForm.onsubmit=null;}
function dialog(title,content,{subtitle='',submit}={}){if(modal.open)closeModal();modal.classList.remove('image-lightbox');$('#modal-content').innerHTML=modalShell(title,content,subtitle);modal.showModal();modalForm.onsubmit=e=>{e.preventDefault();if(submit)run(()=>submit(new FormData(modalForm)));};modal.querySelector('[data-modal-close]')?.addEventListener('click',closeModal);modal.querySelectorAll('[data-cancel]').forEach(x=>x.addEventListener('click',closeModal));setTimeout(()=>modal.querySelector('input:not([type=hidden]),textarea,select')?.focus(),50);}
function actions(ok='保存',danger=false){return `<div class="modal-actions"><button class="btn ghost" type="button" data-cancel>取消</button><button class="btn ${danger?'danger':'primary'}" type="submit">${E(ok)}</button></div>`;}
function ask(title,label,value='',{type='text',ok='保存'}={}){return new Promise(resolve=>{dialog(title,`<label class="field-label" for="answer">${E(label)}</label><input class="field-input" id="answer" name="answer" type="${type}" value="${E(value)}" required maxlength="160" autocomplete="off">${actions(ok)}`,{submit:f=>{const v=f.get('answer').trim();if(v){closeModal();resolve(v);}}});modal.addEventListener('close',function closed(){if(modal.open)return;modal.removeEventListener('close',closed);resolve(null);});});}
async function passwordPrompt(retry){return ask(retry?'密码不正确':'这份 PDF 需要密码',retry?'请重新输入打开密码':'输入密码后在本机打开','',{type:'password',ok:'打开 PDF'});}

const NAV_MAIN=[['all','home','全部笔记'],['recent','clock','最近打开'],['favorites','star','已收藏']];
const NAV_KINDS=[['time','time','时间画布'],['plain','draw','普通画布'],['discussion','post','帖子与评论'],['reading','reading','PDF 与电子书']];
const TONES=['olive','sand','blue','pink'];
function inView(d,view){
 if(view==='all')return true;if(view==='recent')return !!d.lastOpened;if(view==='favorites')return !!d.favorite;
 if(view==='discussion')return d.kind==='discussion';if(view==='reading')return d.kind==='pdf'||d.kind==='ebook';
 if(view==='time')return d.kind==='notebook'&&d.canvasType==='time';if(view==='plain')return d.kind==='notebook'&&d.canvasType!=='time';
 return view.startsWith('folder:')&&d.folder===view.slice(7);
}
function viewTitle(view){return Object.fromEntries([...NAV_MAIN,...NAV_KINDS].map(([v,,l])=>[v,l]))[view]||(view.startsWith('folder:')?view.slice(7):'全部笔记');}
function typeInfo(d){
 if(d.kind==='discussion')return {label:'帖子',icon:'post',key:'post'};
 if(d.kind==='pdf')return {label:'PDF',icon:'file',key:'pdf'};
 if(d.kind==='ebook')return {label:d.format||'电子书',icon:'reading',key:'book'};
 return d.canvasType==='time'?{label:'时间画布',icon:'time',key:'time'}:{label:'普通画布',icon:'draw',key:'plain'};
}
function typeIcon(d,extra=''){const t=typeInfo(d);return `<span class="type-icon t-${t.key} ${extra}" aria-hidden="true">${icon(t.icon)}</span>`;}
function stampParts(time){const f=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));const v=t=>f.find(p=>p.type===t)?.value||'';return {md:`${+v('month')}月${+v('day')}日`,y:v('year')};}
function greeting(){const h=new Date().getHours();return h<5?'夜深了':h<9?'早上好':h<12?'上午好':h<14?'中午好':h<18?'下午好':'晚上好';}
function navItem([value,ic,label]){const count=value==='recent'?'':S.docs.filter(d=>inView(d,value)).length;return `<button class="nav-item ${S.view===value?'active':''}" data-action="view" data-value="${value}" ${S.view===value?'aria-current="page"':''}><span class="nav-indicator">${icon(ic)}</span><span class="nav-label">${label}</span><span class="nav-count">${count||''}</span></button>`;}
function createTiles(){return `<section class="quick-tiles" aria-label="新建">
 <button class="qs-tile tile-time" data-action="new" data-value="time"><span class="qs-icon">${icon('time')}</span><span class="qs-text"><strong>时间画布</strong><small>自动记录日期和时间</small></span></button>
 <button class="qs-tile tile-plain" data-action="new" data-value="plain"><span class="qs-icon">${icon('draw')}</span><span class="qs-text"><strong>普通画布</strong><small>可手动插入日期</small></span></button>
 <button class="qs-tile tile-post" data-action="new-discussion"><span class="qs-icon">${icon('post')}</span><span class="qs-text"><strong>发帖子</strong><small>多楼层逐层回复</small></span></button>
 <button class="qs-tile tile-import" data-action="import"><span class="qs-icon">${icon('upload')}</span><span class="qs-text"><strong>导入阅读</strong><small>PDF · EPUB · TXT</small></span></button>
</section>`;}
function newCardFor(view){
 const spec={time:['new','time','新建时间画布','自动记录日期和时间'],plain:['new','plain','新建普通画布','无限画布或 A4 分页'],discussion:['new-discussion','','新建帖子','主楼 · 日期时间 · 楼中楼'],reading:['import','','导入 PDF 或电子书','EPUB · TXT · FB2 · CBZ …']}[view]||(view.startsWith('folder:')?['new','','在此文件夹新建画布','时间画布或普通画布']:null);
 if(!spec)return '';const [action,value,label,sub]=spec;
 return `<button class="new-card" data-action="${action}" ${value?`data-value="${value}"`:''}><span class="new-plus cookie">${icon(action==='import'?'upload':'plus')}</span><strong>${label}</strong><small>${sub}</small></button>`;
}
function emptyFor(view){
 const text={recent:['还没有打开过笔记','打开过的笔记会按时间出现在这里。'],favorites:['还没有收藏','在笔记的「⋮」菜单里选择「收藏」。'],all:['从一页纸开始','新建一个画布或帖子，或者把 PDF 拖进窗口。']}[view];
 return text?`<div class="empty-state"><span class="empty-art cookie">${icon(view==='favorites'?'star':view==='recent'?'clock':'spark')}</span><h3>${text[0]}</h3><p>${text[1]}</p></div>`:'';
}
async function refreshStorage(){
 const est=await navigator.storage?.estimate?.().catch(()=>null);const bar=$('#storage-bar'),text=$('#storage-text');if(!bar||!text||!est)return;
 const used=(est.usage||0)/1024/1024;bar.style.width=Math.min(100,Math.max(2,(est.usage||0)/(est.quota||1)*100))+'%';text.textContent=`已使用 ${used<10?used.toFixed(1):Math.round(used)} MB · 仅存本机`;
}
function renderLibrary(){
 queueMicrotask(placeToolbar);S.active=null;S.renderEpoch++;gesture=null;thumbObserver?.disconnect();viewportObserver?.disconnect();
 const q=S.query.toLocaleLowerCase();
 const matches=new Map(),filtered=S.docs.filter(d=>{if(!inView(d,S.view))return false;const m=matchDoc(d,q);if(m.snippet)matches.set(d.id,m.snippet);return m.ok;});
 filtered.sort((a,b)=>S.sort==='title'?a.title.localeCompare(b.title,'zh-CN'):S.sort==='created'?b.createdAt-a.createdAt:S.view==='recent'?b.lastOpened-a.lastOpened:b.updatedAt-a.updatedAt);
 const title=viewTitle(S.view),home=S.view==='all'&&!S.query;
 const date=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
 const newCard=!S.query?newCardFor(S.view):'';
 const empty=!filtered.length?(S.query?`<div class="empty-state"><span class="empty-art cookie">${icon('search')}</span><h3>没有找到“${E(S.query)}”</h3><p>已搜索笔记标题、页面标题、文字、批注和帖子内容。PDF 原文请打开后按 Ctrl F 查找。</p></div>`:emptyFor(S.view)):'';
 view.innerHTML=`<aside class="nav-drawer">
 <div class="sidebar-brand drag"><img class="brand-logo" src="icon.svg" alt="" aria-hidden="true"><span class="brand-name">墨页</span></div>
 <div class="sidebar-new"><button class="fab extended" data-action="new-chooser" title="新建画布、帖子或导入文件">${icon('edit')}<span>新建</span></button></div>
 <nav class="side-nav" aria-label="笔记分类">${NAV_MAIN.map(navItem).join('')}
  <div class="side-label">分类</div>${NAV_KINDS.map(navItem).join('')}
  <div class="side-label">文件夹<button class="icon-btn tiny" data-action="new-folder" title="新建文件夹" aria-label="新建文件夹">${icon('plus')}</button></div>
  ${S.folders.map((f,i)=>`<button class="nav-item ${S.view==='folder:'+f?'active':''}" data-action="view" data-value="folder:${E(f)}"><span class="nav-indicator folder-${i%4}">${icon('folder')}</span><span class="nav-label">${E(f)}</span><span class="nav-count">${S.docs.filter(d=>d.folder===f).length||''}</span></button>`).join('')}
 </nav>
 <div class="sidebar-foot" title="笔记保存在这台电脑的应用数据中，换电脑前请导出 .inknote 备份"><div class="storage-label">${icon('storage')}<span>本机存储</span></div><div class="storage-bar"><span id="storage-bar"></span></div><small id="storage-text">笔记只保存在这台电脑</small><button type="button" class="exchange-status" id="exchange-status" data-action="exchange"><span class="exchange-icon">${icon('folder')}</span><span class="exchange-text">一键导入导出</span></button></div>
</aside>
<main class="library">
 <header class="library-top drag"><label class="search-bar">${icon('search')}<input id="library-search" type="search" placeholder="搜索笔记标题和内容" aria-label="搜索笔记标题和内容" value="${E(S.query)}" autocomplete="off"><kbd>Ctrl K</kbd></label><span class="spacer"></span><button class="icon-btn" data-action="theme" title="配色与外观" aria-label="配色与外观">${icon('palette')}</button><button class="icon-btn" data-action="import" title="导入 PDF、电子书或 .inknote 备份" aria-label="导入">${icon('upload')}</button><button class="icon-btn" data-action="help" title="快捷键与帮助" aria-label="帮助">${icon('help')}</button><button class="icon-btn" data-action="settings" title="设置" aria-label="设置">${icon('gear')}</button></header>
 <div class="library-scroll"><div class="library-content">
  <div class="page-heading">${home?`<p class="heading-kicker">${E(date)}</p><h1 class="display">${greeting()}</h1>`:`<h1 class="headline">${E(S.query?'搜索结果':title)}</h1>`}</div>
  ${home?createTiles():''}
  <div class="section-row"><h2 class="section-title">${S.query?`“${E(S.query)}”`:home?'最近的笔记':''}</h2><span class="result-count">${filtered.length} 项</span><span class="spacer"></span>
   <label class="sort-select">${icon('down')}<select id="sort-select" aria-label="排序方式"><option value="updated" ${S.sort==='updated'?'selected':''}>${S.view==='recent'?'最近打开':'最近编辑'}</option><option value="created" ${S.sort==='created'?'selected':''}>创建时间</option><option value="title" ${S.sort==='title'?'selected':''}>名称</option></select></label>
   <div class="button-group" role="group" aria-label="显示方式"><button class="${!S.list?'selected':''}" data-action="layout" data-value="grid" title="网格" aria-label="网格视图" aria-pressed="${!S.list}">${icon('grid')}</button><button class="${S.list?'selected':''}" data-action="layout" data-value="list" title="列表" aria-label="列表视图" aria-pressed="${S.list}">${icon('list')}</button></div>
  </div>
  <div class="documents-grid ${S.list?'list-mode':''}" id="documents">${newCard}${filtered.map(d=>card(d,matches.get(d.id))).join('')}${empty}</div>
 </div></div>
</main>`;
 $('#library-search').addEventListener('input',e=>{const p=e.target.selectionStart;S.query=e.target.value;renderLibrary();const input=$('#library-search');input.focus();try{input.setSelectionRange(p,p);}catch{}});
 $('#sort-select').onchange=e=>{S.sort=e.target.value;renderLibrary();};refreshExchangeBadge();
 run(refreshStorage);
}
function preview(d){
 const p=d.pages[0]||{};
 if(d.kind==='discussion'){const first=roots(p).slice().sort((a,b)=>(a.floorNumber||0)-(b.floorNumber||0))[0];const text=postPlain((first?.body||'').slice(0,1200));const pics=(first?.images||[]).length;const s=discussionStats(d);return `<div class="pv pv-post"><div class="pv-post-head"><span class="pv-avatar cookie">我</span><span class="pv-floor">1楼</span></div><p>${E(text.slice(0,140))||(pics?`${pics} 张图片`:'')}</p><span class="pv-post-stats">${s.threads} 个楼层 · ${s.replies} 条回复</span></div>`;}
 if(d.kind==='pdf')return `<div class="pv pv-pdf"><div class="pv-sheet"><i></i><i></i><i></i><i class="pv-mark"></i><i></i><i></i><i></i></div></div>`;
 if(d.kind==='ebook')return `<div class="pv pv-book"><div class="pv-cover"><span>${E(d.format||'BOOK')}</span><strong>${E(d.title)}</strong>${d.author?`<small>${E(d.author)}</small>`:''}</div></div>`;
 const tone=TONES.includes(d.color)?d.color:'olive',paper=['blank','ruled','grid','dot','guide'].includes(p.template)?p.template:'blank';
 const stamp=d.canvasType==='time'?stampParts(p.canvasCreatedAt||d.createdAt):null;
 return `<div class="pv pv-note tone-${tone} paper-${paper}">${stamp?`<span class="pv-stamp">${icon('time')}${stamp.md}</span>`:''}${d.guide?`<span class="pv-stamp">${icon('spark')}使用指南</span>`:''}</div>`;
}
function card(d,snippet){
 const t=typeInfo(d),stats=d.kind==='discussion'?discussionStats(d):null;
 const amount=stats?`${stats.threads} 楼 · ${stats.replies} 回复`:`${d.pages.length} 页`;
 return `<article class="doc-card" tabindex="0" role="button" aria-label="打开 ${E(d.title)}" data-action="open" data-id="${d.id}">
 <div class="doc-preview">${preview(d)}${d.favorite?`<span class="doc-fav" title="已收藏">${icon('star')}</span>`:''}</div>
 <div class="doc-info">${typeIcon(d)}<div class="doc-text"><h3 class="doc-name">${E(d.title)}</h3><div class="doc-meta"><span>${E(t.label)}</span><span>${amount}</span><span>${relative(d.updatedAt)}</span><span class="doc-folder">${E(d.folder||'未分类')}</span></div>${snippet?`<p class="doc-snippet">${E(snippet.pre)}<mark>${E(snippet.hit)}</mark>${E(snippet.post)}</p>`:''}</div><button class="icon-btn doc-menu" data-action="doc-menu" data-id="${d.id}" title="更多操作" aria-label="${E(d.title)} 的更多操作">${icon('more-v')}</button></div>
</article>`;
}
const TEMPLATES=[['blank','空白'],['ruled','横线'],['grid','方格'],['dot','点阵']];
function templateChoices(template){return `<div class="template-grid" role="radiogroup" aria-label="内页样式">${TEMPLATES.map(([v,l])=>`<button type="button" class="template-choice ${v===template?'active':''}" data-template="${v}" role="radio" aria-checked="${v===template}"><div class="template-preview ${v}"></div><span>${l}</span></button>`).join('')}</div>`;}
function bindChoices(attr,set){modal.querySelectorAll(`[data-${attr}]`).forEach(b=>b.onclick=()=>{set(b.getAttribute('data-'+attr));modal.querySelectorAll(`[data-${attr}]`).forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-checked',x===b);});});}
function pageModeChoice(mode='infinite'){return `<div class="segmented" role="radiogroup" aria-label="纸张范围"><label><input type="radio" name="mode" value="infinite" ${mode==='infinite'?'checked':''}><span>${icon('check')}无限画布</span></label><label><input type="radio" name="mode" value="paged" ${mode==='paged'?'checked':''}><span>${icon('check')}A4 分页</span></label></div>`;}
async function newNotebook(kind){
 let template='dot',color='olive',canvasType=kind==='time'||kind==='plain'?kind:S.view==='plain'?'plain':'time';
 dialog('新建画布',`<label class="field-label" for="note-name">名称</label><input class="field-input" id="note-name" name="title" placeholder="给这本笔记起个名字" value="未命名笔记" maxlength="100" required autocomplete="off">
 <div class="field-label">画布类型</div><div class="choice-cards" role="radiogroup" aria-label="画布类型">
  <button type="button" class="choice-card ${canvasType==='time'?'active':''}" data-canvas-kind="time" role="radio" aria-checked="${canvasType==='time'}"><span class="choice-icon">${icon('time')}</span><span><strong>时间画布</strong><small>创建时自动写入日期和时间，新增页也会标记</small></span></button>
  <button type="button" class="choice-card ${canvasType==='plain'?'active':''}" data-canvas-kind="plain" role="radio" aria-checked="${canvasType==='plain'}"><span class="choice-icon">${icon('draw')}</span><span><strong>普通画布</strong><small>不带时间，需要时用「日期」按钮插入</small></span></button>
 </div>
 <div class="field-row"><div><div class="field-label">纸张范围</div>${pageModeChoice('infinite')}</div><div><label class="field-label" for="note-folder">文件夹</label><select class="field-input" name="folder" id="note-folder"><option value="">未分类</option>${S.folders.map(f=>`<option value="${E(f)}" ${S.view==='folder:'+f?'selected':''}>${E(f)}</option>`).join('')}</select></div></div>
 <p class="field-hint">无限画布从左上角开始，随内容向右、向下延伸；A4 分页适合打印。</p>
 <div class="field-label">内页样式</div>${templateChoices(template)}
 <div class="field-label">线距</div>${spacingChoice('standard')}
 <div class="field-label">封面颜色</div><div class="cover-choices" role="radiogroup" aria-label="封面颜色">${TONES.map(v=>`<button type="button" class="cover-choice cover-${v} ${v===color?'active':''}" data-cover="${v}" role="radio" aria-checked="${v===color}" aria-label="${{olive:'绿色',sand:'黄色',blue:'蓝色',pink:'粉色'}[v]}" title="${{olive:'绿色',sand:'黄色',blue:'蓝色',pink:'粉色'}[v]}">${icon('check')}</button>`).join('')}</div>
 ${actions('创建')}`,{submit:async f=>{const title=f.get('title').trim();if(!title)return;const d={id:uid(),title,kind:'notebook',canvasType,color,folder:f.get('folder'),createdAt:Date.now(),updatedAt:Date.now(),pages:[makeCanvasPage(template,f.get('mode')==='infinite',canvasType,{spacing:f.get('spacing'),title:DEFAULT_TITLES.includes(title)?'':title})],lastPage:0};await store.save(d);S.docs.push(d);closeModal();await openDoc(d.id);toast(canvasType==='time'?'时间画布已创建，日期和时间已写入页面':'画布已创建');}});
 bindChoices('template',v=>template=v);bindChoices('cover',v=>color=v);bindChoices('canvas-kind',v=>canvasType=v);
 $('#note-name').select();
}
function newChooser(){
 dialog('新建',`<div class="menu-choices">
 <button type="button" data-new="time"><span class="menu-icon tone-primary">${icon('time')}</span><span>时间画布<small>创建即记录日期和时间，新增页自动标记</small></span></button>
 <button type="button" data-new="plain"><span class="menu-icon tone-secondary">${icon('draw')}</span><span>普通画布<small>不带自动时间，可手动插入日期</small></span></button>
 <button type="button" data-new="discussion"><span class="menu-icon tone-tertiary">${icon('post')}</span><span>帖子<small>一页一个帖子，可连发多个楼层并逐层回复</small></span></button>
 <button type="button" data-new="import"><span class="menu-icon tone-neutral">${icon('upload')}</span><span>导入文件<small>PDF、EPUB、TXT 等电子书，或 .inknote 备份</small></span></button></div>`);
 modal.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>run(async()=>{const v=b.dataset.new;closeModal();if(v==='discussion')return newDiscussion();if(v==='import')return $('#file-input').click();return newNotebook(v);}));
}
async function showDocMenu(id){const d=S.docs.find(x=>x.id===id);if(!d)return;
 dialog(d.title,`<div class="menu-choices"><button type="button" data-menu="open">${icon('chevron')}打开</button><button type="button" data-menu="rename">${icon('edit')}重命名</button><button type="button" data-menu="favorite">${icon('star')}${d.favorite?'取消收藏':'收藏'}</button><button type="button" data-menu="move">${icon('folder')}移动到文件夹</button><button type="button" data-menu="backup">${icon('download')}<span>导出可编辑备份<small>.inknote 文件，保留原文、笔迹、图片和回复关系</small></span></button><div class="menu-sep"></div><button type="button" data-menu="delete" class="danger">${icon('trash')}删除笔记</button></div>`,{subtitle:`${typeInfo(d).label} · 创建于 ${formatTimestamp(d.createdAt)}${d.folder?' · '+d.folder:''}`});
 modal.querySelectorAll('[data-menu]').forEach(b=>b.onclick=()=>run(async()=>{const action=b.dataset.menu;closeModal();if(action==='open')await openDoc(id);if(action==='rename')await renameDoc(id);if(action==='favorite'){d.favorite=!d.favorite;await store.save(d);if(!S.active)renderLibrary();else refreshTitle();toast(d.favorite?'已收藏':'已取消收藏');}if(action==='move')moveDoc(id);if(action==='backup')await exportBackup(d);if(action==='delete')deleteDoc(id);}));
}
// Theme: Pixel-style colour presets, a custom seed colour, colour style and light/dark mode.
function useTheme(next,persist=true){
 const r=applyTheme(next,themeChanged);S.theme=r.theme;themeChanged(r);try{S.split?.frame.contentWindow?.__inknoteEmbed?.theme(r.theme);}catch{}
 if(persist)run(()=>store.setSetting('theme',r.theme));
 return r;
}
function themeChanged(r=currentTheme()){
 if(!r)return;setPaperAccent(r.paper);S.accent=r.paper;
 if(S.active&&doc()?.kind!=='discussion'&&$('#workspace'))run(async()=>{await showPage({resetScroll:false});await renderThumbnails();});
}
function themeDialog(){
 const body=()=>{const t=S.theme,custom=t.preset==='custom',cs=swatch(t.seed,t.variant);
  return `<div class="field-label">外观</div><div class="button-group wide" role="radiogroup" aria-label="外观模式">${MODES.map(([m,l,ic])=>`<button type="button" class="${t.mode===m?'selected':''}" data-theme-mode="${m}" role="radio" aria-checked="${t.mode===m}">${icon(ic)}${l}</button>`).join('')}</div>
  <div class="field-label">配色</div><div class="swatch-grid">${PRESETS.map(p=>{const s=swatch(p.seed,p.variant||'tonal'),sel=!custom&&t.preset===p.id;return `<button type="button" class="swatch ${sel?'selected':''}" data-theme-preset="${p.id}" aria-pressed="${sel}" title="${p.name}"><span class="swatch-ball" style="--a:${s.a};--b:${s.b};--c:${s.c}"><span class="swatch-check">${icon('check')}</span></span><span class="swatch-name">${p.name}</span></button>`;}).join('')}
   <label class="swatch custom ${custom?'selected':''}" title="选择任意颜色作为主色"><span class="swatch-ball" id="custom-ball" style="--a:${cs.a};--b:${cs.b};--c:${cs.c}"><span class="swatch-check">${icon(custom?'check':'colorize')}</span><input type="color" id="theme-custom" value="${t.seed}" aria-label="自定义主色"></span><span class="swatch-name">自定义</span></label></div>
  <div class="field-label">配色风格</div><div class="chip-set" role="radiogroup" aria-label="配色风格">${VARIANTS.map(([v,l])=>`<button type="button" class="filter-chip ${t.variant===v?'selected':''}" data-theme-variant="${v}" role="radio" aria-checked="${t.variant===v}">${t.variant===v?icon('check'):''}${l}</button>`).join('')}</div>
  <p class="field-hint">选一个主色，整套界面的配色会自动生成。页面纸张始终是白色，导出的 PDF 不受深色模式影响。</p>`;};
 dialog('配色与外观',`<div id="theme-body">${body()}</div><div class="modal-actions"><button class="btn primary" type="button" data-cancel>完成</button></div>`,{subtitle:'像 Pixel 的「壁纸与样式」一样，选好主色，其余颜色自动搭配。'});
 const bind=()=>{
  const root=$('#theme-body');
  root.querySelectorAll('[data-theme-mode]').forEach(b=>b.onclick=()=>{useTheme({...S.theme,mode:b.dataset.themeMode});root.innerHTML=body();bind();});
  root.querySelectorAll('[data-theme-preset]').forEach(b=>b.onclick=()=>{const p=PRESETS.find(x=>x.id===b.dataset.themePreset);useTheme({...S.theme,preset:p.id,seed:p.seed,variant:p.variant||'tonal'});root.innerHTML=body();bind();});
  root.querySelectorAll('[data-theme-variant]').forEach(b=>b.onclick=()=>{useTheme({...S.theme,variant:b.dataset.themeVariant});root.innerHTML=body();bind();});
  const input=$('#theme-custom');let frame;
  input.oninput=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{useTheme({...S.theme,preset:'custom',seed:input.value},false);const s=swatch(input.value,S.theme.variant),ball=$('#custom-ball');ball.style.cssText=`--a:${s.a};--b:${s.b};--c:${s.c}`;root.querySelectorAll('.swatch').forEach(x=>x.classList.toggle('selected',x.classList.contains('custom')));});};
  input.onchange=()=>{useTheme({...S.theme,preset:'custom',seed:input.value});root.innerHTML=body();bind();};
 };
 bind();
}
async function renameDoc(id=S.active){const d=S.docs.find(x=>x.id===id);if(!d)return;const value=await ask('重命名','名称',d.title);if(value){const old=d.title,p0=d.pages[0];if(d.kind==='notebook'&&p0&&p0.template!=='guide'&&p0.sourceIndex===null&&p0.title!==undefined&&(p0.title===old||!p0.title)){p0.title=value;if(S.active===id){updateThumbTitle(0,value);if(S.page===0)run(()=>showPage({resetScroll:false}));updateThumb(0);}}d.title=value;d.updatedAt=Date.now();await store.save(d);if(S.active){refreshTitle();if(d.kind==='discussion')$('.discussion-intro h1').textContent=d.title;}else renderLibrary();}}
function moveDoc(id){const d=S.docs.find(x=>x.id===id);dialog('移动到文件夹',`<label class="field-label" for="target-folder">文件夹</label><select class="field-input" id="target-folder" name="folder"><option value="">未分类</option>${S.folders.map(f=>`<option ${d.folder===f?'selected':''} value="${E(f)}">${E(f)}</option>`).join('')}</select>${actions('移动')}`,{submit:async f=>{d.folder=f.get('folder');await store.save(d);closeModal();if(!S.active)renderLibrary();toast('笔记已移动');}});}
function deleteDoc(id){const d=S.docs.find(x=>x.id===id);dialog('删除这本笔记？',`<p class="help-note">“${E(d.title)}”将从本机移除，无法撤销。需要的话，先在「⋯」菜单里导出一份 .inknote 备份。</p>${actions('删除',true)}`,{submit:async()=>{await flush();await store.remove(id);S.docs=S.docs.filter(x=>x.id!==id);S.tabs=S.tabs.filter(x=>x!==id);history.delete(id);closeModal();if(S.active===id||!S.active)renderLibrary();toast('笔记已删除');markExchangeDeleted(id);}});}

async function openDoc(id){
 if(S.split?.id===id){S.split.frame.focus();toast('这本笔记正在右侧分屏中，可以直接在右侧编辑');return;}
 const ticket=++navigation;finishText();await flush();const d=S.docs.find(x=>x.id===id);if(!d||ticket!==navigation)return;
 const switching=S.active!==id;
 S.active=id;S.page=clamp(d.lastPage||0,0,d.pages.length-1);S.selection.clear();S.findOpen=false;S.find=[];S.findQuery='';S.commentDraft=null;S.activeThread=null;
 if(!S.tabs.includes(id))S.tabs.push(id);S.pdf=null;
 if(d.kind==='discussion'){ensureDiscussionFloors(page());S.discussionQuery='';S.commentDraft=discussionDraft(page());renderDiscussion();d.lastOpened=Date.now();save(false);await releasePdfs(id);return;}
 S.commentsOpen=S.panelPref||false;renderEditor();
 try{const pdf=await documentPdf(d,passwordPrompt);if(S.active!==id||ticket!==navigation)return;S.pdf=pdf;await releasePdfs(id);if(ticket!==navigation)return;await showPage();await renderThumbnails();}
 catch(e){if(S.active===id&&ticket===navigation){failure(e);await goHome();}return;}
 if(switching){d.lastOpened=Date.now();save(false);}
}
const TOOLS=[['pen','edit','画笔','P'],['marker','marker','荧光笔','H'],['eraser','eraser','橡皮擦','E'],['text','text','文字','T'],['rect','rect','矩形','R'],['lasso','lasso','套索框选','L'],['hand','hand','拖动浏览','V'],['comment','comment','插入批注','C']];
function titlebar(back,actionsHTML,lead=''){
 const backBtn=EMBED?`<button class="icon-btn back-btn" data-action="home" title="关闭分屏" aria-label="关闭分屏">${icon('close')}</button><button class="icon-btn" data-action="split-swap" title="左右交换" aria-label="左右交换">${icon('swap')}</button>`:`<button class="icon-btn back-btn" data-action="${back[0]}" title="${back[1]}" aria-label="${back[1]}">${icon('arrow')}</button>`;
 const split=EMBED?'':`<button class="icon-btn split-toggle ${S.split?'on':''}" data-action="split" title="${S.split?'关闭分屏':'分屏：在右侧打开另一本笔记 (Ctrl \\)'}" aria-label="分屏" aria-pressed="${!!S.split}">${icon('split')}</button>`;
 return `<header class="titlebar drag">${backBtn}${lead}<div class="tab-strip" id="tab-strip" role="tablist" aria-label="已打开的笔记"></div><span class="save-status" id="save-status"></span><div class="bar-actions">${split}${actionsHTML}</div></header>`;}
function bindTabRename(){const strip=$('#tab-strip');if(strip)strip.ondblclick=e=>{if(e.target.closest('.doc-tab.active')&&!e.target.closest('.tab-close'))run(()=>renameDoc());};}
function fillRange(el){const min=+el.min,max=+el.max,v=+el.value;el.style.setProperty('--fill',((v-min)/(max-min)*100||0)+'%');}
function renderEditor(){
 const d=doc();
 view.innerHTML=`<main class="editor">${titlebar(['home','返回笔记库'],`<button class="icon-btn" data-action="undo" title="撤销 (Ctrl Z)" aria-label="撤销">${icon('undo')}</button><button class="icon-btn" data-action="redo" title="重做 (Ctrl Shift Z)" aria-label="重做">${icon('redo')}</button><span class="bar-sep"></span><label class="icon-toggle" title="仅用笔书写：开启后只有触控笔能书写，手指用于滚动"><input type="checkbox" id="pen-only" ${S.penOnly?'checked':''} aria-label="仅用笔书写">${icon('pen')}</label><button class="icon-btn" data-action="date" title="在当前页插入日期" aria-label="插入日期">${icon('date-add')}</button><button class="icon-btn comment-pane-toggle" data-action="comments" title="页面批注" aria-label="页面批注">${icon('comment')}<span class="count-badge" id="comment-count">${roots(page()).length}</span></button><button class="icon-btn" data-action="find" title="查找原文与批注 (Ctrl F)" aria-label="查找">${icon('search')}</button><button class="btn tonal" data-action="export" title="导出 PDF 或备份 (Ctrl Shift E)">${icon('download')}<span class="btn-label">导出</span></button><button class="icon-btn" data-action="editor-menu" title="页面与笔记操作" aria-label="更多操作">${icon('more-v')}</button>`,`<button class="icon-btn ${S.sidebar?'on':''}" data-action="toggle-sidebar" title="页面缩略图" aria-label="页面缩略图" aria-pressed="${S.sidebar}">${icon('pages')}</button>`)}
 <div class="editor-body">
  <aside class="page-sidebar ${S.sidebar?'':'collapsed'}" aria-label="页面"><div class="page-side-title"><select id="thumb-filter" aria-label="页面筛选"><option value="all">全部页面</option><option value="bookmark">书签页</option></select><span class="spacer"></span><span class="count-badge" id="side-page-count">${d.pages.length}</span></div><div class="page-thumbs" id="page-thumbs"></div><div class="page-side-bottom"><button class="btn tonal block" data-action="add-page">${icon('plus')}添加页面</button></div></aside>
  <div class="stage" data-dock="${S.toolbarDock}">
   <section class="canvas-workspace" id="workspace" aria-label="文档书写区域"><div class="page-wrapper" id="page-wrapper"><canvas class="pdf-canvas" id="pdf-canvas"></canvas><canvas class="ink-canvas" id="ink-canvas" data-tool="${S.tool}" aria-label="批注画布"></canvas><div class="rich-layer" id="rich-layer"></div><div class="page-loading" id="page-loading"><i class="loading-inline"></i><span>正在准备这一页…</span></div></div></section>
   <div class="page-controls ${S.sidebar?'':'no-sidebar'}" role="group" aria-label="页面与缩放"><button class="icon-btn" data-action="prev" title="上一页 (PageUp)" aria-label="上一页">${icon('left')}</button><button class="page-counter" data-action="jump" id="page-counter" title="跳到指定页">1 / ${d.pages.length}</button><button class="icon-btn" data-action="next" title="下一页 (PageDown)" aria-label="下一页">${icon('chevron')}</button><span class="pc-sep"></span><button class="icon-btn" data-action="zoom-out" title="缩小 (Ctrl 滚轮)" aria-label="缩小">${icon('minus')}</button><button class="zoom-value" data-action="fit" id="zoom-value" title="适合宽度">100%</button><button class="icon-btn" data-action="zoom-in" title="放大 (Ctrl 滚轮)" aria-label="放大">${icon('plus')}</button><button class="icon-btn" data-action="fit" title="适合宽度" aria-label="适合宽度">${icon('fit')}</button><span class="pc-sep"></span><button class="icon-btn scroll-mode-btn" data-action="scroll-mode" title="${scrollModeTitle()}" aria-label="翻页方式">${icon(S.scrollMode==='single'?'single-page':'continuous')}</button></div>
   <div class="selection-bar" id="selection-bar" role="toolbar" aria-label="所选内容" hidden><span class="sel-count"></span><button class="icon-btn" data-action="sel-copy" data-needs-selection title="复制 (Ctrl C)" aria-label="复制">${icon('copy')}</button><button class="icon-btn" data-action="sel-cut" data-needs-selection title="剪切 (Ctrl X)" aria-label="剪切">${icon('cut')}</button><button class="icon-btn" data-action="sel-dup" data-needs-selection title="复制一份 (Ctrl D)" aria-label="复制一份">${icon('duplicate')}</button><button class="icon-btn" data-action="sel-paste" title="粘贴 (Ctrl V)" aria-label="粘贴">${icon('paste')}</button><button class="icon-btn" data-action="sel-delete" data-needs-selection title="删除 (Delete)" aria-label="删除">${icon('trash')}</button></div>
   <div class="toolbar" role="toolbar" aria-label="书写工具">
    <button class="tb-handle" type="button" title="拖动可以把工具栏放到底部、顶部、左侧或右侧，双击回到底部" aria-label="移动工具栏：按方向键选择位置">${icon('drag')}</button>
    <div class="tool-group">${TOOLS.map(([v,i,l,k])=>`<button class="tool-btn ${S.tool===v?'active':''}" data-action="tool" data-value="${v}" title="${l} (${k})" aria-label="${l}" aria-pressed="${S.tool===v}">${icon(i)}</button>`).join('')}</div>
    <span class="tb-sep"></span>
    <div class="color-dots" id="color-dots"></div>
    <span class="tb-sep"></span>
    <label class="width-setting" title="笔迹粗细 / 文字字号"><input type="range" id="pen-width" min="0.5" max="8" step="0.1" value="${S.width}" aria-label="笔迹粗细"><span id="width-label">${S.width}</span></label>
   </div>
  </div>
  <aside class="comments-panel" id="comments-panel" hidden></aside>
 </div>
 <span id="tool-hint" class="visually-hidden" aria-live="polite"></span></main>`;
 refreshTitle();bindTabRename();renderThumbList();refreshTools();refreshHistory();status();renderComments();
 bindToolbarDock();placeToolbar();$('#pen-width').oninput=e=>{const value=+e.target.value;queueMicrotask(syncTools);if(S.tool==='eraser'){S.eraserSize=value;$('#ink-canvas').style.cursor=eraserCursor();}else if(S.tool==='marker')S.markerWidth=value;else if(S.tool==='text')S.textSize=value;else S.width=value;$('#width-label').textContent=value;fillRange(e.target);};
 $('#pen-only').onchange=e=>{S.penOnly=e.target.checked;run(()=>store.setSetting('penOnly',S.penOnly));updateTouch();toast(S.penOnly?'已开启仅用笔书写，手指用于滚动':'已关闭仅用笔书写');};
 $('#thumb-filter').onchange=()=>run(async()=>{renderThumbList();await renderThumbnails();});
 const ink=$('#ink-canvas');ink.addEventListener('pointerdown',pointerDown);ink.addEventListener('pointermove',pointerMove);ink.addEventListener('pointerup',pointerUp);ink.addEventListener('pointercancel',pointerUp);ink.addEventListener('lostpointercapture',e=>{if(gesture&&gesture.pointer===e.pointerId)pointerUp(e);});ink.addEventListener('dblclick',editTextAt);
 $('#page-thumbs').ondblclick=e=>{const t=e.target.closest('.page-thumb');if(t)run(()=>renamePage(+t.dataset.index));};
 $('#workspace').addEventListener('scroll',()=>{if(page()?.infinite){if(!viewportFrame)viewportFrame=requestAnimationFrame(()=>{viewportFrame=null;paintInfinite(true);});}else if(!stackFrame)stackFrame=requestAnimationFrame(()=>{stackFrame=null;checkActivePage();});},{passive:true});
 $('#workspace').addEventListener('pointerdown',ghostPointerDown);
 viewportObserver?.disconnect();viewportObserver=new ResizeObserver(()=>{if(page()?.infinite&&!gesture)paintInfinite(false);});viewportObserver.observe($('#workspace'));
 $('#workspace').addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();run(()=>changeZoom(e.deltaY>0?-.1:.1));return;}flipOnWheel(e);},{passive:false});
}
function refreshTitle(){
 if(!S.active)return;const title=$('.editor-title');if(title)title.textContent=doc().title;
 const tabStrip=$('#tab-strip');if(!tabStrip)return;tabStrip.innerHTML=S.tabs.filter(id=>S.docs.some(d=>d.id===id)).map(id=>{const d=S.docs.find(x=>x.id===id),active=id===S.active;return `<button class="doc-tab ${active?'active':''} ${id===S.split?.id?'in-split':''}" data-action="tab" data-id="${id}" role="tab" aria-selected="${active}" title="${E(d.title)}${active?'（双击重命名）':''}">${typeIcon(d)}<span class="tab-title">${E(d.title)}</span>${id===S.split?.id?`<span class="tab-split" title="在右侧分屏中">${icon('split')}</span>`:''}${d.favorite?`<span class="tab-fav" aria-label="已收藏">${icon('star')}</span>`:''}<span class="tab-close" data-action="close-tab" data-id="${id}" role="button" aria-label="关闭 ${E(d.title)}" title="关闭">${icon('close')}</span></button>`;}).join('');
 tabStrip.querySelector('.doc-tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function eraserCursor(){const d=Math.max(8,Math.min(64,Math.round(S.eraserSize))),r=d/2,c=r+1,s=d+2,dash=S.eraserMode==='partial'?' stroke-dasharray="3 2"':'';const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><circle cx='${c}' cy='${c}' r='${r-.5}' fill='rgba(255,255,255,.35)' stroke='white' stroke-width='2'/><circle cx='${c}' cy='${c}' r='${r-.5}' fill='none' stroke='${S.accent.primary}' stroke-width='1.2'${dash}/></svg>`;return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, cell`;}
function refreshTools(){
 if(!S.active)return;
 document.querySelectorAll('[data-action="tool"]').forEach(b=>{b.classList.toggle('active',b.dataset.value===S.tool);b.setAttribute('aria-pressed',b.dataset.value===S.tool);});
 const eraser=S.tool==='eraser',colors=S.tool==='marker'?MARKERS:COLORS,current=S.tool==='marker'?S.marker:S.color;
 if(eraser){$('#color-dots').innerHTML=[['stroke','gesture','整笔','碰到就删除整条笔迹'],['partial','eraser','局部','只擦掉经过的部分，其余笔迹保留']].map(([v,i,l,t])=>`<button class="mode-chip ${S.eraserMode===v?'active':''}" data-action="eraser-mode" data-value="${v}" title="${t}（再按 E 切换）" aria-pressed="${S.eraserMode===v}">${icon(i)}${l}</button>`).join('');}
 else{$('#color-dots').innerHTML=colors.map(c=>`<button class="color-dot ${c===current?'active':''}" style="--swatch:${c}" data-action="color" data-value="${c}" title="${c}" aria-label="颜色 ${c}" aria-pressed="${c===current}"></button>`).join('')+`<label class="color-custom ${colors.includes(current)?'':'active'}" title="自定义颜色" style="--swatch:${current}"><input class="color-input" type="color" id="custom-color" value="${current}" aria-label="自定义颜色"></label>`;
  $('#custom-color').oninput=e=>{if(S.tool==='marker')S.marker=e.target.value;else S.color=e.target.value;document.querySelectorAll('.color-dot').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-pressed','false');});e.target.parentElement.classList.add('active');e.target.parentElement.style.setProperty('--swatch',e.target.value);syncTools();};}
 const width=$('#pen-width'),isMarker=S.tool==='marker',isText=S.tool==='text';
 width.min=eraser?6:isText?10:isMarker?6:.5;width.max=eraser?60:isText?48:isMarker?35:8;width.step=eraser||isText||isMarker?1:.1;width.value=eraser?S.eraserSize:isText?S.textSize:isMarker?S.markerWidth:S.width;$('#width-label').textContent=width.value;width.setAttribute('aria-label',eraser?'橡皮擦大小':isText?'文字字号':'笔迹粗细');width.parentElement.title=eraser?'橡皮擦大小':isText?'文字字号':'笔迹粗细';fillRange(width);
 const hints={pen:'画笔 · 自由书写，触控笔支持压感',marker:'荧光笔 · 半透明标记',eraser:S.eraserMode==='partial'?'局部擦除 · 只擦掉经过的部分，再按 E 切换为整笔擦除':'整笔擦除 · 碰到就删除整条笔迹，再按 E 切换为局部擦除',text:'文字 · 点击空白处新建文本框，点已有文字直接修改；可粘贴或拖入带格式的内容、Markdown 和公式，Esc 完成',rect:'矩形 · 拖动绘制方框',lasso:'套索 · 框选后拖动，Ctrl C 复制，Delete 删除，双击文字编辑',hand:'浏览 · 拖动平移页面',comment:'批注 · 点击页面固定位置，或先框选笔迹'};
 $('#tool-hint').textContent=hints[S.tool];syncTools();const ink=$('#ink-canvas');ink.dataset.tool=S.tool;ink.dataset.eraser=S.eraserMode;ink.style.cursor=eraser?eraserCursor():'';updateTouch();refreshSelectionBar();
}
function updateTouch(){const c=$('#ink-canvas');if(c)c.style.touchAction=S.penOnly||S.tool==='hand'?'pan-x pan-y':'none';}
function renderThumbList(){
 const d=doc();if(!d||!$('#page-thumbs'))return;
 const bookmarked=$('#thumb-filter')?.value==='bookmark';
 thumbObserver?.disconnect();
 $('#page-thumbs').innerHTML=d.pages.map((p,i)=>bookmarked&&!p.bookmark?'':`<button class="page-thumb ${i===S.page?'active':''}" data-action="page" data-index="${i}" title="第 ${i+1} 页${p.bookmark?' · 书签':''}" aria-label="第 ${i+1} 页" ${i===S.page?'aria-current="page"':''}><canvas data-thumb="${p.id}" width="112" height="${Math.min(180,Math.round(112*p.height/p.width))}"></canvas>${p.bookmark?`<span class="thumb-bookmark">${icon('bookmark')}</span>`:''}<span class="thumb-label"><span class="thumb-number">${i+1}</span><span class="thumb-title">${E(p.title||'')}</span></span></button>`).join('')||`<div class="thumbs-empty">${icon('bookmark')}<span>还没有书签页<br>在「⋮」菜单中添加</span></div>`;
}
async function renderThumbnails(){
 const id=S.active,d=doc(),pdf=S.pdf;thumbObserver?.disconnect();
 thumbObserver=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;thumbObserver.unobserve(e.target);if(id!==S.active)return;const p=d.pages.find(p=>p.id===e.target.dataset.thumb);if(p)run(()=>paintThumb(p,pdf));}},{root:$('#page-thumbs'),rootMargin:'200px'});
 document.querySelectorAll('[data-thumb]').forEach(c=>thumbObserver.observe(c));
}
async function paintThumb(p,pdf){
 const canvas=document.querySelector(`[data-thumb="${p.id}"]`);if(!canvas)return;
 const work=document.createElement('canvas');
 if(p.annotations.some(a=>a.type==='rich'))await prepareRich(p.annotations,1);
 if(p.infinite){canvas.width=112;canvas.height=150;const c=canvas.getContext('2d'),e=contentExtent(p),scale=Math.min(108/e.width,146/e.height);c.fillStyle='#ffffff';c.fillRect(0,0,112,150);c.save();c.translate(2,2);c.scale(scale,scale);drawInfinitePaper(c,p,{x:0,y:0,width:e.width,height:e.height});p.annotations.forEach(a=>drawAnnotation(c,a));c.restore();return;}
 try{await renderBackground(work,p,pdf,{cssWidth:112,pixelRatio:1.4});const c=work.getContext('2d');c.save();c.scale(work.width/p.width,work.height/p.height);p.annotations.forEach(a=>drawAnnotation(c,a));c.restore();if(!canvas.isConnected)return;canvas.width=work.width;canvas.height=work.height;canvas.getContext('2d').drawImage(work,0,0);}catch(e){console.warn('Thumbnail:',e.message);}
}
function updateThumb(i){const p=doc()?.pages[i];if(p)run(()=>paintThumb(p,S.pdf));}
function updatePageCount(){if(!S.active||!$('#page-counter'))return;$('#page-counter').textContent=`${S.page+1} / ${doc().pages.length}`;$('#side-page-count').textContent=doc().pages.length;$('[data-action="prev"]').disabled=S.page===0;$('[data-action="next"]').disabled=S.page===doc().pages.length-1;document.querySelectorAll('.page-thumb').forEach(t=>t.classList.toggle('active',+t.dataset.index===S.page));}
async function showPage({resetScroll=true,keepStack=false,prefill=null,at='top'}={}){
 finishText();if(!S.active)return;const epoch=++S.renderEpoch,p=page(),id=S.active,pdf=S.pdf;S.selection.clear();gesture=null;clearRichLayer();
 doc().lastPage=S.page;pending.set(id,doc());clearTimeout(saveTimer);saveTimer=setTimeout(()=>run(flush),150);
 const ws=$('#workspace');ws.classList.toggle('infinite-workspace',!!p.infinite);S.viewport=null;
 for(const c of [$('#pdf-canvas'),$('#ink-canvas')])c.style.cssText='';
 if(p.infinite){layoutStack();if(resetScroll){ws.scrollTop=0;ws.scrollLeft=0;}$('#page-loading').hidden=true;paintInfinite(false);updatePageCount();renderComments();placeTitleInput();$('#zoom-value').textContent=Math.round(S.zoom*100)+'%';return;}
 const wrapper=$('#page-wrapper');
 // Remember where we were inside the current page so a zoom keeps the same spot in view.
 const rel=!resetScroll&&!keepStack&&ws.classList.contains('continuous')&&wrapper.offsetHeight?(ws.scrollTop-wrapper.offsetTop)/wrapper.offsetHeight:null;
 const width=Math.round(p.width*S.zoom),height=Math.round(p.height*S.zoom);wrapper.style.width=width+'px';wrapper.style.height=height+'px';
 const ink=$('#ink-canvas'),ratio=Math.min(window.devicePixelRatio||1,2);ink.width=Math.round(p.width*S.zoom*ratio);ink.height=Math.round(p.height*S.zoom*ratio);
 if(!keepStack)layoutStack();
 const stacked=ws.classList.contains('continuous');
 if(resetScroll){ws.scrollLeft=0;ws.scrollTop=stacked?(at==='bottom'?wrapper.offsetTop+height-ws.clientHeight+24:wrapper.offsetTop-16):(at==='bottom'?ws.scrollHeight:0);}
 else if(rel!==null)ws.scrollTop=wrapper.offsetTop+rel*height;
 updatePageCount();renderComments();placeTitleInput();$('#zoom-value').textContent=Math.round(S.zoom*100)+'%';
 const bg=$('#pdf-canvas');
 if(prefill&&prefill.width===Math.round(width*ratio)){bg.width=prefill.width;bg.height=prefill.height;bg.getContext('2d',{alpha:false}).drawImage(prefill,0,0);$('#page-loading').hidden=true;drawInk();return;}
 $('#page-loading').hidden=false;drawInk();
 const temp=document.createElement('canvas');
 try{await renderBackground(temp,p,pdf,{cssWidth:width,pixelRatio:ratio});if(epoch!==S.renderEpoch||id!==S.active)return;bg.width=temp.width;bg.height=temp.height;bg.getContext('2d',{alpha:false}).drawImage(temp,0,0);$('#page-loading').hidden=true;drawInk();}
 catch(e){if(epoch===S.renderEpoch){$('#page-loading').textContent='这一页加载失败，请切换页面重试。';throw e;}}
}
function point(e){const p=page(),r=(p.infinite?$('#page-wrapper'):$('#ink-canvas')).getBoundingClientRect();const q={x:p.infinite?(e.clientX-r.left)/S.zoom:(e.clientX-r.left)*p.width/r.width,y:p.infinite?(e.clientY-r.top)/S.zoom:(e.clientY-r.top)*p.height/r.height,p:e.pointerType==='pen'?clamp(e.pressure||.5,.05,1):.75};return p.infinite?nonnegative(q):q;}
function drawInk(){const canvas=$('#ink-canvas'),p=page();if(!canvas||!p)return;const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.save();if(p.infinite&&S.viewport){const v=S.viewport;c.scale(v.scale,v.scale);c.translate(-v.x,-v.y);visibleAnnotations(p.annotations,v).forEach(a=>{if(a.id!==S.editingText&&a.type!=='rich')drawAnnotation(c,a);});}else{c.scale(canvas.width/p.width,canvas.height/p.height);p.annotations.forEach(a=>{if(a.id!==S.editingText&&a.type!=='rich')drawAnnotation(c,a);});}if(gesture?.annotation)drawAnnotation(c,gesture.annotation);
 if(S.selection.size){const b=selectionBounds();if(b){c.strokeStyle=S.accent.primary;c.fillStyle=S.accent.primary+'10';c.lineWidth=1.2/S.zoom;c.setLineDash([5/S.zoom,4/S.zoom]);c.fillRect(b.x-5,b.y-5,b.w+10,b.h+10);c.strokeRect(b.x-5,b.y-5,b.w+10,b.h+10);c.setLineDash([]);}}
 if(gesture?.mode==='select'){const b=selectionRect(gesture.start,gesture.last);c.strokeStyle=S.accent.primary;c.fillStyle=S.accent.primary+'16';c.lineWidth=1/S.zoom;c.setLineDash([5/S.zoom,4/S.zoom]);c.fillRect(b.x,b.y,b.w,b.h);c.strokeRect(b.x,b.y,b.w,b.h);c.setLineDash([]);}
 if(gesture?.mode==='erase'&&gesture.ring){const r=S.eraserSize/2/S.zoom;c.strokeStyle=S.accent.primary;c.fillStyle=S.accent.primary+'18';c.lineWidth=1.4/S.zoom;c.beginPath();c.arc(gesture.last.x,gesture.last.y,r,0,Math.PI*2);c.fill();c.stroke();}
 drawCommentPins(c,p);c.restore();refreshSelectionBar();syncRich();
}
function selectionRect(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
function selectionBounds(){const bs=page().annotations.filter(a=>S.selection.has(a.id)).map(bounds);if(!bs.length)return null;const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,w:Math.max(...bs.map(b=>b.x+b.w))-x,h:Math.max(...bs.map(b=>b.y+b.h))-y};}
function pointerDown(e){
 if(!page()||e.button!==0||gesture||textarea)return;if(S.penOnly&&e.pointerType!=='pen'&&S.tool!=='hand')return;
 if(!$('#page-loading').hidden)return;e.preventDefault();const p=point(e),tool=S.tool;
 const pin=roots(page()).findLast(root=>{const a=commentPosition(page(),root);return Math.hypot(a.x-p.x,a.y-p.y)<13/S.zoom;});if(pin){S.commentsOpen=true;S.activeThread=pin.id;renderComments();return;}
 if(tool==='comment'){startThreadAt(p);return;}
 if(tool==='text'){const hit=textAt(p);startText(hit?{x:hit.x,y:hit.y}:p,hit,hit?{clientX:e.clientX,clientY:e.clientY}:null);return;}
 const c=$('#ink-canvas');c.setPointerCapture(e.pointerId);
 gesture={pointer:e.pointerId,start:p,last:p,before:pageSnapshot(),changed:false,tool,ring:e.pointerType!=='mouse'};
 if(tool==='hand'){gesture.mode='pan';gesture.scroll={x:$('#workspace').scrollLeft,y:$('#workspace').scrollTop,clientX:e.clientX,clientY:e.clientY};return;}
 if(tool==='eraser'){gesture.mode='erase';erase(p,p);}
 else if(tool==='lasso'){const b=selectionBounds();if(b&&inside(p,b,8)){gesture.mode='move';if(e.ctrlKey||e.altKey){const copies=structuredClone(selectedItems()).map(a=>({...a,id:uid()}));page().annotations.push(...copies);S.selection=new Set(copies.map(a=>a.id));gesture.changed=true;}}else{S.selection.clear();gesture.mode='select';}}
 else{S.selection.clear();gesture.mode='draw';gesture.annotation=tool==='rect'?{id:uid(),type:'rect',x:p.x,y:p.y,w:0,h:0,color:S.color,width:S.width}:{id:uid(),type:tool==='marker'?'marker':'pen',color:tool==='marker'?S.marker:S.color,width:tool==='marker'?S.markerWidth:S.width,pressure:e.pointerType==='pen',points:[p]};}
 drawInk();
}
function erase(from,to){
 const r=S.eraserSize/2/S.zoom;if(S.eraserMode==='partial'){if(partialErase(from,to,r))gesture.changed=true;return;}
 const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/5));const remove=new Set();for(let i=0;i<=steps;i++){const p={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps};for(const a of page().annotations)if(hitAnnotation(a,p,r))remove.add(a.id);}if(remove.size){page().annotations=page().annotations.filter(a=>!remove.has(a.id));gesture.changed=true;}}
function pointerMove(e){
 if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();const p=point(e),g=gesture;
 if(g.mode==='pan'){const s=g.scroll;$('#workspace').scrollLeft=s.x+s.clientX-e.clientX;$('#workspace').scrollTop=s.y+s.clientY-e.clientY;return;}
 if(g.mode==='draw'){if(g.annotation.type==='rect'){g.annotation.w=p.x-g.start.x;g.annotation.h=p.y-g.start.y;}else{const events=e.getCoalescedEvents?.()||[e];for(const v of events){const q=point(v),last=g.annotation.points.at(-1);if(Math.hypot(q.x-last.x,q.y-last.y)>.18)g.annotation.points.push(q);}}}
 if(g.mode==='erase')erase(g.last,p);
 if(g.mode==='move'){let dx=p.x-g.last.x,dy=p.y-g.last.y;const selected=selectionBounds();if(page().infinite&&selected){dx=Math.max(dx,-selected.x);dy=Math.max(dy,-selected.y);}page().annotations.filter(a=>S.selection.has(a.id)).forEach(a=>translate(a,dx,dy));g.changed ||= Math.abs(dx)+Math.abs(dy)>.01;}
 g.last=p;drawInk();
}
function pointerUp(e){if(!gesture||gesture.pointer!==e.pointerId)return;const g=gesture;
 if(g.mode==='draw'){const a=g.annotation;if(a.type!=='rect'||Math.abs(a.w)>2&&Math.abs(a.h)>2){page().annotations.push(a);g.changed=true;}}
 if(g.mode==='select'){const b=selectionRect(g.start,g.last);if(b.w<4&&b.h<4){const found=page().annotations.findLast(a=>hitAnnotation(a,g.last,7/S.zoom));if(found)S.selection.add(found.id);}else page().annotations.filter(a=>intersects(bounds(a),b)).forEach(a=>S.selection.add(a.id));}
 gesture=null;if(g.changed){if(page().infinite){const e=contentExtent(page());growExtent(page(),e.width,e.height);}remember(g.before);}if(page().infinite)paintInfinite(false);else drawInk();const c=$('#ink-canvas');if(c?.hasPointerCapture(e.pointerId))c.releasePointerCapture(e.pointerId);if(g.mode==='pan')requestAnimationFrame(checkActivePage);
}
// ---------- Rich text boxes (OneNote-style containers) ----------
// Boxes live as DOM over the canvas on the open page (crisp at every zoom, edited in place);
// thumbnails, page pictures and PDF export draw a raster of the same HTML (richtext.mjs).
const richEls=new Map();
function richLayer(){return $('#rich-layer');}
function clearRichLayer(){richEls.clear();richLayer()?.replaceChildren();}
function placeRich(el,a){
 const z=S.zoom;el.style.left=a.x*z+'px';el.style.top=a.y*z+'px';el.style.transform=`scale(${z})`;el.style.setProperty('--z',z);
 const inner=el.querySelector('.rich');inner.style.width=a.w+'px';inner.style.fontSize=a.size+'px';inner.style.color=a.color;
}
function richBox(a){
 const el=document.createElement('div');el.className='rich-box';el.dataset.id=a.id;
 el.innerHTML='<div class="rich-grip" title="拖动移动文本框" aria-hidden="true"></div><div class="rich"></div><div class="rich-resize" title="拖动调整宽度" aria-hidden="true"></div>';
 return el;
}
// Keep the DOM boxes in step with the page's rich annotations (cheap when nothing changed).
function syncRich(){
 const layer=richLayer(),p=page();if(!layer||!p)return;const seen=new Set();let measured=false;
 for(const a of p.annotations){
  if(a.type!=='rich')continue;seen.add(a.id);let el=richEls.get(a.id);
  if(!el){el=richBox(a);richEls.set(a.id,el);layer.append(el);}
  if(textarea?.id===a.id)continue;
  const inner=el.querySelector('.rich');if(el._html!==a.html){renderInto(inner,a.html);el._html=a.html;}
  placeRich(el,a);el.classList.toggle('selected',S.selection.has(a.id));
  const h=Math.ceil(inner.offsetHeight);if(h&&Math.abs((a.h||0)-h)>1){a.h=h;measured=true;}
 }
 for(const [id,el] of richEls)if(!seen.has(id)&&textarea?.id!==id){el.remove();richEls.delete(id);}
 if(measured)save(false);
}
function textAt(p){return page().annotations.findLast(a=>(a.type==='text'||a.type==='rich')&&a.id!==S.editingText&&inside(p,bounds(a),4/S.zoom));}
function editTextAt(e){if(!page()||textarea||!['lasso','hand','text'].includes(S.tool))return;const p=point(e),hit=textAt(p);if(hit){e.preventDefault();S.selection.clear();startText({x:hit.x,y:hit.y},hit,{clientX:e.clientX,clientY:e.clientY});}}
function defaultRichWidth(x){const p=page();const room=p.infinite?560:p.width-x-30;return Math.round(clamp(room,140,560));}
function caretAt(clientX,clientY){const r=document.caretRangeFromPoint?.(clientX,clientY);if(r){const s=getSelection();s.removeAllRanges();s.addRange(r);return true;}return false;}
function caretToEnd(el){const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);}
function startText(p,edit=null,at=null){
 finishText();if(!page())return;
 const src=edit?(edit.type==='rich'?edit:{id:edit.id,type:'rich',x:edit.x,y:edit.y,w:Math.max(140,Math.ceil(bounds(edit).w)+16),size:edit.size,color:edit.color,html:plainToHtml(edit.text)}):null;
 const a=src?{...src}:{id:uid(),type:'rich',x:p.x,y:p.y,w:defaultRichWidth(p.x),size:S.textSize,color:S.color,html:''};
 textarea={id:a.id,draft:a,isNew:!edit,before:pageSnapshot(),pageId:page().id,docId:S.active};S.editingText=a.id;
 let el=richEls.get(a.id);if(!el){el=richBox(a);richEls.set(a.id,el);richLayer().append(el);}
 const inner=el.querySelector('.rich');renderInto(inner,a.html||'<p><br></p>');el._html=null;placeRich(el,a);document.execCommand('defaultParagraphSeparator',false,'p');
 el.classList.add('editing');inner.contentEditable='true';inner.spellcheck=false;inner.dataset.placeholder='输入文字；可粘贴或拖入带格式的内容、Markdown 和公式';
 if(edit?.type==='text')drawInk();
 inner.focus({preventScroll:true});if(!(at&&caretAt(at.clientX,at.clientY)))caretToEnd(inner);
 showRichToolbar(el);bindRichEditor(el,inner);
 document.addEventListener('pointerdown',richOutside,true);
}
function richOutside(e){if(!textarea)return;const el=richEls.get(textarea.id);if(el?.contains(e.target)||e.target.closest?.('.rich-toolbar,#modal,.rich-colors'))return;finishText();}
function finishText(){
 if(!textarea)return;const s=textarea;textarea=null;S.editingText=null;document.removeEventListener('pointerdown',richOutside,true);$('.rich-toolbar')?.remove();$('.rich-colors')?.remove();
 const el=richEls.get(s.id),inner=el?.querySelector('.rich');
 if(el){el.classList.remove('editing');inner.removeAttribute('contenteditable');}
 if(!inner||s.docId!==S.active||s.pageId!==page()?.id){if(el){el.remove();richEls.delete(s.id);}drawInk();return;}
 autoMath(inner);const html=storageFrom(inner),plain=richPlainText(html),list=page().annotations,i=list.findIndex(x=>x.id===s.id);
 if(!plain.trim()&&!/class="math/.test(html)){if(i>=0){list.splice(i,1);remember(s.before);}el.remove();richEls.delete(s.id);drawInk();return;}
 const a={id:s.id,type:'rich',x:s.draft.x,y:s.draft.y,w:s.draft.w,size:s.draft.size,color:s.draft.color,html,plain:plain.slice(0,20000),h:Math.max(1,Math.ceil(inner.offsetHeight))};
 const old=i>=0?list[i]:null;el._html=null;
 if(old&&old.type==='rich'&&old.html===a.html&&old.x===a.x&&old.y===a.y&&old.w===a.w){drawInk();return;}
 if(old)list[i]=a;else list.push(a);remember(s.before);drawInk();
}
// "$…$", "\(…\)", "$$…$$" typed as text become formulas when the box is closed.
function autoMath(root){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('code,pre,.math')?NodeFilter.FILTER_REJECT:/\$|\\\(|\\\[/.test(n.data)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP});
 const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const n of nodes){const {text,math}=extractMath(n.data);if(!math.length)continue;const frag=document.createDocumentFragment();
  for(const part of text.split(/(\d+)/)){const m=part.match(/^(\d+)$/);if(!m){if(part)frag.append(part);continue;}const s=document.createElement('span');s.className='math'+(math[m[1]].display?' math-display':'');s.dataset.tex=math[m[1]].tex;frag.append(s);}
  n.replaceWith(frag);}
 renderMath(root);
}
function insertRichHtml(inner,html){
 inner.focus({preventScroll:true});document.execCommand('insertHTML',false,html);renderMath(inner);
}
function bindRichEditor(el,inner){
 inner.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'||e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finishText();return;}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault();document.execCommand({b:'bold',i:'italic',u:'underline'}[e.key.toLowerCase()]);}};
 inner.oninput=e=>{markdownShortcut(inner,e);positionRichToolbar(el);};
 inner.onpaste=e=>{e.preventDefault();const dt=e.clipboardData,html=dt.getData('text/html'),text=dt.getData('text/plain');insertRichHtml(inner,html&&html.trim()?sanitizeHtml(html):textToHtml(text));};
 inner.ondrop=e=>{e.preventDefault();e.stopPropagation();const drop=captureDrop(e.dataTransfer);caretAt(e.clientX,e.clientY);const range=getSelection().rangeCount?getSelection().getRangeAt(0).cloneRange():null;run(async()=>{const html=await richFromDrop(drop);if(!html||!textarea)return;inner.focus({preventScroll:true});if(range){const s=getSelection();s.removeAllRanges();s.addRange(range);}insertRichHtml(inner,html);});};
 inner.ondragover=e=>{e.preventDefault();e.stopPropagation();};
 inner.onclick=e=>{const m=e.target.closest('.math[data-tex]');if(m)run(()=>editMath(inner,m));};
 const z=()=>S.zoom;
 el.querySelector('.rich-grip').onpointerdown=e=>{e.preventDefault();e.stopPropagation();const g=e.currentTarget;g.setPointerCapture(e.pointerId);const a=textarea.draft,sx=e.clientX,sy=e.clientY,ox=a.x,oy=a.y;
  g.onpointermove=m=>{a.x=Math.max(page().infinite?0:-a.w+20,ox+(m.clientX-sx)/z());a.y=Math.max(page().infinite?0:-20,oy+(m.clientY-sy)/z());placeRich(el,a);positionRichToolbar(el);};
  g.onpointerup=g.onpointercancel=()=>{g.onpointermove=g.onpointerup=g.onpointercancel=null;inner.focus({preventScroll:true});};};
 el.querySelector('.rich-resize').onpointerdown=e=>{e.preventDefault();e.stopPropagation();const g=e.currentTarget;g.setPointerCapture(e.pointerId);const a=textarea.draft,sx=e.clientX,ow=a.w;
  g.onpointermove=m=>{a.w=Math.round(clamp(ow+(m.clientX-sx)/z(),60,4000));placeRich(el,a);positionRichToolbar(el);};
  g.onpointerup=g.onpointercancel=()=>{g.onpointermove=g.onpointerup=g.onpointercancel=null;inner.focus({preventScroll:true});};};
}
// Typing "# ", "## ", "- ", "1. ", "> " or "```" at the start of a line turns it into that block, as in OneNote/Notion.
function markdownShortcut(inner,e){
 if(e.inputType!=='insertText'||e.data!==' ')return;const sel=getSelection();if(!sel.rangeCount)return;const node=sel.anchorNode;if(node?.nodeType!==3)return;
 const block=node.parentElement.closest('p,div,h1,h2,h3');if(!block||block===inner||!inner.contains(block)||block.closest('pre,li,blockquote'))return;
 if(node!==firstText(block))return;const mark=node.data.slice(0,sel.anchorOffset).replace(/ /g,' ').trimEnd();
 const kind={'#':'h1','##':'h2','###':'h3','>':'blockquote','-':'ul','*':'ul','•':'ul','1.':'ol','1)':'ol'}[mark];if(!kind)return;
 node.data=node.data.slice(sel.anchorOffset);
 const target=document.createElement(kind==='ul'||kind==='ol'?'li':kind);while(block.firstChild)target.append(block.firstChild);if(!target.textContent)target.innerHTML='<br>';
 if(kind==='ul'||kind==='ol'){const prev=block.previousElementSibling;let list=prev?.tagName===kind.toUpperCase()?prev:null;if(!list){list=document.createElement(kind);block.before(list);}list.append(target);block.remove();}
 else block.replaceWith(target);
 const r=document.createRange(),first=firstText(target);if(first)r.setStart(first,0);else r.setStart(target,0);r.collapse(true);sel.removeAllRanges();sel.addRange(r);
}
function firstText(el){const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);return w.nextNode();}
const RICH_COLORS=['#1f1f1f','#1a73e8','#d93025','#188038','#9334e6','#e37400'];
function showRichToolbar(el){
 $('.rich-toolbar')?.remove();const bar=document.createElement('div');bar.className='rich-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','文字格式');
 const b=(cmd,label,title,extra='')=>`<button type="button" data-rich="${cmd}" title="${title}" aria-label="${title}" ${extra}>${label}</button>`;
 bar.innerHTML=b('p','正文','正文')+b('h1','H1','标题 1')+b('h2','H2','标题 2')+b('h3','H3','标题 3')+'<span class="rt-sep"></span>'+
  b('bold','<b>B</b>','加粗 (Ctrl B)')+b('italic','<i>I</i>','斜体 (Ctrl I)')+b('underline','<u>U</u>','下划线 (Ctrl U)')+b('strikeThrough','<s>S</s>','删除线')+b('color','<span class="rt-color"></span>','文字颜色')+b('mark','<span class="rt-mark">ab</span>','高亮')+'<span class="rt-sep"></span>'+
  b('ul',icon('list'),'项目符号列表')+b('ol','1.','编号列表')+b('quote','❝','引用')+b('code','&lt;/&gt;','代码')+b('math','∑','插入公式（LaTeX）')+'<span class="rt-sep"></span>'+b('clear','✕','清除格式');
 $('#page-wrapper').append(bar);
 bar.onpointerdown=e=>e.preventDefault();
 bar.onclick=e=>{const btn=e.target.closest('[data-rich]');if(!btn||!textarea)return;const inner=richEls.get(textarea.id)?.querySelector('.rich');if(!inner)return;inner.focus({preventScroll:true});richCommand(btn.dataset.rich,inner,btn);positionRichToolbar(el);};
 positionRichToolbar(el);
}
function positionRichToolbar(el){const bar=$('.rich-toolbar');if(!bar||!textarea)return;const a=textarea.draft,z=S.zoom,h=el.querySelector('.rich').offsetHeight*z,top=a.y*z-64;bar.style.left=Math.max(0,a.x*z)+'px';bar.style.top=(top<4?a.y*z+h+14:top)+'px';}
function richCommand(cmd,inner,btn){
 const exec=(c,v)=>document.execCommand(c,false,v);exec('styleWithCSS',false);
 if(['bold','italic','underline','strikeThrough'].includes(cmd))return exec(cmd);
 if(cmd==='p'||cmd==='h1'||cmd==='h2'||cmd==='h3')return exec('formatBlock','<'+cmd+'>');
 if(cmd==='quote')return exec('formatBlock','<blockquote>');
 if(cmd==='ul')return exec('insertUnorderedList');if(cmd==='ol')return exec('insertOrderedList');
 if(cmd==='clear'){exec('removeFormat');return exec('formatBlock','<p>');}
 if(cmd==='code'){const t=getSelection().toString();if(t.includes('\n'))return exec('insertHTML','<pre><code>'+E(t)+'</code></pre>');return exec('insertHTML','<code>'+E(t||'代码')+'</code>&#8203;');}
 if(cmd==='mark'){exec('styleWithCSS',true);exec('hiliteColor','#ffeb8a');return exec('styleWithCSS',false);}
 if(cmd==='color'){
  $('.rich-colors')?.remove();const pop=document.createElement('div');pop.className='rich-colors';pop.innerHTML=RICH_COLORS.map(c=>`<button type="button" style="--swatch:${c}" data-c="${c}" title="${c}" aria-label="颜色 ${c}"></button>`).join('');
  pop.onpointerdown=e=>e.preventDefault();pop.onclick=e=>{const c=e.target.closest('[data-c]')?.dataset.c;if(!c)return;inner.focus({preventScroll:true});exec('styleWithCSS',true);exec('foreColor',c);exec('styleWithCSS',false);pop.remove();};
  const r=btn.getBoundingClientRect(),w=$('#page-wrapper').getBoundingClientRect();pop.style.left=(r.left-w.left)+'px';pop.style.top=(r.bottom-w.top+6)+'px';$('#page-wrapper').append(pop);return;
 }
 if(cmd==='math')return run(()=>editMath(inner,null));
}
async function editMath(inner,node){
 const sel=getSelection(),range=sel.rangeCount?sel.getRangeAt(0).cloneRange():null,old=node?.dataset.tex||'';
 const tex=await new Promise(resolve=>{dialog(node?'编辑公式':'插入公式',`<label class="field-label" for="tex">LaTeX</label><textarea class="field-input tex-input" id="tex" name="tex" rows="3" placeholder="例如 \\frac{a}{b}、x^2+y^2=r^2、\\int_0^1 f(x)\\,dx" spellcheck="false">${E(old)}</textarea><label class="switch setting-switch"><input type="checkbox" name="display" role="switch" ${node?.classList.contains('math-display')?'checked':''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label"><strong>单独成行</strong><small>大号居中显示，适合较长的公式</small></span></label><div class="tex-preview rich" id="tex-preview"></div>${actions(node?'保存':'插入')}`,{submit:f=>{closeModal();resolve({tex:String(f.get('tex')||'').trim(),display:f.get('display')==='on'});}});
  modal.addEventListener('close',function c(){if(modal.open)return;modal.removeEventListener('close',c);resolve(null);});
  const input=$('#tex'),preview=$('#tex-preview'),show=()=>{preview.innerHTML=input.value.trim()?`<span class="math${modal.querySelector('[name=display]').checked?' math-display':''}" data-tex="${E(input.value.trim())}"></span>`:'<span class="field-hint">这里显示预览</span>';renderMath(preview);};
  input.oninput=show;modal.querySelector('[name=display]').onchange=show;show();});
 if(!textarea)return;inner.focus({preventScroll:true});
 if(range){const s=getSelection();s.removeAllRanges();s.addRange(range);}
 if(!tex)return;
 if(!tex.tex){node?.remove();return;}
 const html=`<span class="math${tex.display?' math-display':''}" data-tex="${E(tex.tex)}"></span>`;
 if(node){const t=document.createElement('template');t.innerHTML=html;node.replaceWith(t.content.firstChild);renderMath(inner);}else insertRichHtml(inner,html+'&#8203;');
}
// Read everything a drop carries while the event is still running (DataTransfer is emptied afterwards).
function captureDrop(dt){return {files:[...(dt.files||[])],html:dt.getData('text/html'),text:dt.getData('text/plain')};}
async function richFromDrop(drop){
 const files=drop.files.filter(f=>/\.(md|markdown|txt)$/i.test(f.name)&&f.size<20*1024*1024);
 if(files.length){const parts=[];for(const f of files)parts.push(/\.txt$/i.test(f.name)?textToHtml(await f.text()):markdownToHtml(await f.text()));return parts.join('');}
 if(drop.html&&drop.html.trim())return sanitizeHtml(drop.html);if(drop.text&&drop.text.trim())return textToHtml(drop.text);return '';
}
// Paste or drop formatted content straight onto the page (not into a box): a new box is made for it.
function addRichBox(html,at){
 if(!page()||!html)return null;const p=page(),v=p.infinite?S.viewport:null;
 const x=Math.max(0,at?at.x:(v?.x||0)+48),y=Math.max(0,at?at.y:Math.max((v?.y||0)+48,pageHeader(p).bottom+12));
 const a={id:uid(),type:'rich',x,y,w:defaultRichWidth(x),size:S.textSize,color:S.color,html};a.plain=richPlainText(html).slice(0,20000);a.h=measureRich(a);
 const before=pageSnapshot();p.annotations.push(a);S.selection=new Set([a.id]);if(S.tool!=='lasso'){S.tool='lasso';refreshTools();}remember(before);redrawPage();return a;
}

async function goPage(i,{at='top'}={}){finishText();if(!doc()||i<0||i>=doc().pages.length)return;if(i!==S.page){S.commentDraft=null;S.activeThread=null;}S.page=i;await showPage({at});const active=document.querySelector('.page-thumb.active');active?.scrollIntoView({block:'nearest'});}
async function changeZoom(delta){finishText();S.zoom=clamp(Math.round((S.zoom+delta)*10)/10,.3,3);await showPage({resetScroll:false});}
async function fitIfOverflow(){const p=page(),w=$('#workspace');if(p&&!p.infinite&&!p.reading&&w&&p.width*S.zoom>w.clientWidth-65)await fit();}
async function fit(){const w=$('#workspace');S.zoom=page().infinite?1:clamp((w.clientWidth-65)/page().width,.3,1.8);await showPage();}
async function goHome(){if(EMBED){finishText();await flush();host()?.closeSplit();return;}const ticket=++navigation;finishText();await flush();if(S.split)await closeSplit();if(ticket!==navigation)return;S.pdf=null;renderLibrary();await releasePdfs(null);}
async function addPage(){
 const cur=page();let template=titleEditable(cur)?cur.template:'dot';const mode=cur.infinite?'infinite':'paged';
 dialog('添加页面',`<div class="field-label">纸张范围</div>${pageModeChoice(mode)}<div class="field-label">内页样式</div>${templateChoices(template)}<div class="field-label">线距</div>${spacingChoice(titleEditable(cur)&&cur.spacing||'standard')}<p class="field-hint">${doc().canvasType==='time'?'时间画布的新页面会自动写入日期和时间。':'新页面插入到当前页之后，可以在页面顶部写标题。'}</p>${actions('插入到当前页后')}`,{submit:async f=>{const before=pageSnapshot();doc().pages.splice(S.page+1,0,makeCanvasPage(template,f.get('mode')==='infinite',doc().canvasType||'plain',{spacing:f.get('spacing'),margin:titleEditable(cur)&&cur.template===template?cur.margin:undefined}));S.page++;remember(before);closeModal();renderThumbList();await showPage();await renderThumbnails();}});
 bindChoices('template',v=>template=v);
}
function editorMenu(){const p=page(),n=doc().pages.length,canvas=titleEditable(p);dialog('页面与笔记',`<div class="menu-choices"><button type="button" data-page-menu="rename-page">${icon('title')}重命名页面</button>${canvas?`<button type="button" data-page-menu="setup">${icon('spacing')}<span>纸张样式<small>横线、方格、点阵，线距宽窄，左侧边距线</small></span></button>`:''}<button type="button" data-page-menu="date" class="narrow-only">${icon('date-add')}插入日期和时间</button><button type="button" data-page-menu="find" class="narrow-only">${icon('search')}查找原文与批注</button><button type="button" data-page-menu="bookmark">${icon('bookmark')}${p.bookmark?'移除当前页书签':'给当前页加书签'}</button><button type="button" data-page-menu="duplicate">${icon('duplicate')}复制当前页</button><button type="button" data-page-menu="add">${icon('plus')}添加页面</button><button type="button" data-page-menu="up" ${S.page===0?'disabled':''}>${icon('up')}页面上移</button><button type="button" data-page-menu="down" ${S.page===n-1?'disabled':''}>${icon('down-arrow')}页面下移</button><div class="menu-sep"></div><button type="button" data-page-menu="rename">${icon('edit')}重命名笔记</button>${EMBED?'':`<button type="button" data-page-menu="split">${icon('split')}${S.split?'关闭分屏':'在右侧分屏打开另一本'}</button>`}<button type="button" data-page-menu="backup">${icon('download')}<span>导出可编辑备份<small>.inknote 文件，可在其他电脑导入继续编辑</small></span></button><button type="button" data-page-menu="help">${icon('help')}快捷键与帮助</button><div class="menu-sep"></div><button type="button" data-page-menu="clear" class="danger">${icon('eraser')}清除当前页全部批注</button><button type="button" data-page-menu="delete" class="danger" ${n===1?'disabled':''}>${icon('trash')}删除当前页</button></div>`,{subtitle:`第 ${S.page+1} 页，共 ${n} 页${p.title?' · '+p.title:''}`});
 modal.querySelectorAll('[data-page-menu]').forEach(b=>b.onclick=()=>run(async()=>{const a=b.dataset.pageMenu;closeModal();if(a==='rename')return renameDoc();if(a==='rename-page')return renamePage();if(a==='setup')return pageSetupDialog();if(a==='split')return splitChooser();if(a==='date')return insertDate();if(a==='find')return toggleFind();if(a==='backup')return exportBackup(doc());if(a==='add')return addPage();if(a==='help')return showHelp();if(a==='clear'||a==='delete'){dialog(a==='clear'?'清除这一页的批注？':'删除这一页？',`<p class="help-note">${a==='clear'?'这一页的手写、文字和形状将被清除。':'当前页及该页批注将被移除。'}可以用 Ctrl Z 撤销。</p>${actions(a==='clear'?'清除':'删除',true)}`,{submit:async()=>{closeModal();await pageMutation(a);}});return;}await pageMutation(a);}));
}
async function pageMutation(a){const before=pageSnapshot();if(a==='bookmark')page().bookmark=!page().bookmark;if(a==='clear')page().annotations=[];if(a==='duplicate'){const clone=structuredClone(page());clone.id=uid();clone.annotations.forEach(x=>x.id=uid());doc().pages.splice(S.page+1,0,clone);S.page++;}if(a==='delete'&&doc().pages.length>1){doc().pages.splice(S.page,1);S.page=clamp(S.page,0,doc().pages.length-1);}if((a==='up'&&S.page>0)||(a==='down'&&S.page<doc().pages.length-1)){const j=S.page+(a==='up'?-1:1),ps=doc().pages;[ps[S.page],ps[j]]=[ps[j],ps[S.page]];S.page=j;}remember(before);renderThumbList();await showPage();await renderThumbnails();}

async function download(data,name,mime){
 if(EMBED&&host()?.download)return host().download(data,name,mime);
 const blob=data instanceof Blob?data:new Blob([data],{type:mime});
 if(window.desktop?.saveBegin){
  const r=await window.desktop.saveBegin({name,size:blob.size});if(r?.error)throw new Error(r.error);if(!r?.token)return false;
  let ok=false;try{const step=16*1024*1024;for(let o=0;o<blob.size||o===0;o+=step){const res=await window.desktop.saveChunk(r.token,new Uint8Array(await blob.slice(o,o+step).arrayBuffer()));if(res?.error)throw new Error(res.error);if(!blob.size)break;}ok=true;}
  finally{const end=await window.desktop.saveEnd(r.token,ok);if(ok&&end?.error)throw new Error(end.error);}
  return true;
 }
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;
}
function filename(s){return s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'InkNote';}
function exportDialog(){finishText();const d=doc();dialog('导出',`<div class="menu-choices"><button type="button" data-export="pdf">${icon('file')}<span>导出 PDF<small>${d.kind==='pdf'?'保留原文和可检索文字，批注合并为图层':'无限画布按内容分成 A4 页导出'}</small></span></button><button type="button" data-export="backup">${icon('book')}<span>导出可编辑备份 · .inknote<small>包含原始文档、可编辑笔迹、图片与页面设置</small></span></button></div><p class="help-note">想继续修改笔迹，请保留 .inknote 备份；PDF 适合阅读与分享。</p>`);modal.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>run(async()=>{const type=b.dataset.export;closeModal();if(type==='backup')return exportBackup(doc());await doExport();}));}
async function doExport(){finishText();await flush();const d=doc();const btn=$('[data-action="export"]');if(btn)btn.disabled=true;toast('正在生成 PDF…');try{const bytes=await exportPdf(structuredClone(d),()=>{},{pdf:S.pdf,prepareRich});if(await download(bytes,filename(d.title)+'-批注.pdf','application/pdf'))toast('PDF 已导出');}finally{if(btn?.isConnected)btn.disabled=false;}}
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
const BIG_BACKUP=48*1024*1024;
// v1: JSON with the original base64-encoded (older versions read it). v2 (originals over 48 MB): a stored ZIP
// holding inknote.json and source.bin, so 1 GB files never pass through a giant string.
async function backupBlob(d){
 finishText();await flush();const binary=await store.binary(d.id),copy=structuredClone(d);
 if(binary&&binary.byteLength>BIG_BACKUP)return writeZip([{name:'inknote.json',data:JSON.stringify({format:'inknote',version:2,document:copy,source:{entry:'source.bin',kind:d.kind,format:d.format||null,bytes:binary.byteLength}})},{name:'source.bin',data:new Uint8Array(binary)}]);
 const payload={format:'inknote',version:1,document:copy,pdf:d.kind==='pdf'&&binary?toBase64(new Uint8Array(binary)):null,source:d.kind==='ebook'&&binary?{format:d.format,base64:toBase64(new Uint8Array(binary))}:null};
 return new Blob([JSON.stringify(payload)],{type:'application/json'});
}
async function exportBackup(d){const blob=await backupBlob(d);if(await download(blob,filename(d.title)+'.inknote','application/json'))toast('可编辑备份已导出');}
async function readBackup(file){
 if(await isZip(file)){
  const z=await readZip(file),meta=z.get('inknote.json');if(!meta||meta.size>256*1024*1024)throw new Error('不是有效的 InkNote 备份文件。');
  const data=JSON.parse(new TextDecoder().decode(await readEntry(meta)));if(data?.version!==2)throw new Error('不是有效的 InkNote 备份文件。');
  const src=z.get('source.bin');return {data,source:src?()=>readEntry(src):null};
 }
 if(file.size>512*1024*1024)throw new Error('备份文件过大，无法读取。');
 const data=JSON.parse(await file.text());if(data?.version!==1)throw new Error('不是有效的 InkNote 备份文件。');
 const b64=typeof data.pdf==='string'?data.pdf:typeof data.source?.base64==='string'?data.source.base64:null;
 return {data,source:b64?async()=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0)):null};
}
async function importFiles(files){
 if(importing){toast('正在导入，请稍候');return;}importing=true;let last;try{finishText();await flush();for(const f of files){try{if(f.size>1024*1024*1024)throw new Error('文件超过 1 GB，请先拆分再导入。');if(f.name.toLowerCase().endsWith('.inknote'))last=await importBackup(f);else if(f.name.toLowerCase().endsWith('.pdf')||f.type==='application/pdf')last=await importPdf(f);else if([...DIRECT_BOOK_FORMATS,...CONVERT_BOOK_FORMATS].includes(f.name.split('.').at(-1).toLowerCase()))last=await importEbook(f);else throw new Error('请选择 PDF、电子书、TXT 或 .inknote 备份。');}catch(e){failure(new Error(`${f.name}：${e.message}`));}}if(last){await openDoc(last);toast('导入完成，可以开始批注了');}}finally{importing=false;$('#file-input').value='';}}
async function importPdf(file){
 toast('正在读取 '+file.name);const bytes=new Uint8Array(await file.arrayBuffer());const {pdf}=await readPdf(bytes,passwordPrompt);if(pdf.numPages>2000){await pdf.destroy();throw new Error('第一版最多支持 2000 页文档，请先拆分。');}
 const d={id:uid(),title:file.name.replace(/\.pdf$/i,''),kind:'pdf',color:'sand',folder:S.view.startsWith('folder:')?S.view.slice(7):'',createdAt:Date.now(),updatedAt:Date.now(),pages:[],lastPage:0};
 for(let i=0;i<pdf.numPages;i++){const p=await pdf.getPage(i+1),v=p.getViewport({scale:1});d.pages.push({id:uid(),sourceIndex:i,width:v.width,height:v.height,template:'blank',annotations:[],bookmark:false});}
 try{await store.putBinary(d.id,bytes);await store.save(d);}catch(e){await store.remove(d.id);await pdf.destroy();throw e;}S.docs.push(d);cachePdf(d.id,pdf);return d.id;
}
async function importBackup(file,opts={}){
 const sync=!!opts.keepId,{data,source}=opts.data?opts:await readBackup(file);if(data.format!=='inknote'||!data.document||!Array.isArray(data.document.pages))throw new Error('不是有效的 InkNote 备份文件。');
 const raw=data.document;if(raw.kind==='discussion'&&raw.pages.length!==1)throw new Error('帖子备份必须是一页一个帖子。');if(typeof raw.title!=='string'||raw.pages.length<1||raw.pages.length>2000)throw new Error('备份内容无效。');
 const numeric=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
 const color=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v);
 let count=0;
 const pages=raw.pages.map(p=>{if(!numeric(p.width,1,p.infinite?1e12:20000)||!numeric(p.height,1,p.infinite?1e12:20000)||!Array.isArray(p.annotations)||p.annotations.length>50000)throw new Error('页面数据无效。');if(p.sourceIndex!==null&&(!Number.isInteger(p.sourceIndex)||p.sourceIndex<0))throw new Error('PDF 页面索引无效。');
 const annotations=p.annotations.map(a=>{if(!['pen','marker','text','rect','rich'].includes(a.type)||!color(a.color))throw new Error('批注数据无效。');if(a.type==='rich'){if(typeof a.html!=='string'||a.html.length>400000||![a.x,a.y].every(n=>numeric(n,p.infinite?0:-100000,p.infinite?1e12:100000))||!numeric(a.w,20,5000)||!numeric(a.size,1,200))throw new Error('文本框数据无效。');const html=sanitizeHtml(a.html);return {id:uid(),type:'rich',color:a.color,x:a.x,y:a.y,w:a.w,h:numeric(a.h,0,1e6)?a.h:undefined,size:a.size,html,plain:richPlainText(html).slice(0,20000)};}if(a.type==='text'){if(typeof a.text!=='string'||a.text.length>10000||![a.x,a.y].every(n=>numeric(n,p.infinite?0:-100000,p.infinite?1e12:100000))||!numeric(a.size,1,200))throw new Error('文字批注无效。');return {id:uid(),type:'text',color:a.color,text:a.text,dateISO:typeof a.dateISO==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(a.dateISO)?a.dateISO:undefined,x:a.x,y:a.y,size:a.size,w:numeric(a.w,0,100000)?a.w:undefined,h:numeric(a.h,0,100000)?a.h:undefined};}
 if(!numeric(a.width,.1,100))throw new Error('笔迹宽度无效。');if(a.type==='rect'){if(![a.x,a.y].every(n=>numeric(n,p.infinite?0:-100000,p.infinite?1e12:100000))||![a.w,a.h].every(n=>numeric(n,p.infinite?-1e12:-100000,p.infinite?1e12:100000)))throw new Error('形状数据无效。');return {id:uid(),type:'rect',color:a.color,width:a.width,x:a.x,y:a.y,w:a.w,h:a.h};}
 if(!Array.isArray(a.points)||!a.points.length||(count+=a.points.length)>2000000||!a.points.every(q=>[q.x,q.y].every(n=>numeric(n,p.infinite?0:-100000,p.infinite?1e12:100000))&&numeric(q.p,0,1)))throw new Error('笔迹数据无效或过大。');return {id:uid(),type:a.type,color:a.color,width:a.width,pressure:!!a.pressure,points:a.points.map(q=>({x:q.x,y:q.y,p:q.p}))};});
 if(p.infinite&&p.sourceIndex!==null)throw new Error('无限画布不能引用 PDF 页面');
 return {id:uid(),infinite:!!p.infinite,reading:p.reading?validateReading(p.reading):undefined,timeCanvas:!!p.timeCanvas,nextFloorNumber:Number.isSafeInteger(p.nextFloorNumber)&&p.nextFloorNumber>0&&p.nextFloorNumber<1e9?p.nextFloorNumber:undefined,canvasCreatedAt:p.timeCanvas&&numeric(p.canvasCreatedAt,0,8e15)?p.canvasCreatedAt:Date.now(),comments:validateComments(p.comments,new Map(p.annotations.map((a,i)=>[a.id,annotations[i].id]))),sourceIndex:p.sourceIndex,width:p.width,height:p.height,template:['blank','ruled','grid','dot','guide'].includes(p.template)?p.template:'blank',guide:numeric(p.guide,0,2)?p.guide:0,title:typeof p.title==='string'?p.title.slice(0,120):undefined,spacing:SPACINGS.includes(p.spacing)?p.spacing:undefined,margin:p.margin===true||undefined,annotations,bookmark:!!p.bookmark};});
 if(sync&&typeof raw.folder==='string'&&raw.folder&&raw.folder.length<=40&&!S.folders.includes(raw.folder)){S.folders.push(raw.folder);await store.setSetting('folders',S.folders);}
 const d={id:sync&&typeof raw.id==='string'&&/^[\w-]{8,64}$/.test(raw.id)?raw.id:uid(),title:raw.title.slice(0,160),kind:pages.some(p=>p.sourceIndex!==null)?'pdf':pages.some(p=>p.reading)?'ebook':raw.kind==='discussion'?'discussion':'notebook',format:typeof raw.format==='string'?raw.format.slice(0,16):undefined,canvasType:raw.kind==='discussion'?'discussion':pages.some(p=>p.timeCanvas)?'time':'plain',color:['olive','sand','blue','pink'].includes(raw.color)?raw.color:'olive',folder:S.folders.includes(raw.folder)?raw.folder:'',favorite:!!raw.favorite,createdAt:(sync||raw.kind==='discussion')&&numeric(raw.createdAt,0,8e15)?raw.createdAt:Date.now(),updatedAt:sync&&numeric(raw.updatedAt,0,8e15)?raw.updatedAt:Date.now(),lastPage:0,pages};
 if(d.kind==='discussion')ensureDiscussionFloors(d.pages[0]);
 let bytes,pdf;if(pages.some(p=>p.sourceIndex!==null)){bytes=await source?.();if(!bytes)throw new Error('备份缺少原始 PDF。');if(!sync){({pdf}=await readPdf(bytes,passwordPrompt));for(const p of pages){if(p.sourceIndex===null)continue;if(p.sourceIndex>=pdf.numPages){await pdf.destroy();throw new Error('备份页面与原始 PDF 不匹配。');}const v=(await pdf.getPage(p.sourceIndex+1)).getViewport({scale:1});if(Math.abs(v.width-p.width)>1||Math.abs(v.height-p.height)>1){await pdf.destroy();throw new Error('备份页面尺寸不匹配。');}}}}
 if(d.kind==='ebook'&&source)bytes=await source();
 if(sync){if(bytes)await store.putBinary(d.id,bytes);await store.save(d);const i=S.docs.findIndex(x=>x.id===d.id);if(i>=0)S.docs[i]=d;else S.docs.push(d);history.delete(d.id);searchCache.delete(d.id);await releasePdfs(S.active===d.id?d.id:S.active);return d.id;}
 try{if(bytes)await store.putBinary(d.id,bytes);await store.save(d);}catch(e){await store.remove(d.id);if(pdf)await pdf.destroy();throw e;}S.docs.push(d);if(pdf)cachePdf(d.id,pdf);return d.id;
}

function toggleFind(){S.findOpen=!S.findOpen;$('.pdf-find')?.remove();if(!S.findOpen)return;const f=document.createElement('div');f.className='pdf-find';f.setAttribute('role','search');f.innerHTML=`${icon('search')}<input id="pdf-find-input" placeholder="查找原文、文字与批注" aria-label="查找文档内容" value="${E(S.findQuery)}" autocomplete="off"><span id="find-count"></span><button class="icon-btn tiny" data-action="find-prev" title="上一个 (Shift Enter)" aria-label="上一个结果">${icon('left')}</button><button class="icon-btn tiny" data-action="find-next" title="下一个 (Enter)" aria-label="下一个结果">${icon('chevron')}</button><button class="icon-btn tiny" data-action="find" title="关闭 (Esc)" aria-label="关闭查找">${icon('close')}</button>`;$('.editor').append(f);const input=$('#pdf-find-input');input.focus();input.select();let timer,epoch=0;input.oninput=()=>{clearTimeout(timer);const token=++epoch;S.findQuery=input.value.trim();const q=S.findQuery,id=S.active;S.find=[];$('#find-count').textContent=q?'查找中…':'';timer=setTimeout(()=>run(async()=>{if(!q)return;const matches=await pdfTextMatches(doc(),q,passwordPrompt);if(token!==epoch||id!==S.active||!$('#find-count'))return;S.find=matches;S.findIndex=0;$('#find-count').textContent=matches.length?`1 / ${matches.length} 页`:'没有结果';if(matches.length)await goPage(matches[0]);}),300);};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run(()=>findNext(e.shiftKey?-1:1));}if(e.key==='Escape')toggleFind();};}
async function findNext(delta){if(!S.find.length)return;S.findIndex=(S.findIndex+delta+S.find.length)%S.find.length;$('#find-count').textContent=`${S.findIndex+1} / ${S.find.length} 页`;await goPage(S.find[S.findIndex]);}
function showHelp(){
 const keys=(...k)=>k.map(x=>`<kbd class="shortcut">${x}</kbd>`).join('');
 const rows=[['画笔 · 荧光笔 · 橡皮擦',keys('P','H','E')],['文字 · 矩形 · 套索',keys('T','R','L')],['拖动浏览 · 插入批注',keys('V','C')],['撤销 · 重做',keys('Ctrl Z','Ctrl Shift Z')],['保存',keys('Ctrl S')],['文档内查找 · 搜索笔记',keys('Ctrl F','Ctrl K')],['导出 PDF',keys('Ctrl Shift E')],['缩放页面',keys('Ctrl 滚轮')],['翻页',keys('PageUp','PageDown')],['复制 · 剪切 · 粘贴所选',keys('Ctrl C','Ctrl X','Ctrl V')],['复制一份 · 全选',keys('Ctrl D','Ctrl A')],['删除所选内容',keys('Delete')],['切换整笔 / 局部擦除',keys('E','再按 E')],['分屏打开另一本',keys('Ctrl \\')],['完成文字 · 发送回复',keys('Ctrl Enter')]];
 dialog('快捷键与帮助',`<div class="shortcut-list">${rows.map(([a,b])=>`<div class="menu-row"><span>${a}</span><span class="keys">${b}</span></div>`).join('')}</div><div class="help-grid"><div><strong>${icon('pen')}书写</strong><p>开启「仅用笔」后只有触控笔能书写，手指用于滚动。画笔会随笔压变化粗细。</p></div><div><strong>${icon('lasso')}套索</strong><p>框出内容后可拖动、复制、粘贴或删除；双击文字直接修改。</p></div><div><strong>${icon('title')}页面标题</strong><p>在页面顶部写标题，日期和时间显示在标题下方。第 1 页的标题会同步成笔记名称。</p></div><div><strong>${icon('split')}分屏</strong><p>点击顶栏的分屏按钮，在右侧打开另一本笔记，两边各自编辑、各自保存。</p></div><div><strong>${icon('eraser')}橡皮擦</strong><p>「整笔」碰到就删除整条笔迹；「局部」只擦掉经过的部分。</p></div><div><strong>${icon('comment')}批注与帖子</strong><p>批注固定在页面或笔迹上；帖子一页一帖，可多楼层、逐层回复。</p></div><div><strong>${icon('shield')}保存</strong><p>笔记自动保存在本机。左下角「一键导入导出」可以把全部笔记导出到一个文件夹，放进网盘或 U 盘带走。</p></div></div>`);
}
async function settings(){const storage=await navigator.storage?.estimate?.().catch(()=>({}));const used=(storage?.usage||0)/1024/1024;dialog('设置',`<div class="settings-section"><label class="switch setting-switch"><input type="checkbox" id="setting-pen" role="switch" ${S.penOnly?'checked':''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label"><strong>仅允许触控笔书写</strong><small>手指用于滚动和缩放；关闭时鼠标、触控笔和手指都可以书写。</small></span></label></div><div class="field-label">翻页方式</div>${scrollModeChoice(S.scrollMode)}<p class="field-hint">连续滚动：页面上下相连，像 PDF 阅读器一样一直滚下去。单页翻页：一次显示一页，滚到页面底部再滚动就翻到下一页。</p><div class="field-label">书写工具栏位置</div>${dockChoice(S.toolbarDock)}<p class="field-hint">也可以直接拖动工具栏左端的把手，放到页面的任意一边。</p><div class="field-label">本机笔记</div><div class="storage-meter" style="--amount:${Math.min(100,Math.max(1,(storage?.usage||0)/(storage?.quota||1)*100))}%"><span></span></div><p class="storage-text">${S.docs.length} 本笔记 · 已使用约 ${used.toFixed(1)} MB</p><p class="help-note">笔记保存在这台电脑的应用数据中。换电脑时用「导入导出」一键导出全部笔记，再在新电脑导入。</p><div class="menu-choices"><button type="button" id="settings-exchange">${icon('folder')}<span>导入导出文件夹<small>一键导出全部笔记到文件夹，或从文件夹 / 文件一键导入</small></span></button><button type="button" id="settings-converter">${icon('reading')}<span>选择 Calibre 转换组件<small>用于 MOBI、AZW3、RTF 等格式；需先在本机安装 Calibre</small></span></button><button type="button" id="settings-help">${icon('help')}<span>快捷键与使用帮助</span></button></div>${actions('保存设置')}`,{submit:async f=>{S.penOnly=$('#setting-pen').checked;await store.setSetting('penOnly',S.penOnly);setToolbarDock(f.get('dock'));setScrollMode(f.get('scrollMode'),{quiet:true});closeModal();if(S.active&&$('#pen-only')){$('#pen-only').checked=S.penOnly;updateTouch();}toast('设置已保存');}});$('#settings-help').onclick=showHelp;$('#settings-exchange').onclick=()=>run(async()=>{closeModal();await exchangeDialog();});$('#settings-converter').onclick=()=>run(async()=>{if(!window.desktop?.chooseConverter)throw new Error('请在独立桌面版中选择 Calibre 的 ebook-convert.exe');const r=await window.desktop.chooseConverter();if(r?.error)throw new Error(r.error);if(r?.selected)toast('Calibre 转换组件已设置');});}
async function newDiscussion(){
 let images=[],reading=false;
 dialog('新建帖子',`<label class="field-label" for="post-title">标题</label><input class="field-input" name="title" id="post-title" maxlength="160" required placeholder="这一页想记录什么？" autocomplete="off"><label class="field-label" for="post-body">主楼 · 1楼</label><textarea class="field-input" name="body" id="post-body" rows="6" maxlength="20000" placeholder="写下正文。发表后可以继续发 2 楼、3 楼，或逐层回复。" required></textarea><div class="compose-image-row"><label class="btn tonal small" for="post-image-files">${icon('image')}添加图片</label><input id="post-image-files" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple><span class="field-hint">最多 12 张，显示为正方形缩略图，点击看原图</span></div><div class="comment-images" id="post-images-preview"></div><p class="help-note">每个帖子单独占一页，创建日期和时间自动记录。</p>${actions('发表帖子')}`,{submit:async f=>{
  if(reading){toast('图片正在准备，请稍候');return;}const title=f.get('title').trim(),body=f.get('body').trim();if(!title||!body)return;
  const d=createDiscussion(title,S.view.startsWith('folder:')?S.view.slice(7):'',Date.now(),body,images);await flush();await store.save(d);S.docs.push(d);closeModal();await openDoc(d.id);toast('帖子已发表，日期和时间已自动记录');
 }});
 markdownTools($('#post-body'));
 $('#post-image-files').onchange=e=>run(async()=>{const files=[...e.target.files];if(images.length+files.length>12)throw new Error('每个主楼最多 12 张图片');reading=true;try{for(const file of files){const image=await readCommentImage(file);if(images.reduce((n,p)=>n+p.src.length,0)+image.src.length>64*1024*1024)throw new Error('图片合计超过 48 MB');images.push(image);}paint();}finally{reading=false;e.target.value='';}});
 function paint(){const target=$('#post-images-preview');if(!target)return;target.innerHTML=images.map((image,i)=>`<div class="draft-image"><img class="comment-image-thumb" src="${image.thumbnail||image.src}" alt="${E(image.name)}"><button class="draft-image-remove" type="button" data-remove-post-image="${i}" aria-label="移除图片" title="移除">×</button></div>`).join('');target.querySelectorAll('[data-remove-post-image]').forEach(b=>b.onclick=()=>{images.splice(+b.dataset.removePostImage,1);paint();});}
}
function renderDiscussion(){
 const d=doc();S.commentsOpen=true;queueMicrotask(placeToolbar);
 view.innerHTML=`<main class="editor discussion-app">${titlebar(['discussion-home','返回帖子列表'],`<button class="icon-btn" data-action="undo" title="撤销 (Ctrl Z)" aria-label="撤销">${icon('undo')}</button><button class="icon-btn" data-action="redo" title="重做 (Ctrl Shift Z)" aria-label="重做">${icon('redo')}</button><button class="icon-btn" data-action="discussion-backup" title="导出 .inknote 备份 (Ctrl Shift E)" aria-label="导出备份">${icon('download')}</button><button class="btn primary" data-action="new-discussion">${icon('plus')}<span class="btn-label">新建帖子</span></button>`)}
 <div class="discussion-scroll" id="discussion-scroll"><div class="discussion-column">
  <div class="discussion-intro"><div class="post-kicker"><span class="kicker-icon">${icon('post')}</span><span>帖子</span><span aria-hidden="true">·</span><time datetime="${new Date(d.createdAt).toISOString()}">创建于 ${E(formatTimestamp(d.createdAt))}</time>${d.folder?`<span aria-hidden="true">·</span><span>${E(d.folder)}</span>`:''}</div>
   <h1 data-action="rename" tabindex="0" role="button" title="点击重命名">${E(d.title)}</h1>
   <div class="post-toolbar"><span class="post-stats" id="discussion-total"></span><span class="spacer"></span><label class="search-bar compact">${icon('search')}<input type="search" id="discussion-search" placeholder="搜索本帖正文、回复和图片名" aria-label="搜索帖子回复" autocomplete="off"></label></div>
  </div>
  <section class="comments-panel" id="comments-panel" aria-label="楼层与回复"></section>
 </div></div></main>`;
 refreshTitle();bindTabRename();renderComments();refreshHistory();refreshDiscussionStats();status();$('#discussion-search').oninput=e=>{S.discussionQuery=e.target.value;renderComments();};
}
function refreshDiscussionStats(){const el=$('#discussion-total');if(!el||doc()?.kind!=='discussion')return;const stats=discussionStats(doc());el.textContent=`${stats.threads} 个楼层 · ${stats.replies} 条回复 · ${stats.images} 张图片`;}
// Scroll a just-posted reply into view above the sticky composer, which would otherwise cover its last lines.
function revealComment(el){if(!el)return;el.scrollIntoView({block:'nearest'});const c=document.querySelector('.comment-compose');if(!c)return;const over=el.getBoundingClientRect().bottom-c.getBoundingClientRect().top+12;if(over<=0)return;let p=el.parentElement;while(p&&!(p.scrollHeight>p.clientHeight&&/auto|scroll/.test(getComputedStyle(p).overflowY)))p=p.parentElement;p?.scrollBy(0,over);}
function newDiscussionThread(){if(doc()?.kind==='discussion'){if(S.commentImagesBusy){toast('图片正在准备，请稍候');return;}const previous=S.commentDraft;S.commentDraft=discussionDraft(page());if(previous?.pageId===page().id){S.commentDraft.text=$('#comment-composer')?.value??previous.text??'';S.commentDraft.images=previous.images||[];}S.commentFocus=true;renderComments();$('#comment-composer')?.scrollIntoView({block:'center',behavior:'smooth'});return;}const v=page().infinite?S.viewport:null;startThreadAt({x:(v?.x||0)+46,y:(v?.y||0)+110});}
function makeCanvasPage(template,infinite=true,kind='plain',{spacing='standard',margin,title=''}={}){
 const p=infinite?newInfinitePage(template):newPage(template);p.comments=[];p.title=title;p.spacing=SPACINGS.includes(spacing)?spacing:'standard';p.margin=margin===undefined?template==='ruled'||template==='grid':!!margin;
 if(kind==='time'){p.timeCanvas=true;p.canvasCreatedAt=Date.now();}return p;
}
function drawCommentPins(ctx,p){
 ctx.save();const all=roots(p);all.forEach((root,i)=>{
  const a=commentPosition(p,root);if(p.infinite&&S.viewport&&!inside(a,{x:S.viewport.x,y:S.viewport.y,w:S.viewport.w,h:S.viewport.h},20/S.zoom))return;
  const active=S.activeThread===root.id,r=(active?12.5:11)/S.zoom;
  ctx.fillStyle='rgba(60,64,67,.22)';ctx.beginPath();ctx.arc(a.x,a.y+1.2/S.zoom,r+.6/S.zoom,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=active?S.accent.tertiary:S.accent.primary;ctx.strokeStyle='#ffffff';ctx.lineWidth=2/S.zoom;ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#ffffff';ctx.font=`600 ${10.5/S.zoom}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),a.x,a.y+.4/S.zoom);
 });ctx.restore();
}
function toggleComments(){if(doc().kind==='discussion'){newDiscussionThread();return;}S.commentsOpen=!S.commentsOpen;S.panelPref=S.commentsOpen;renderComments();}
function startThreadAt(position,annotationIds=[]){
 S.commentDraft={pageId:page().id,anchor:{...position},annotationIds,parentId:null,text:'',images:[]};S.commentsOpen=true;S.commentFocus=true;renderComments();
}
function beginReply(id){const parent=(page().comments||[]).find(n=>n.id===id);if(!parent)return;S.commentDraft=doc().kind==='discussion'?discussionDraft(page(),id):{pageId:page().id,parentId:id,text:'',images:[]};S.activeThread=parent.threadId;S.commentsOpen=true;S.commentFocus=true;renderComments();drawInk();}
// Posts are stored as Markdown: a small format row above each post editor, and pasted formatted content
// (web pages, AI answers, Word) arrives as Markdown with its headings, lists, bold, links and formulas.
function markdownTools(area){
 if(!area||area.previousElementSibling?.classList.contains('md-tools'))return;
 const bar=document.createElement('div');bar.className='md-tools';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','格式');
 const items=[['bold','<b>B</b>','加粗'],['italic','<i>I</i>','斜体'],['heading','H','标题'],['ul','•','列表'],['ol','1.','编号'],['quote','❝','引用'],['code','&lt;/&gt;','代码'],['math','∑','公式（LaTeX）'],['link','链接','链接']];
 bar.innerHTML=items.map(([k,l,tt])=>`<button type="button" data-md="${k}" title="${tt}" aria-label="${tt}">${l}</button>`).join('')+'<span class="md-hint">支持 Markdown 和 $公式$</span>';
 area.before(bar);bar.onpointerdown=e=>e.preventDefault();
 bar.onclick=e=>{const k=e.target.closest('[data-md]')?.dataset.md;if(!k)return;const s=area.selectionStart,en=area.selectionEnd,v=area.value,sel=v.slice(s,en);
  const lineStart=v.lastIndexOf('\n',s-1)+1;let text,cs,ce;
  const wrap=(l,r,ph)=>{const body=sel||ph;text=v.slice(0,s)+l+body+r+v.slice(en);cs=s+l.length;ce=cs+body.length;};
  const prefix=p=>{const block=v.slice(lineStart,en)||'';const lines=(block||'').split('\n').map((x,i)=>(typeof p==='function'?p(i):p)+x);text=v.slice(0,lineStart)+lines.join('\n')+v.slice(en);cs=ce=lineStart+lines.join('\n').length;};
  if(k==='bold')wrap('**','**','粗体');else if(k==='italic')wrap('*','*','斜体');else if(k==='code')sel.includes('\n')?wrap('```\n','\n```','代码'):wrap('`','`','代码');
  else if(k==='math')sel.includes('\n')?wrap('$$\n','\n$$','x^2'):wrap('$','$','x^2');else if(k==='link')wrap('[',`](https://)`,'链接文字');
  else if(k==='heading')prefix('## ');else if(k==='ul')prefix('- ');else if(k==='ol')prefix(i=>`${i+1}. `);else if(k==='quote')prefix('> ');
  area.value=text;area.focus();area.setSelectionRange(cs,ce);area.dispatchEvent(new Event('input',{bubbles:true}));};
 area.addEventListener('paste',e=>{const html=e.clipboardData.getData('text/html');if(!html||!html.trim())return;const md=htmlToMarkdown(html);if(!md)return;e.preventDefault();const s=area.selectionStart,en=area.selectionEnd;area.setRangeText(md,s,en,'end');area.dispatchEvent(new Event('input',{bubbles:true}));});
}
function renderComments(){
 const panel=$('#comments-panel');if(!panel||!page())return;const forum=doc().kind==='discussion';
 if(S.commentDraft?.pageId!==page().id)S.commentDraft=null;
 if(forum&&!S.commentDraft)S.commentDraft=discussionDraft(page());if(forum)S.commentsOpen=true;
 const layout=forum?discussionLayout(page()):null;
 const all=forum?matchingThreads(page(),S.discussionQuery):roots(page()),count=$('#comment-count');if(count){count.textContent=all.length;count.classList.toggle('has',all.length>0);}
 panel.hidden=!S.commentsOpen;$('.comment-pane-toggle')?.classList.toggle('on',!!S.commentsOpen);if(!S.commentsOpen)return;
 const draft=S.commentDraft,parent=draft?.parentId?(page().comments||[]).find(n=>n.id===draft.parentId):null,parentInfo=parent&&layout?.get(parent.id);
 const composeLabel=forum?(parentInfo?`回复 ${parentInfo.label}`:`发布 ${page().nextFloorNumber}楼`):(parent?'回复批注':'新的页面批注');
 const composeDetail=forum?(parentInfo?`发布到第 ${parentInfo.depth+2} 层`:'独立的新楼层'):'';
 const submitLabel=forum?(parent?'发布回复':`发布 ${page().nextFloorNumber}楼`):(parent?'回复':'保存批注');
 const total=forum?roots(page()).length:all.length;
 panel.innerHTML=`<div class="comments-head"><strong>${forum?'楼层与回复':icon('comment')+'页面批注'}</strong><span class="count-badge">${forum&&S.discussionQuery?`${all.length} / ${total}`:all.length}</span><span class="spacer"></span>${forum?`<button class="btn tonal" data-action="new-discussion-thread" title="在本帖发布一个独立的新楼层">${icon('plus')}发新楼层</button>`:`<button class="icon-btn" data-action="comments" aria-label="收起批注面板" title="收起">${icon('close')}</button>`}</div><div class="comments-scroll">${!all.length?`<div class="comments-empty">${icon(forum&&S.discussionQuery?'search':'comment')}<p>${forum?(S.discussionQuery?'没有找到相关楼层或回复。':'还没有楼层。<br>在下面发布 1 楼，文字或图片都可以。'):'在页面上固定一个想法。<br>选择批注工具 <kbd class="shortcut">C</kbd> 后点击页面，<br>或先用套索框选笔迹再添加。'}</p></div>`:''}${all.map((root,i)=>{
  const nodes=commentTree(page(),root.id),folded=S.collapsedThreads.has(root.id);
  const visible=nodes.filter(({depth})=>!folded||depth===0),renderItem=({node,depth})=>{
   const info=layout?.get(node.id),indent=forum?0:Math.min(depth,5)*14;
   const where=info?(depth?`<span class="comment-location">${E(info.label)}</span><span class="comment-depth">第${depth+1}层</span><button class="comment-parent" data-action="comment-focus" data-id="${node.parentId}" title="跳到 ${E(info.parentLabel)}">${icon('reply')}${E(info.parentLabel)}</button>`:`<span class="comment-location floor">${E(info.label)}</span>`):'';
   const edited=node.updatedAt&&node.updatedAt-node.createdAt>1000?`<span class="comment-edited" title="编辑于 ${E(formatTimestamp(node.updatedAt))}">已编辑</span>`:'';
   return `<article class="comment-item ${depth?'comment-reply':'comment-root'}" id="comment-${node.id}" ${indent?`style="margin-left:${indent}px"`:''}><span class="comment-avatar" aria-hidden="true">我</span><div class="comment-content"><div class="comment-meta"><span class="comment-author">我</span>${where}<time datetime="${new Date(node.createdAt).toISOString()}">${E(formatTimestamp(node.createdAt))}</time>${edited}</div>${node.body?`<div class="comment-body rich">${postHtml(node.body)}</div>`:''}${commentImages(node)}<div class="comment-actions"><button data-action="comment-reply" data-id="${node.id}">${icon('reply')}回复</button><button data-action="comment-edit" data-id="${node.id}">编辑</button><button data-action="comment-delete" data-id="${node.id}">删除</button></div></div></article>`;
  };
  return `<section class="comment-thread ${S.activeThread===root.id?'active':''}" id="thread-${root.id}">${forum?'':`<div class="thread-bar"><button class="thread-number" data-action="comment-locate" data-id="${root.id}" title="在页面上定位">${i+1}</button><span>页面批注</span><span class="spacer"></span><button class="link-btn" data-action="comment-locate" data-id="${root.id}">定位</button></div>`}${forum?renderCommentTree(visible,renderItem):visible.map(renderItem).join('')}${nodes.length>1?`<button class="thread-collapse ${folded?'folded':''}" data-action="comment-collapse" data-id="${root.id}" aria-expanded="${!folded}">${icon('down')}${folded?'展开':'收起'} ${nodes.length-1} 条回复</button>`:''}</section>`;
 }).join('')}</div><div class="comment-compose ${parent?'is-reply':''}">${draft?`<div class="compose-label"><span class="compose-target">${icon(parent?'reply':forum?'plus':'comment')}${E(composeLabel)}</span>${composeDetail?`<span class="compose-detail">${E(composeDetail)}</span>`:''}<span class="spacer"></span>${forum&&parent?`<button class="link-btn compose-new-floor" data-action="new-discussion-thread">改发新楼层</button>`:''}<button class="icon-btn tiny" data-action="comment-cancel" title="${forum&&!parent?'清空':'取消'}" aria-label="取消输入">${icon('close')}</button></div><textarea id="comment-composer" maxlength="20000" rows="3" placeholder="${forum?(parent?`回复 ${E(parentInfo?.label||'')}…`:'在本帖发布一个新楼层…'):'写下你的批注…'}" aria-label="${forum?'回复内容':'批注内容'}">${E(draft.text||'')}</textarea>${draftImages(draft)}<div class="compose-footer"><button class="icon-btn" data-action="comment-image-add" ${S.commentImagesBusy?'disabled':''} title="添加图片（显示为正方形缩略图）" aria-label="添加图片">${S.commentImagesBusy?'<i class="loading-inline"></i>':icon('image')}</button><span class="compose-hint">Ctrl Enter 发送 · 自动记录时间</span><button class="btn primary send-btn" data-action="comment-submit">${icon('send')}${E(submitLabel)}</button></div>`:`<button class="btn tonal block" data-action="tool" data-value="comment">${icon('plus')}在页面上插入批注</button><p>批注和回复保存在本机，随备份一起导出。</p>`}</div>`;
 renderMath(panel);const composer=$('#comment-composer');if(composer){markdownTools(composer);composer.oninput=()=>{if(S.commentDraft)S.commentDraft.text=composer.value;};composer.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();run(submitComment);}};if(S.commentFocus){S.commentFocus=false;composer.focus();}}
}
function focusDiscussionComment(id){
 if(doc()?.kind!=='discussion')return;const node=(page().comments||[]).find(n=>n.id===id);if(!node)return;
 S.activeThread=node.threadId;S.collapsedThreads.delete(node.threadId);S.discussionQuery='';const input=$('#discussion-search');if(input)input.value='';
 renderComments();document.querySelector('#comment-'+id)?.scrollIntoView({block:'center',behavior:'smooth'});
}
async function submitComment(){
 const draft=S.commentDraft;if(!draft||draft.pageId!==page().id)return;if(S.commentImagesBusy){toast('图片正在准备，请稍候');return;}const value=$('#comment-composer')?.value||draft.text,before=pageSnapshot();let node;
 if(doc().kind==='discussion'){node=publishDiscussionDraft(page(),draft,value);S.discussionQuery='';const input=$('#discussion-search');if(input)input.value='';}else if(draft.parentId)node=replyTo(page(),draft.parentId,value,Date.now(),draft.images||[]);else node=addThread(page(),draft.anchor,value,draft.annotationIds,Date.now(),draft.images||[]);
 S.commentDraft=null;S.activeThread=node.threadId;S.collapsedThreads.delete(node.threadId);remember(before);renderComments();if(doc().kind==='discussion'){refreshDiscussionStats();}if(page().infinite)paintInfinite(false);else drawInk();revealComment(document.querySelector('#comment-'+node.id));
}
function collapseThread(id){if(S.collapsedThreads.has(id))S.collapsedThreads.delete(id);else S.collapsedThreads.add(id);renderComments();}
async function locateComment(id){
 const root=roots(page()).find(n=>n.id===id);if(!root)return;S.activeThread=id;if(doc().kind==='discussion'){renderComments();document.querySelector('#thread-'+id)?.scrollIntoView({block:'nearest'});return;}const p=commentPosition(page(),root),w=$('#workspace');w.scrollTo({left:Math.max(0,p.x*S.zoom-w.clientWidth/2),top:Math.max(0,p.y*S.zoom-w.clientHeight/2),behavior:'smooth'});renderComments();drawInk();
}
function editCommentDialog(id){const node=(page().comments||[]).find(n=>n.id===id);if(!node)return;dialog(doc().kind==='discussion'?'编辑内容':'编辑批注',`<label class="field-label" for="comment-edit-body">内容</label><textarea class="field-input" id="comment-edit-body" name="body" rows="8" maxlength="20000" required>${E(node.body)}</textarea>${actions('保存')}`,{submit:async f=>{const before=pageSnapshot();editComment(page(),id,f.get('body'));closeModal();remember(before);drawInk();}});markdownTools($('#comment-edit-body'));}
function deleteCommentDialog(id){const node=(page().comments||[]).find(n=>n.id===id);if(!node)return;dialog(doc().kind==='discussion'?'删除这一条及其回复？':'删除这条批注？',`<p class="help-note">${doc().kind==='discussion'?'这一条和它下面的所有回复会一起移除，其他楼层的编号不会改变。':'这条批注和它下面的回复会一起移除。'}可以用 Ctrl Z 撤销。</p>${actions('删除',true)}`,{submit:async()=>{const before=pageSnapshot();removeComment(page(),id);S.commentDraft=null;closeModal();remember(before);drawInk();}});}
function paintInfinite(allowGrowth=false){
 const p=page(),workspace=$('#workspace'),wrapper=$('#page-wrapper');if(!p?.infinite||!workspace||!wrapper)return;
 const zoom=S.zoom,ratio=Math.min(devicePixelRatio||1,2),pad=getComputedStyle(workspace),left=parseFloat(pad.paddingLeft)||35,top=parseFloat(pad.paddingTop)||30;
 const x=Math.max(0,(workspace.scrollLeft-left)/zoom-8),y=Math.max(0,(workspace.scrollTop-top)/zoom-8);
 if(allowGrowth&&growExtent(p,x+workspace.clientWidth/zoom,y+workspace.clientHeight/zoom))save(false);
 wrapper.style.width=p.width*zoom+'px';wrapper.style.height=p.height*zoom+'px';
 const w=Math.max(1,Math.min(p.width-x,workspace.clientWidth/zoom+16)),h=Math.max(1,Math.min(p.height-y,workspace.clientHeight/zoom+16));
 S.viewport={x,y,w,h,width:w,height:h,scale:zoom*ratio};
 for(const c of [$('#pdf-canvas'),$('#ink-canvas')]){c.width=Math.ceil(w*zoom*ratio);c.height=Math.ceil(h*zoom*ratio);c.style.width=w*zoom+'px';c.style.height=h*zoom+'px';c.style.left=x*zoom+'px';c.style.top=y*zoom+'px';}
 const ctx=$('#pdf-canvas').getContext('2d');ctx.save();ctx.scale(zoom*ratio,zoom*ratio);ctx.translate(-x,-y);drawInfinitePaper(ctx,p,S.viewport);ctx.restore();drawInk();
}
async function insertDate(){
 finishText();const now=new Date(),fmt=o=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',...o}).format(now),today=fmt({year:'numeric',month:'2-digit',day:'2-digit'}),time=fmt({hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 dialog('插入日期和时间',`<div class="field-row"><div><label class="field-label" for="date-value">日期</label><input class="field-input" type="date" id="date-value" name="date" value="${today}" required></div><div><label class="field-label" for="time-value">时间</label><input class="field-input" type="time" id="time-value" name="time" value="${time}"></div></div><div class="settings-section"><label class="switch setting-switch"><input type="checkbox" name="withTime" role="switch"><span class="switch-track" aria-hidden="true"></span><span class="switch-label"><strong>同时插入时间</strong><small>例如「2026年11月7日 15:06」。时间按北京时间。</small></span></label></div><p class="help-note">会作为文字插入到当前视野左上方，可用套索移动，点击可修改。</p>${actions('插入')}`,{submit:async f=>{
  const iso=f.get('date'),withTime=f.get('withTime')==='on'&&/^\d{2}:\d{2}$/.test(f.get('time')||''),label=dateLabel(iso)+(withTime?' '+f.get('time'):''),before=pageSnapshot(),v=page().infinite?S.viewport:null,g=pageHeader(page());
  const y=Math.max((v?.y||0)+36,g.bottom+12);page().annotations.push({id:uid(),type:'text',text:label,dateISO:iso,x:(v?.x||0)+45,y,size:16,w:label.length*12,h:24,color:S.color});remember(before);closeModal();redrawPage();toast(withTime?'日期和时间已插入':'日期已插入，可用套索移动');
 }});
}
async function importEbook(file){
 const format=file.name.split('.').at(-1).toLowerCase(),original=new Uint8Array(await file.arrayBuffer());let bytes=original,parseFormat=format;
 toast('正在读取电子书 '+file.name);
 if(CONVERT_BOOK_FORMATS.includes(format)){
  if(!window.desktop?.convertEbook)throw new Error('此格式需要独立桌面版和 Calibre 转换组件。EPUB、TXT、FB2、CBZ 可以直接导入。');
  toast('正在使用本机 Calibre 转换…');const converted=await window.desktop.convertEbook({name:file.name,bytes});if(!converted?.ok)throw new Error(converted?.error||'电子书转换未完成');bytes=new Uint8Array(converted.bytes);parseFormat='epub';
 }
 const book=await parseBook(bytes,file.name,parseFormat),pages=await paginateBook(book);
 const d={id:uid(),title:book.title,author:book.author,kind:'ebook',format:format.toUpperCase(),color:'blue',folder:S.view.startsWith('folder:')?S.view.slice(7):'',createdAt:Date.now(),updatedAt:Date.now(),lastPage:0,pages};
 try{await store.putBinary(d.id,original);await store.save(d);}catch(e){await store.remove(d.id);throw e;}S.docs.push(d);return d.id;
}
function commentImages(node){return !node.images?.length?'':`<div class="comment-images">${node.images.map((image,i)=>`<button class="comment-image-thumb" data-action="comment-image-open" data-comment-id="${node.id}" data-index="${i}" title="点击查看原图：${E(image.name)}"><img loading="lazy" src="${image.thumbnail||image.src}" alt="${E(image.name)}"></button>`).join('')}</div>`;}
function draftImages(draft){return !draft.images?.length?'':`<div class="comment-images draft-images">${draft.images.map((image,i)=>`<div class="draft-image"><button class="comment-image-thumb" data-action="comment-draft-image-open" data-index="${i}" title="查看原图"><img src="${image.thumbnail||image.src}" alt="${E(image.name)}"></button><button class="draft-image-remove" data-action="comment-draft-image-remove" data-index="${i}" title="移除图片">×</button></div>`).join('')}</div>`;}
async function addCommentImages(files){
 const draft=S.commentDraft;if(!draft)return;if((draft.images?.length||0)+files.length>12)throw new Error('每条批注最多 12 张图片');S.commentImagesBusy=true;renderComments();
 try{for(const file of files){const image=await readCommentImage(file);if(S.commentDraft!==draft)return;draft.images??=[];const total=draft.images.reduce((n,p)=>n+p.src.length,0)+image.src.length;if(total>64*1024*1024)throw new Error('这条批注的图片合计超过 48 MB，请分条插入');draft.images.push(image);}}
 finally{S.commentImagesBusy=false;$('#comment-image-input').value='';renderComments();}
}
function previewImage(image){if(!image)return;dialog(image.name||'图片',`<img class="lightbox-image" src="${image.src}" alt="${E(image.name||'图片')}"><p class="lightbox-caption">原图 ${image.width} × ${image.height} · 按窗口比例显示 · Esc 关闭</p>`);modal.classList.add('image-lightbox');}
function openCommentImage(id,index){const node=(page().comments||[]).find(n=>n.id===id);previewImage(node?.images?.[index]);}
function openDraftImage(index){previewImage(S.commentDraft?.images?.[index]);}
// ---------- Split view (like Chrome's split tabs) ----------
function applySplitRatio(){if(S.split)view.style.flex=`0 0 ${Math.round(S.splitRatio*1000)/10}%`;}
function refreshSplitButton(){document.querySelectorAll('.split-toggle').forEach(b=>{b.classList.toggle('on',!!S.split);b.setAttribute('aria-pressed',!!S.split);b.title=S.split?'关闭分屏':'分屏：在右侧打开另一本笔记 (Ctrl \\)';});}
async function reloadDoc(id){
 const fresh=await store.get(id);history.delete(id);searchCache.delete(id);
 const i=S.docs.findIndex(d=>d.id===id);if(fresh){if(i>=0)S.docs[i]=fresh;else S.docs.push(fresh);}else if(i>=0)S.docs.splice(i,1);
 if(S.active)refreshTitle();
}
function bindDivider(divider){
 const setRatio=r=>{S.splitRatio=clamp(r,.25,.75);applySplitRatio();};
 divider.onpointerdown=e=>{e.preventDefault();divider.setPointerCapture(e.pointerId);document.body.classList.add('split-dragging');const rect=app.getBoundingClientRect();
  divider.onpointermove=m=>setRatio((m.clientX-rect.left)/rect.width);
  divider.onpointerup=divider.onpointercancel=()=>{divider.onpointermove=null;alignGlobalBar();document.body.classList.remove('split-dragging');run(()=>store.setSetting('splitRatio',S.splitRatio));if(page()?.infinite)paintInfinite(false);};};
 divider.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setRatio(S.splitRatio+(e.key==='ArrowLeft'?-.05:.05));run(()=>store.setSetting('splitRatio',S.splitRatio));}};
 divider.ondblclick=()=>{setRatio(.5);run(()=>store.setSetting('splitRatio',.5));};
}
async function openSplit(id){
 if(EMBED)return;const d=S.docs.find(x=>x.id===id);if(!d)return;
 if(id===S.active){toast('左右两侧不能打开同一本笔记',true);return;}
 if(S.split){if(S.split.id===id)return;await closeSplit();}
 finishText();await flush();
 const divider=document.createElement('div');divider.className='split-divider';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-label','分隔条：拖动或用方向键调整宽度，双击恢复一半');divider.title='拖动调整宽度，双击恢复一半';
 const pane=document.createElement('section');pane.className='split-pane';pane.setAttribute('aria-label','右侧分屏：'+d.title);
 const frame=document.createElement('iframe');frame.title='右侧分屏：'+d.title;frame.src='index.html?pane=split&doc='+encodeURIComponent(id);pane.append(frame);
 app.append(divider,pane);S.split={id,pane,divider,frame};document.body.classList.add('split-open');applySplitRatio();bindDivider(divider);refreshTitle();refreshSplitButton();
 placeToolbar();requestAnimationFrame(()=>{if(page()?.infinite)paintInfinite(false);else run(fitIfOverflow);});
}
async function closeSplit({reload=true}={}){
 const s=S.split;if(!s)return;
 try{await Promise.race([s.frame.contentWindow?.__inknoteEmbed?.flush(),new Promise(r=>setTimeout(r,5000))]);}catch{}
 s.pane.remove();s.divider.remove();S.split=null;document.body.classList.remove('split-open');view.style.flex='';placeToolbar();
 if(reload)await reloadDoc(s.id);refreshTitle();refreshSplitButton();
 if(page()?.infinite)requestAnimationFrame(()=>paintInfinite(false));
}
async function swapSplit(){const s=S.split;if(!s||!S.active)return;const left=S.active,right=s.id;await closeSplit();await openDoc(right);await openSplit(left);toast('已交换左右两侧');}
function splitChooser(){
 if(S.split){run(closeSplit);return;}
 const others=S.docs.filter(d=>d.id!==S.active),tabs=S.tabs.filter(id=>id!==S.active).map(id=>others.find(d=>d.id===id)).filter(Boolean);
 const rest=others.filter(d=>!S.tabs.includes(d.id)).sort((a,b)=>(b.lastOpened||b.updatedAt)-(a.lastOpened||a.updatedAt)).slice(0,40);
 const item=d=>`<button type="button" data-split="${d.id}">${typeIcon(d,'menu-type')}<span>${E(d.title)}<small>${E(typeInfo(d).label)} · ${relative(d.updatedAt)}${d.folder?' · '+E(d.folder):''}</small></span></button>`;
 dialog('在右侧分屏打开',`${tabs.length?`<div class="field-label">已打开的标签</div><div class="menu-choices">${tabs.map(item).join('')}</div>`:''}<div class="field-label">${tabs.length?'其他笔记':'选择一本笔记'}</div><div class="menu-choices">${rest.map(item).join('')||'<p class="help-note">没有其他笔记。先新建或导入一本，再来分屏。</p>'}</div>`,{subtitle:'左右两侧各自编辑、各自保存。同一本笔记不能同时在两侧打开。拖动中间的分隔条可以调整宽度。'});
 modal.querySelectorAll('[data-split]').forEach(b=>b.onclick=()=>run(async()=>{closeModal();await openSplit(b.dataset.split);}));
}

// ---------- OneNote-style page title ----------
const DEFAULT_TITLES=['未命名笔记'];
function titleEditable(p){return !!p&&p.sourceIndex===null&&!p.reading&&p.template!=='guide'&&doc()?.kind==='notebook';}
function updateThumbTitle(i,text){const label=document.querySelector(`.page-thumb[data-index="${i}"] .thumb-title`);if(label)label.textContent=text;}
// Page 1's title and the notebook name stay linked while they match (or while the notebook is still untitled).
function setPageTitle(i,value){
 const d=doc(),p=d.pages[i];if(!p)return false;value=String(value||'').trim().slice(0,120);const old=p.title||'';
 if(value===old&&p.title!==undefined)return false;if(p.title===undefined&&!value)return false;
 p.title=value;if(i===0&&value&&(d.title===old||DEFAULT_TITLES.includes(d.title))){d.title=value;searchCache.delete(d.id);refreshTitle();}
 updateThumbTitle(i,value);return true;
}
async function renamePage(i=S.page){
 const p=doc()?.pages[i];if(!p)return;const value=await ask('重命名页面','页面标题',p.title||'',{ok:'保存'});if(value===null)return;
 const before=pageSnapshot();if(setPageTitle(i,value)){remember(before);if(i===S.page)await showPage({resetScroll:false});updateThumb(i);}
}
function placeTitleInput(){
 const p=page(),wrapper=$('#page-wrapper');if(!wrapper)return;let input=$('#page-title');
 if(!titleEditable(p)){input?.remove();return;}
 if(!input){input=document.createElement('input');input.id='page-title';input.className='page-title-input';input.maxLength=120;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label','页面标题');wrapper.append(input);bindTitleInput(input);}
 const g=pageHeader(p),z=S.zoom;
 if(document.activeElement!==input)input.value=p.title||'';
 input.placeholder=p.title===undefined?'添加页面标题':'页面标题';input.classList.toggle('legacy',p.title===undefined);input.dataset.pageId=p.id;
 Object.assign(input.style,{left:(g.x-6)*z+'px',top:g.top*z+'px',width:(g.width+12)*z+'px',height:g.h*z+'px',fontSize:g.size*z+'px',padding:`0 ${6*z}px`});
}
function bindTitleInput(input){
 let before=null,old='';
 input.onfocus=()=>{before=pageSnapshot();old=page()?.title||'';};
 input.oninput=()=>updateThumbTitle(S.page,input.value.trim());
 input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();input.blur();}if(e.key==='Escape'){input.value=old;input.blur();}};
 input.onblur=()=>{if(!S.active||input.dataset.pageId!==page()?.id)return;if(setPageTitle(S.page,input.value)){remember(before);run(()=>showPage({resetScroll:false}));}else updateThumbTitle(S.page,page().title||'');};
}

// ---------- Text boxes: click an existing one to edit it ----------

// ---------- Eraser: whole strokes, or only the part you rub over ----------
function densify(points,step){const out=[points[0]];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step);for(let k=1;k<n;k++){const t=k/n;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,p:a.p+(b.p-a.p)*t});}out.push(b);}return out;}
function rectToStroke(a){const x2=a.x+a.w,y2=a.y+a.h;return {id:a.id,type:'pen',color:a.color,width:a.width,pressure:false,points:[[a.x,a.y],[x2,a.y],[x2,y2],[a.x,y2],[a.x,a.y]].map(([x,y])=>({x,y,p:.75}))};}
function partialErase(from,to,r){
 const box={x:Math.min(from.x,to.x)-r-60,y:Math.min(from.y,to.y)-r-60,w:Math.abs(to.x-from.x)+2*r+120,h:Math.abs(to.y-from.y)+2*r+120},out=[];let changed=false;
 const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/Math.max(1,r/2)));
 for(const a of page().annotations){
  if(!intersects(bounds(a),box)){out.push(a);continue;}
  if(a.type==='text'||a.type==='rich'){let hit=false;for(let i=0;i<=steps&&!hit;i++)hit=hitAnnotation(a,{x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps},r);if(hit)changed=true;else out.push(a);continue;}
  const stroke=a.type==='rect'?rectToStroke(a):a,pad=r+stroke.width/2,pts=densify(stroke.points,Math.max(.4,r/3)),hit=pts.map(q=>distanceToSegment(q,from,to)<=pad);
  if(!hit.some(Boolean)){out.push(a);continue;}
  changed=true;let piece=[],first=true;const keep=()=>{if(piece.length>=2){out.push({...stroke,id:first?a.id:uid(),points:piece});first=false;}piece=[];};
  pts.forEach((q,i)=>{if(hit[i])keep();else piece.push(q);});keep();
 }
 if(changed)page().annotations=out;return changed;
}

// ---------- Selection: copy, cut, paste, duplicate, select all ----------
function redrawPage(){if(page()?.infinite)paintInfinite(false);else drawInk();}
function selectedItems(){return page().annotations.filter(a=>S.selection.has(a.id));}
function copySelection(cut=false,quiet=false){
 const items=selectedItems();if(!items.length)return false;S.clipboard=structuredClone(items);
 if(cut){const before=pageSnapshot();page().annotations=page().annotations.filter(a=>!S.selection.has(a.id));S.selection.clear();remember(before);redrawPage();}
 if(!quiet)toast(cut?`已剪切 ${items.length} 项`:`已复制 ${items.length} 项，Ctrl V 粘贴`);return true;
}
function pasteClipboard(){
 if(!S.clipboard?.length||!page())return false;const before=pageSnapshot(),items=structuredClone(S.clipboard).map(a=>({...a,id:uid()}));
 const bs=items.map(bounds),b={x:Math.min(...bs.map(v=>v.x)),y:Math.min(...bs.map(v=>v.y))};b.w=Math.max(...bs.map(v=>v.x+v.w))-b.x;b.h=Math.max(...bs.map(v=>v.y+v.h))-b.y;
 const area=page().infinite&&S.viewport?{x:S.viewport.x,y:S.viewport.y,w:S.viewport.w,h:S.viewport.h}:{x:0,y:0,w:page().width,h:page().height};
 let dx=24,dy=24;const moved={x:b.x+dx,y:b.y+dy,w:b.w,h:b.h};
 if(!intersects(moved,area)||moved.x<area.x||moved.y<area.y||(!page().infinite&&(moved.x+moved.w>area.w||moved.y+moved.h>area.h))){dx=area.x+40-b.x;dy=area.y+80-b.y;}
 if(page().infinite){dx=Math.max(dx,-b.x);dy=Math.max(dy,-b.y);}
 items.forEach(a=>translate(a,dx,dy));page().annotations.push(...items);S.selection=new Set(items.map(a=>a.id));
 if(S.tool!=='lasso'){S.tool='lasso';refreshTools();}remember(before);redrawPage();return true;
}
function deleteSelection(){if(!S.selection.size)return;const before=pageSnapshot();page().annotations=page().annotations.filter(a=>!S.selection.has(a.id));S.selection.clear();remember(before);redrawPage();}
function selectAll(){if(!page()?.annotations.length)return;S.tool='lasso';S.selection=new Set(page().annotations.map(a=>a.id));refreshTools();redrawPage();}
function refreshSelectionBar(){const bar=$('#selection-bar');if(!bar)return;const show=S.selection.size>0||(S.tool==='lasso'&&!!S.clipboard?.length);bar.hidden=!show;if(!show)return;const n=S.selection.size;bar.querySelector('.sel-count').textContent=n?`已选 ${n} 项`:'剪贴板';bar.querySelectorAll('[data-needs-selection]').forEach(b=>b.disabled=!n);bar.querySelector('[data-action="sel-paste"]').disabled=!S.clipboard?.length;}

// ---------- Paper: line spacing and margin line ----------
function spacingChoice(value='standard',name='spacing'){return `<div class="segmented" role="radiogroup" aria-label="线距">${[['narrow','窄'],['standard','标准'],['wide','宽']].map(([v,l])=>`<label><input type="radio" name="${name}" value="${v}" ${v===value?'checked':''}><span>${icon('check')}${l}</span></label>`).join('')}</div>`;}
function pageSetupDialog(){
 const p=page();if(!titleEditable(p)){toast('PDF 和电子书页面不能更改纸张样式',true);return;}
 let template=p.template;
 dialog('纸张样式',`<div class="field-label">内页样式</div>${templateChoices(template)}<div class="field-label">线距（横线、方格、点阵的间距）</div>${spacingChoice(p.spacing||'standard')}
 <div class="settings-section"><label class="switch setting-switch"><input type="checkbox" name="margin" role="switch" ${p.margin?'checked':''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label"><strong>左侧边距线</strong><small>像笔记本纸张那样，在左侧画一条竖向基准线，方便对齐书写。</small></span></label></div>
 <div class="field-label">应用到</div><div class="segmented" role="radiogroup" aria-label="应用范围"><label><input type="radio" name="scope" value="page" checked><span>${icon('check')}当前页</span></label><label><input type="radio" name="scope" value="all"><span>${icon('check')}全部页面</span></label></div>${actions('应用')}`,{subtitle:'页面标题、日期时间和已有内容都不会改变。',submit:async f=>{
  const before=pageSnapshot(),targets=f.get('scope')==='all'?doc().pages.filter(titleEditable):[p];
  for(const t of targets){t.template=template;t.spacing=f.get('spacing');t.margin=f.get('margin')==='on';}
  closeModal();remember(before);await showPage({resetScroll:false});renderThumbList();await renderThumbnails();toast(targets.length>1?`已应用到 ${targets.length} 页`:'纸张样式已更新');
 }});
 bindChoices('template',v=>template=v);
}

// ---------- Library full-text search ----------
const searchCache=new Map();
function searchText(d){
 const hit=searchCache.get(d.id);if(hit&&hit.at===d.updatedAt&&hit.title===d.title)return hit.text;
 const parts=[];for(const p of d.pages){if(p.title)parts.push(p.title);for(const a of p.annotations)if(a.type==='text')parts.push(a.text);else if(a.type==='rich')parts.push(a.plain||richPlainText(a.html));for(const n of p.comments||[]){parts.push(n.body);for(const im of n.images||[])parts.push(im.name);}if(p.reading)for(const b of p.reading.blocks||[])if(typeof b.text==='string')parts.push(b.text);}
 const raw=parts.join('\n');const text={raw,lower:raw.toLocaleLowerCase()};searchCache.set(d.id,{at:d.updatedAt,title:d.title,text});return text;
}
function matchDoc(d,q){if(!q)return {ok:true};if(d.title.toLocaleLowerCase().includes(q))return {ok:true};const t=searchText(d),i=t.lower.indexOf(q);if(i<0)return {ok:false};const a=Math.max(0,i-16),b=Math.min(t.raw.length,i+q.length+28);return {ok:true,snippet:{pre:(a?'…':'')+t.raw.slice(a,i).replace(/\s+/g,' '),hit:t.raw.slice(i,i+q.length),post:t.raw.slice(i+q.length,b).replace(/\s+/g,' ')+(b<t.raw.length?'…':'')}};}


// ---------- Page scrolling: continuous (pages stacked, like a PDF reader) or single page (wheel flips pages) ----------
let ghostObserver=null,stackFrame=null,wheelAcc=0,wheelAt=0,flipLock=0;
function continuousOn(){const d=doc(),p=page();return S.scrollMode==='continuous'&&!!d&&d.kind!=='discussion'&&!!p&&!p.infinite&&d.pages.length>1;}
function scrollModeTitle(){return S.scrollMode==='single'?'单页翻页：滚到页面底部再滚动就翻页（点击切换为连续滚动）':'连续滚动：页面上下相连（点击切换为单页翻页）';}
function scrollModeChoice(value){return `<div class="segmented" role="radiogroup" aria-label="翻页方式">${[['continuous','连续滚动'],['single','单页翻页']].map(([v,l])=>`<label><input type="radio" name="scrollMode" value="${v}" ${v===value?'checked':''}><span>${icon('check')}${l}</span></label>`).join('')}</div>`;}
function setScrollMode(mode,{quiet=false}={}){
 if(mode!=='single'&&mode!=='continuous'||mode===S.scrollMode)return;S.scrollMode=mode;run(()=>store.setSetting('scrollMode',mode));
 const b=$('.scroll-mode-btn');if(b){b.innerHTML=icon(mode==='single'?'single-page':'continuous');b.title=scrollModeTitle();}
 if(S.active&&page()&&!page().infinite&&doc().kind!=='discussion')run(()=>showPage());
 if(!quiet)toast(mode==='single'?'单页翻页：滚到页面底部继续滚动即可翻页':'连续滚动：页面上下相连');
}
function ghostSize(q){const w=q.infinite?PAPER.width:q.width,h=q.infinite?PAPER.height:q.height;return {w:Math.round(w*S.zoom),h:Math.round(h*S.zoom)};}
function makeGhost(i){const q=doc().pages[i],g=document.createElement('div'),s=ghostSize(q);g.className='page-ghost'+(q.infinite?' ghost-infinite':'');g.dataset.index=i;g.style.width=s.w+'px';g.style.height=s.h+'px';
 if(q.infinite)g.innerHTML=`<span class="ghost-label">${icon('draw')}无限画布 · 点击打开</span>`;return g;}
function layoutStack(){
 const ws=$('#workspace'),wrapper=$('#page-wrapper');if(!ws||!wrapper)return;ghostObserver?.disconnect();ghostObserver=null;
 ws.querySelectorAll('.page-ghost').forEach(g=>g.remove());const on=continuousOn();ws.classList.toggle('continuous',on);if(!on)return;
 const before=document.createDocumentFragment(),after=document.createDocumentFragment();
 doc().pages.forEach((q,i)=>{if(i<S.page)before.append(makeGhost(i));else if(i>S.page)after.append(makeGhost(i));});
 ws.insertBefore(before,wrapper);ws.append(after);
 ghostObserver=new IntersectionObserver(entries=>{for(const en of entries){if(en.isIntersecting)run(()=>paintGhost(en.target));else releaseGhost(en.target);}},{root:ws,rootMargin:'100% 0px'});
 ws.querySelectorAll('.page-ghost').forEach(g=>ghostObserver.observe(g));
}
function releaseGhost(g){const c=g.querySelector('canvas');if(c){c.width=0;c.height=0;c.remove();}g._bg=null;delete g.dataset.painted;}
async function paintGhost(g){
 if(g.dataset.painted||g.dataset.painting||!g.isConnected)return;const d=doc(),q=d?.pages[+g.dataset.index];if(!q)return;g.dataset.painting='1';
 const ratio=Math.min(devicePixelRatio||1,2),s=ghostSize(q),docId=S.active;
 try{
  const c=document.createElement('canvas'),ctx=c.getContext('2d');c.width=Math.round(s.w*ratio);c.height=Math.round(s.h*ratio);
  if(q.infinite){await prepareRich(q.annotations,1);const e=contentExtent(q),k=Math.min(c.width/e.width,c.height/e.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.save();ctx.scale(k,k);drawInfinitePaper(ctx,q,{x:0,y:0,width:e.width,height:e.height});q.annotations.forEach(a=>drawAnnotation(ctx,a));ctx.restore();}
  else{const bg=document.createElement('canvas');await renderBackground(bg,q,S.pdf,{cssWidth:s.w,pixelRatio:ratio});await prepareRich(q.annotations,ratio*S.zoom);if(!g.isConnected||docId!==S.active)return;c.width=bg.width;c.height=bg.height;ctx.drawImage(bg,0,0);g._bg=bg;ctx.save();ctx.scale(c.width/q.width,c.height/q.height);q.annotations.forEach(a=>drawAnnotation(ctx,a));drawCommentPins(ctx,q);ctx.restore();}
  if(!g.isConnected)return;g.querySelector('canvas')?.remove();g.prepend(c);g.dataset.painted='1';
 }finally{delete g.dataset.painting;}
}
// The page under the middle of the view becomes the live, editable page; the others are pictures of themselves.
function swapActive(j){
 const ws=$('#workspace'),wrapper=$('#page-wrapper'),g=ws?.querySelector(`.page-ghost[data-index="${j}"]`);if(!g||j===S.page||doc().pages[j]?.infinite)return false;
 finishText();if(S.selection.size){S.selection.clear();drawInk();}
 const og=makeGhost(S.page),pdfc=$('#pdf-canvas'),ink=$('#ink-canvas');
 if($('#page-loading').hidden&&pdfc.width>1&&!page().annotations.some(a=>a.type==='rich')){const c=document.createElement('canvas'),bg=document.createElement('canvas');c.width=bg.width=pdfc.width;c.height=bg.height=pdfc.height;bg.getContext('2d').drawImage(pdfc,0,0);const x=c.getContext('2d');x.drawImage(bg,0,0);x.drawImage(ink,0,0,c.width,c.height);og.append(c);og._bg=bg;og.dataset.painted='1';}
 const prefill=g._bg;ws.insertBefore(og,wrapper);ghostObserver?.unobserve(g);g.replaceWith(wrapper);ghostObserver?.observe(og);
 S.commentDraft=null;S.activeThread=null;S.page=j;showPage({resetScroll:false,keepStack:true,prefill}).catch(failure);
 document.querySelector('.page-thumb.active')?.scrollIntoView({block:'nearest'});return true;
}
function checkActivePage(){
 const ws=$('#workspace');if(!S.active||gesture||textarea||!ws?.classList.contains('continuous'))return;
 const top=ws.scrollTop,bottom=top+ws.clientHeight;let best=null,bestFrac=0,cur=0;
 for(const el of ws.children){
  if(!(el.classList.contains('page-ghost')||el.id==='page-wrapper'))continue;const a=el.offsetTop,b=a+el.offsetHeight;if(b<top||a>bottom)continue;
  const frac=Math.max(0,Math.min(b,bottom)-Math.max(a,top))/Math.max(1,Math.min(el.offsetHeight,ws.clientHeight));
  if(el.id==='page-wrapper')cur=frac;if(frac>bestFrac){bestFrac=frac;best=el;}
 }
 // Keep the live page while it is (almost) fully in view; switch only to a page that is clearly more visible.
 if(!best||best.id==='page-wrapper'||cur>=.98||bestFrac<cur+.08)return;swapActive(+best.dataset.index);
}
function ghostPointerDown(e){
 const g=e.target.closest?.('.page-ghost');if(!g||e.button!==0)return;const j=+g.dataset.index;
 if(doc().pages[j]?.infinite){e.preventDefault();run(()=>goPage(j));return;}
 if(swapActive(j))pointerDown(e);
}
function flipOnWheel(e){
 if(S.scrollMode!=='single'||!S.active||!page()||page().infinite||doc().kind==='discussion'||e.shiftKey)return;const dy=e.deltaY;if(!dy||Math.abs(e.deltaX)>Math.abs(dy))return;
 const ws=$('#workspace'),atBottom=ws.scrollTop+ws.clientHeight>=ws.scrollHeight-2,atTop=ws.scrollTop<=1;
 if(dy>0?!atBottom:!atTop){wheelAcc=0;return;}
 e.preventDefault();const now=performance.now();if(now<flipLock)return;if(now-wheelAt>450)wheelAcc=0;wheelAt=now;wheelAcc+=e.deltaMode===1?dy*40:dy;
 if(Math.abs(wheelAcc)<90)return;wheelAcc=0;flipLock=now+380;
 const next=S.page+(dy>0?1:-1);if(next<0||next>=doc().pages.length){toast(dy>0?'已经是最后一页':'已经是第一页');return;}
 run(async()=>{await goPage(next,{at:dy>0?'top':'bottom'});$('#page-wrapper')?.animate([{transform:`translateY(${dy>0?28:-28}px)`,opacity:.55},{transform:'none',opacity:1}],{duration:220,easing:'cubic-bezier(.2,0,0,1)'});});
}

// ---------- One pen toolbar for both sides of the split view ----------
let remoteTools=false;
function toolState(){return {tool:S.tool,color:S.color,marker:S.marker,width:S.width,markerWidth:S.markerWidth,textSize:S.textSize,eraserSize:S.eraserSize,eraserMode:S.eraserMode};}
function syncTools(){if(remoteTools)return;const st=toolState();try{if(EMBED)host()?.toolsChanged?.(st);else S.split?.frame.contentWindow?.__inknoteEmbed?.applyTools?.(st);}catch{}}
function applyTools(st){
 if(!st||typeof st!=='object')return;const hex=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v),num=(v,a,b)=>typeof v==='number'&&v>=a&&v<=b,next={};
 if(TOOLS.some(([v])=>v===st.tool))next.tool=st.tool;if(hex(st.color))next.color=st.color;if(hex(st.marker))next.marker=st.marker;
 if(num(st.width,.5,8))next.width=st.width;if(num(st.markerWidth,6,35))next.markerWidth=st.markerWidth;if(num(st.textSize,10,48))next.textSize=st.textSize;if(num(st.eraserSize,6,60))next.eraserSize=st.eraserSize;if(st.eraserMode==='stroke'||st.eraserMode==='partial')next.eraserMode=st.eraserMode;
 const toolChanged=next.tool&&next.tool!==S.tool;remoteTools=true;
 try{Object.assign(S,next);if(S.active&&$('#color-dots')){if(toolChanged){finishText();S.selection.clear();}refreshTools();drawInk();}}finally{remoteTools=false;}
}
// While the split view is open the parent's toolbar floats over the whole window and drives both panes.
// Docked left, the shared toolbar sits just inside the left page area rather than over the thumbnails.
function alignGlobalBar(){const bar=app.querySelector(':scope>.toolbar.global'),stage=view.querySelector('.stage');if(bar&&stage)bar.style.setProperty('--stage-left',Math.round(stage.getBoundingClientRect().left)+'px');}
window.addEventListener('resize',()=>{if(S.split)alignGlobalBar();});
function placeToolbar(){
 if(EMBED)return;const stage=view.querySelector('.stage');let bar=stage?.querySelector('.toolbar')||null;
 for(const x of app.querySelectorAll(':scope>.toolbar')){if(!bar&&stage)bar=x;else x.remove();}
 if(bar&&S.split){bar.classList.add('global');if(bar.parentElement!==app)app.append(bar);alignGlobalBar();}
 else if(bar){bar.classList.remove('global');if(bar.parentElement!==stage)stage.append(bar);}
 try{S.split?.frame.contentWindow?.__inknoteEmbed?.globalTools?.(!!(bar&&S.split));}catch{}
}

// ---------- Movable toolbar: dock it at the bottom, top, left or right of the page area ----------
const DOCKS=['bottom','top','left','right'],DOCK_NAMES={bottom:'底部',top:'顶部',left:'左侧',right:'右侧'};
function nearestDock(x,y,r){const d={bottom:(r.bottom-y)/r.height,top:(y-r.top)/r.height,left:(x-r.left)/r.width,right:(r.right-x)/r.width};return Object.entries(d).sort((a,b)=>a[1]-b[1])[0][0];}
function markDock(){const bar=$('.toolbar');if(bar){bar.dataset.dock=S.toolbarDock;bar.classList.toggle('vertical',S.toolbarDock==='left'||S.toolbarDock==='right');}}
function setToolbarDock(dock,{save=true}={}){
 if(!DOCKS.includes(dock))return;const changed=dock!==S.toolbarDock;S.toolbarDock=dock;const stage=$('.stage');markDock();
 if(stage&&stage.dataset.dock!==dock){stage.dataset.dock=dock;$('.toolbar')?.animate([{opacity:.3,scale:.92},{opacity:1,scale:1}],{duration:320,easing:'cubic-bezier(.34,1.36,.64,1)'});if(page()?.infinite)requestAnimationFrame(()=>paintInfinite(false));}
 if(save&&changed)run(()=>store.setSetting('toolbarDock',dock));
}
function bindToolbarDock(){
 const bar=$('.toolbar'),handle=bar?.querySelector('.tb-handle'),stage=$('.stage');if(!handle||!stage)return;markDock();
 handle.onpointerdown=e=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);
  const global=bar.classList.contains('global'),area=global?app:stage,sr=area.getBoundingClientRect(),br=bar.getBoundingClientRect(),off={x:e.clientX-br.left,y:e.clientY-br.top},start={x:e.clientX,y:e.clientY};let moved=false;
  handle.onpointermove=m=>{if(!moved&&Math.hypot(m.clientX-start.x,m.clientY-start.y)<6)return;moved=true;bar.classList.add('dragging');
   Object.assign(bar.style,{left:clamp(m.clientX-sr.left-off.x,4,sr.width-br.width-4)+(global?sr.left:0)+'px',top:clamp(m.clientY-sr.top-off.y,4,sr.height-br.height-4)+(global?sr.top:0)+'px',bottom:'auto',right:'auto',transform:'none'});
   area.dataset.dockPreview=nearestDock(m.clientX,m.clientY,sr);};
  handle.onpointerup=handle.onpointercancel=u=>{handle.onpointermove=handle.onpointerup=handle.onpointercancel=null;bar.classList.remove('dragging');for(const k of ['left','top','bottom','right','transform'])bar.style.removeProperty(k);delete area.dataset.dockPreview;
   if(moved&&u.type==='pointerup'){const dock=nearestDock(u.clientX,u.clientY,sr);setToolbarDock(dock);toast('工具栏已移到'+DOCK_NAMES[dock]);}};
 };
 handle.ondblclick=()=>setToolbarDock('bottom');
 handle.onkeydown=e=>{const dock={ArrowDown:'bottom',ArrowUp:'top',ArrowLeft:'left',ArrowRight:'right'}[e.key];if(dock){e.preventDefault();e.stopPropagation();setToolbarDock(dock);handle.focus();}};
}
function dockChoice(value){return `<div class="segmented" role="radiogroup" aria-label="工具栏位置">${DOCKS.map(v=>`<label><input type="radio" name="dock" value="${v}" ${v===value?'checked':''}><span>${icon('check')}${DOCK_NAMES[v]}</span></label>`).join('')}</div>`;}
// ---------- Import / export folder ----------
// One click writes every note as its own .inknote file into a folder the user picked (put it inside any cloud-drive
// sync folder, or copy it anywhere); one click reads that folder back. Files carry the note id, so importing again
// updates the note instead of making a copy. Per note we remember its updatedAt at the last export/import: a file that
// is newer while the local note is unchanged replaces it; if both changed, the file comes in as a "（导入版本）" copy.
const EXCHANGE={state:null,status:null,busy:false};
const exchangeDesktop=()=>!!window.desktop?.exchange&&!EMBED;
async function xcall(channel,payload){const r=await window.desktop.exchange(channel,payload);if(r?.error)throw new Error(r.error);return r?.value;}
function ago(t){const s=Math.max(0,(Date.now()-t)/1000);return s<60?'刚刚':s<3600?Math.floor(s/60)+' 分钟前':s<86400?Math.floor(s/3600)+' 小时前':new Date(t).toLocaleDateString('zh-CN',{month:'short',day:'numeric'});}
async function exchangeState(){if(!EXCHANGE.state){const s=await store.setting('exchangeState');EXCHANGE.state=s&&typeof s==='object'?{map:s.map||{},lastExport:s.lastExport||0,lastImport:s.lastImport||0}:{map:{},lastExport:0,lastImport:0};}return EXCHANGE.state;}
async function saveExchangeState(){await store.setSetting('exchangeState',EXCHANGE.state);}
const shortId=id=>String(id).replace(/[^\w-]/g,'').slice(0,8);
const exportName=d=>filename(d.title).slice(0,80)+'-'+shortId(d.id)+'.inknote';
const ofNote=(name,id)=>name.toLowerCase().endsWith('-'+shortId(id).toLowerCase()+'.inknote');
async function refreshExchangeBadge(){
 const el=$('#exchange-status');if(!el)return;const st=await exchangeState().catch(()=>null);
 if(exchangeDesktop()&&!EXCHANGE.status)EXCHANGE.status=await xcall('exchange:status').catch(()=>null);
 const f=EXCHANGE.status?.folder,last=Math.max(st?.lastExport||0,st?.lastImport||0);
 el.querySelector('.exchange-text').textContent=exchangeDesktop()&&!f?'导入导出文件夹 · 未设置':last?(st.lastExport>=st.lastImport?'上次导出 · ':'上次导入 · ')+ago(last):'一键导入导出';
 el.title=f?'导入导出文件夹：'+f:'一键导出全部笔记，或从文件导入';
}
function markExchangeDeleted(id){run(async()=>{const st=await exchangeState();if(st.map[id]){st.map[id]={deleted:true};await saveExchangeState();}});}
async function writeExchangeFile(name,blob,replaces){
 const {token}=await xcall('exchange:write-begin',{name,size:blob.size});let ok=false;
 try{const step=16*1024*1024;for(let o=0;o<blob.size;o+=step)await xcall('exchange:write-chunk',{token,bytes:new Uint8Array(await blob.slice(o,o+step).arrayBuffer())});ok=true;}
 finally{await xcall('exchange:write-end',{token,ok,replaces}).catch(e=>{if(ok)throw e;});}
}
async function readExchangeFile(f){
 const step=16*1024*1024,parts=[];
 for(let o=0;o<f.size;o+=step)parts.push(await xcall('exchange:read',{name:f.name,start:o,end:Math.min(f.size,o+step)-1}));
 return new Blob(parts);
}
async function exportAll(){
 if(EXCHANGE.busy){toast('正在处理，请稍候');return;}
 const st=await exchangeState();finishText();await flush();
 const notes=S.docs.filter(d=>!(d.sample&&d.sample===d.updatedAt)); // untouched sample notes exist on every computer already
 if(!exchangeDesktop()){ // browser: one ZIP holding every note's .inknote
  EXCHANGE.busy=true;try{toast(`正在打包 ${notes.length} 本笔记…`);const entries=[];for(const d of notes)entries.push({name:exportName(d),data:new Uint8Array(await (await backupBlob(d)).arrayBuffer())});
   for(const d of notes)st.map[d.id]={local:d.updatedAt};st.lastExport=Date.now();
   if(await download(await writeZip(entries),'墨页全部笔记-'+new Date().toISOString().slice(0,10)+'.zip','application/zip')){await saveExchangeState();toast(`已导出 ${entries.length} 本笔记`);}
  }finally{EXCHANGE.busy=false;refreshExchangeBadge();}return;
 }
 let status=EXCHANGE.status=await xcall('exchange:status');
 if(!status.folder||!status.exists){status=EXCHANGE.status=await xcall('exchange:choose');if(!status.folder)return;}
 EXCHANGE.busy=true;let written=0,skipped=0,removed=0;
 try{
  const files=await xcall('exchange:list'),names=new Set(files.map(f=>f.name));toast(`正在导出 ${notes.length} 本笔记…`);
  for(const d of notes){
   const name=exportName(d),e=st.map[d.id],stale=files.filter(f=>f.name!==name&&ofNote(f.name,d.id)).map(f=>f.name);
   if(e&&!e.deleted&&e.local===d.updatedAt&&names.has(name)&&!stale.length){skipped++;continue;}
   await writeExchangeFile(name,await backupBlob(d),stale);st.map[d.id]={local:d.updatedAt};written++;
  }
  for(const [id,e] of Object.entries(st.map)){if(!e.deleted||e.removed||S.docs.some(d=>d.id===id))continue;const del=files.filter(f=>ofNote(f.name,id)).map(f=>f.name);if(del.length)removed+=(await xcall('exchange:remove',{names:del})).removed;e.removed=true;}
  st.lastExport=Date.now();await saveExchangeState();
  toast(`已导出到文件夹：写入 ${written} 本`+(skipped?`，${skipped} 本没有改动`:'')+(removed?`，移除 ${removed} 个已删除笔记的文件`:''));
 }finally{EXCHANGE.busy=false;refreshExchangeBadge();}
}
// sources: [{name, blob:()=>Promise<Blob>}]; explicit = the user picked these files themselves.
async function mergeImport(sources,{explicit=false}={}){
 if(EXCHANGE.busy||importing){toast('正在处理，请稍候');return;}
 const st=await exchangeState();finishText();await flush();EXCHANGE.busy=true;
 const open=new Set([S.active,S.split?.id].filter(Boolean)),c={added:0,updated:0,same:0,older:0,copies:0,deleted:0,busy:0,failed:0};
 const expand=async s=>{const blob=await s.blob();if(!await isZip(blob))return [{name:s.name,blob}];const z=await readZip(blob);if(z.has('inknote.json'))return [{name:s.name,blob}];
  const out=[];for(const [n,entry] of z)if(/\.inknote$/i.test(n)&&!n.split('/').pop().startsWith('.'))out.push({name:n.split('/').pop(),entry});return out;};
 try{
  if(sources.length)toast(`正在导入 ${sources.length} 个文件…`);
  for(const s of sources){
   let items;try{items=await expand(s);}catch(e){c.failed++;failure(new Error(`${s.name}：${e.message}`));continue;}
   for(const it of items){
    try{
     const file=it.blob||new Blob([await readEntry(it.entry)]);if(file.size>1024*1024*1024)throw new Error('文件超过 1 GB。');
     const {data,source}=await readBackup(file);const raw=data?.document;if(data?.format!=='inknote'||!raw)throw new Error('不是有效的 InkNote 备份文件。');
     const id=typeof raw.id==='string'&&/^[\w-]{8,64}$/.test(raw.id)?raw.id:null;
     if(!id){await importBackup(null,{data,source});c.added++;continue;}
     const e=st.map[id],local=S.docs.find(d=>d.id===id),fUpd=Number.isFinite(raw.updatedAt)?raw.updatedAt:0;
     if(e?.deleted&&!local&&!explicit){c.deleted++;continue;}
     if(!local){const nid=await importBackup(null,{data,source,keepId:true});st.map[nid]={local:S.docs.find(d=>d.id===nid).updatedAt};c.added++;continue;}
     if(fUpd===local.updatedAt){st.map[id]={local:fUpd};c.same++;continue;}
     if(fUpd<local.updatedAt){c.older++;continue;}
     if(!e||e.deleted||e.local!==local.updatedAt){raw.title=String(raw.title||'').slice(0,140)+'（导入版本）';await importBackup(null,{data,source});c.copies++;continue;}
     if(open.has(id)){c.busy++;continue;}
     await importBackup(null,{data,source,keepId:true});st.map[id]={local:S.docs.find(d=>d.id===id).updatedAt};c.updated++;
    }catch(err){c.failed++;failure(new Error(`${it.name}：${err.message}`));}
   }
  }
  st.lastImport=Date.now();await saveExchangeState();
  if(!S.active)renderLibrary();else refreshTitle();
  const parts=[c.added&&`新增 ${c.added} 本`,c.updated&&`更新 ${c.updated} 本`,c.copies&&`${c.copies} 本两边都改过，另存为「…（导入版本）」`,(c.same+c.older)&&`${c.same+c.older} 本本机已是最新`,c.deleted&&`跳过 ${c.deleted} 本你在本机删除过的笔记`,c.busy&&`${c.busy} 本正在打开，关闭后再导入一次`,c.failed&&`${c.failed} 个文件失败`].filter(Boolean);
  toast(parts.length?'导入完成：'+parts.join('，'):'文件夹里没有墨页笔记（.inknote）');
 }finally{EXCHANGE.busy=false;refreshExchangeBadge();}
}
async function importFromFolder(){
 if(!exchangeDesktop()){$('#merge-input').click();return;}
 let status=EXCHANGE.status=await xcall('exchange:status');
 if(!status.folder||!status.exists){status=EXCHANGE.status=await xcall('exchange:choose');if(!status.folder)return;}
 const files=await xcall('exchange:list');
 await mergeImport(files.map(f=>({name:f.name,blob:()=>readExchangeFile(f)})));
}
async function exchangeDialog(){
 const st=await exchangeState();if(exchangeDesktop())EXCHANGE.status=await xcall('exchange:status').catch(()=>null);
 const f=EXCHANGE.status?.folder,missing=f&&!EXCHANGE.status.exists;
 const when=t=>t?new Date(t).toLocaleString('zh-CN',{hour12:false}):'还没有';
 const folderRow=exchangeDesktop()?`<div class="exchange-folder">${icon('folder')}<div><strong>${f?E(f):'还没有选择文件夹'}</strong><small>${missing?'<span class="exchange-error">找不到这个文件夹，请重新选择</span>':f?'上次导出：'+E(when(st.lastExport))+' · 上次导入：'+E(when(st.lastImport)):'第一次导出或导入时会请你选择'}</small></div></div>`:'';
 dialog('导入导出',`${folderRow}
  <div class="menu-choices"><button type="button" id="x-export">${icon('download')}<span>一键导出全部笔记<small>${exchangeDesktop()?'每本笔记一个 .inknote 文件，放进上面的文件夹；没改动的会跳过':'打包成一个 .zip 文件下载'}</small></span></button>
  ${exchangeDesktop()?`<button type="button" id="x-import">${icon('upload')}<span>从文件夹一键导入<small>读取文件夹里的全部 .inknote：新的加入，更新过的替换，本机已是最新的跳过</small></span></button>`:''}
  <button type="button" id="x-pick">${icon('file')}<span>选择文件导入…<small>选一个或多个 .inknote 文件，或导出的 .zip 压缩包</small></span></button>
  ${exchangeDesktop()?`<button type="button" id="x-choose">${icon('folder')}<span>${f?'更换文件夹':'选择文件夹'}<small>可以选网盘的同步文件夹（OneDrive、百度网盘、Google 云端硬盘等）或 U 盘</small></span></button>${f&&!missing?`<button type="button" id="x-open">${icon('chevron')}<span>在资源管理器中打开这个文件夹</span></button>`:''}`:''}</div>
  <p class="help-note">换电脑时：在这台电脑点「一键导出」，把文件夹（或里面的文件）通过网盘、U 盘带到另一台电脑，再在那边「导入」。同一本笔记再次导入会更新它，不会重复；两边都改过的，另存一份「…（导入版本）」，不会丢内容。</p>`);
 $('#x-export').onclick=()=>run(async()=>{closeModal();await exportAll();});
 if($('#x-import'))$('#x-import').onclick=()=>run(async()=>{closeModal();await importFromFolder();});
 $('#x-pick').onclick=()=>{closeModal();$('#merge-input').click();};
 if($('#x-choose'))$('#x-choose').onclick=()=>run(async()=>{EXCHANGE.status=await xcall('exchange:choose');closeModal();refreshExchangeBadge();if(EXCHANGE.status.folder)toast('导入导出文件夹已设为 '+EXCHANGE.status.folder);});
 if($('#x-open'))$('#x-open').onclick=()=>run(()=>xcall('exchange:open'));
}
const handlers={
 'view':b=>{S.view=b.dataset.value;S.query='';renderLibrary();},
 'layout':b=>{S.list=b.dataset.value==='list';renderLibrary();},
 'open':b=>openDoc(b.dataset.id), 'tab':b=>openDoc(b.dataset.id),
 'close-tab':async b=>{const id=b.dataset.id,idx=S.tabs.indexOf(id);S.tabs=S.tabs.filter(x=>x!==id);if(id===S.active){const next=S.tabs[Math.min(idx,S.tabs.length-1)];if(next)await openDoc(next);else await goHome();}else refreshTitle();},
 'discussion-home':async()=>{S.view='discussion';await goHome();},'home':goHome,'new-discussion':newDiscussion,'new-discussion-thread':newDiscussionThread,'discussion-backup':()=>exportBackup(doc()), 'new':b=>newNotebook(b.dataset.value), 'new-chooser':newChooser,'theme':themeDialog, 'import':()=>$('#file-input').click(),
 'new-folder':async()=>{const f=await ask('新建文件夹','文件夹名称','',{ok:'创建'});if(!f)return;if(S.folders.includes(f)){toast('这个文件夹已经存在');return;}S.folders.push(f);await store.setSetting('folders',S.folders);renderLibrary();},
 'guide':async()=>{let d=S.docs.find(x=>x.guide);if(!d){d=makeGuide();await store.save(d);S.docs.push(d);}await openDoc(d.id);},
 'doc-menu':b=>showDocMenu(b.dataset.id),'rename':()=>renameDoc(),'settings':settings,'help':showHelp,
 'tool':b=>{finishText();if(b.dataset.value==='comment'&&S.selection.size){const box=selectionBounds();startThreadAt({x:box.x+box.w+16,y:Math.max(12,box.y)},[...S.selection]);}S.tool=b.dataset.value;S.selection.clear();refreshTools();drawInk();},
 'color':b=>{if(S.tool==='marker')S.marker=b.dataset.value;else S.color=b.dataset.value;refreshTools();},
 'toggle-sidebar':b=>{setTimeout(alignGlobalBar,320);S.sidebar=!S.sidebar;$('.page-sidebar').classList.toggle('collapsed',!S.sidebar);$('.page-controls').classList.toggle('no-sidebar',!S.sidebar);b.classList.toggle('on',S.sidebar);b.setAttribute('aria-pressed',S.sidebar);if(page()?.infinite)requestAnimationFrame(()=>paintInfinite(false));},
 'undo':()=>undo(),'redo':()=>undo(true),'page':b=>goPage(+b.dataset.index),
 'prev':()=>goPage(S.page-1),'next':()=>goPage(S.page+1),'zoom-in':()=>changeZoom(.1),'zoom-out':()=>changeZoom(-.1),'fit':fit,
 'jump':async()=>{const n=await ask('跳到页面',`页码（1–${doc().pages.length}）`,String(S.page+1),{type:'number',ok:'前往'});if(n&&Number.isInteger(+n)&&+n>=1&&+n<=doc().pages.length)await goPage(+n-1);else if(n)toast('请输入有效页码',true);},
 'split':splitChooser,'exchange':()=>exchangeDialog(),'scroll-mode':()=>setScrollMode(S.scrollMode==='single'?'continuous':'single'),'split-swap':()=>host()?.swapSplit(),'eraser-mode':b=>{S.eraserMode=b.dataset.value;run(()=>store.setSetting('eraserMode',S.eraserMode));refreshTools();},'sel-copy':()=>copySelection(),'sel-cut':()=>copySelection(true),'sel-dup':()=>{if(copySelection(false,true))pasteClipboard();},'sel-paste':()=>pasteClipboard(),'sel-delete':deleteSelection,
 'date':insertDate,'comments':toggleComments,'comment-image-add':()=>$('#comment-image-input').click(),'comment-image-open':b=>openCommentImage(b.dataset.commentId,+b.dataset.index),'comment-draft-image-open':b=>openDraftImage(+b.dataset.index),'comment-draft-image-remove':b=>{S.commentDraft?.images.splice(+b.dataset.index,1);renderComments();},'comment-submit':submitComment,'comment-reply':b=>beginReply(b.dataset.id),'comment-collapse':b=>collapseThread(b.dataset.id),'comment-focus':b=>focusDiscussionComment(b.dataset.id),'comment-locate':b=>locateComment(b.dataset.id),'comment-edit':b=>editCommentDialog(b.dataset.id),'comment-delete':b=>deleteCommentDialog(b.dataset.id),'comment-cancel':()=>{S.commentDraft=null;renderComments();},'add-page':addPage,'editor-menu':editorMenu,'export':exportDialog,'find':toggleFind,'find-next':()=>findNext(1),'find-prev':()=>findNext(-1)
};
app.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled){e.stopPropagation();run(()=>handlers[b.dataset.action]?.(b));}});
app.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button][data-action]:not(button)')){e.preventDefault();const b=e.target;run(()=>handlers[b.dataset.action]?.(b));}});
$('#file-input').onchange=e=>run(()=>importFiles([...e.target.files]));
$('#merge-input').onchange=e=>{const files=[...e.target.files];e.target.value='';run(()=>mergeImport(files.map(f=>({name:f.name,blob:async()=>f})),{explicit:true}));};
$('#comment-image-input').onchange=e=>run(()=>addCommentImages([...e.target.files]));
let dragDepth=0;
function dropIntoPage(){return S.active&&page()&&doc().kind!=='discussion';}
function dropOverlay(show){const o=$('#drop-overlay');o.hidden=!show;if(!show)return;const into=dropIntoPage();o.querySelector('h2').textContent=into?'松开即可放进这一页':'松开即可导入';o.querySelector('p').textContent=into?'Markdown、文本和网页内容会变成带格式的文本框（公式自动排版）；PDF、电子书和 .inknote 备份导入为新笔记':'PDF · EPUB · TXT · FB2 · HTML · CBZ · Markdown · .inknote 备份';}
window.addEventListener('dragenter',e=>{const t=e.dataTransfer?.types||[];if(t.includes('Files')&&(!EMBED||dropIntoPage())){e.preventDefault();dragDepth++;dropOverlay(true);}});
window.addEventListener('dragover',e=>{const t=e.dataTransfer?.types||[];if(t.includes('Files')||dropIntoPage()&&(t.includes('text/plain')||t.includes('text/html')))e.preventDefault();});
window.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;dropOverlay(false);}});
window.addEventListener('drop',e=>{
 e.preventDefault();dragDepth=0;dropOverlay(false);const dt=e.dataTransfer;if(!dt)return;
 const drop=captureDrop(dt),pageFiles=drop.files.filter(f=>/\.(md|markdown|txt)$/i.test(f.name)),others=drop.files.filter(f=>!pageFiles.includes(f));
 if(dropIntoPage()){
  const ws=$('#workspace'),r=ws?.getBoundingClientRect(),inside=r&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  const at=inside?point(e):null;
  if(pageFiles.length||!drop.files.length&&(drop.html||drop.text))run(async()=>{const html=await richFromDrop({...drop,files:pageFiles});if(html){addRichBox(html,at&&{x:Math.max(0,at.x),y:Math.max(0,at.y)});toast(pageFiles.length?'已插入 '+pageFiles.map(f=>f.name).join('、'):'已插入，格式已保留');}});
  if(others.length){if(EMBED){toast('PDF、电子书请拖到左侧窗口导入',true);return;}run(()=>importFiles(others));}
  return;
 }
 if(!EMBED&&drop.files.length)run(()=>importFiles(drop.files));
});
window.addEventListener('keydown',e=>{
 if(modal.open)return;const input=e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]),textarea,select,[contenteditable=true]');const ctrl=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
 if(ctrl&&key==='s'){e.preventDefault();finishText();run(async()=>{await flush();toast('已保存在本机');});return;}
 if(ctrl&&key==='k'&&!S.active){e.preventDefault();$('#library-search')?.focus();return;}
 if(ctrl&&(e.key==='\\'||e.code==='Backslash')&&S.active&&!EMBED){e.preventDefault();splitChooser();return;}
 if(input)return;
 if(S.active){
  if(doc().kind==='discussion'){if(ctrl&&key==='z'){e.preventDefault();run(()=>undo(e.shiftKey));}else if(ctrl&&key==='y'){e.preventDefault();run(()=>undo(true));}else if(ctrl&&key==='f'){e.preventDefault();$('#discussion-search')?.focus();}else if(ctrl&&e.shiftKey&&key==='e'){e.preventDefault();run(()=>exportBackup(doc()));}return;}
  if(ctrl&&key==='z'){e.preventDefault();run(()=>undo(e.shiftKey));return;}if(ctrl&&key==='y'){e.preventDefault();run(()=>undo(true));return;}
  if(ctrl&&key==='f'){e.preventDefault();toggleFind();return;}if(ctrl&&e.shiftKey&&key==='e'){e.preventDefault();run(doExport);return;}
  if(ctrl&&!e.shiftKey){if(key==='c'||key==='x'||key==='v')return;if(key==='d'){e.preventDefault();if(copySelection(false,true))pasteClipboard();return;}if(key==='a'){e.preventDefault();selectAll();return;}}
  if(!ctrl&&!e.altKey){const tool={p:'pen',h:'marker',e:'eraser',t:'text',r:'rect',l:'lasso',v:'hand',c:'comment'}[key];if(tool){if(tool==='eraser'&&S.tool==='eraser'){S.eraserMode=S.eraserMode==='partial'?'stroke':'partial';run(()=>store.setSetting('eraserMode',S.eraserMode));toast(S.eraserMode==='partial'?'局部擦除：只擦掉经过的部分':'整笔擦除：碰到就删除整条笔迹');}S.tool=tool;S.selection.clear();refreshTools();drawInk();return;}}
  if((key==='delete'||key==='backspace')&&S.selection.size){e.preventDefault();deleteSelection();}
  if(key==='escape'){S.selection.clear();drawInk();}if(key==='pagedown'){e.preventDefault();run(()=>goPage(S.page+1));}if(key==='pageup'){e.preventDefault();run(()=>goPage(S.page-1));}
 }
});
const CLIP_TYPE='application/x-inknote-items';
function canvasFocus(e){return S.active&&page()&&doc().kind!=='discussion'&&!modal.open&&!e.target.closest?.('input,textarea,select,[contenteditable=true],.comments-panel,.pdf-find');}
document.addEventListener('copy',e=>{if(!canvasFocus(e)||!S.selection.size)return;const items=selectedItems();e.preventDefault();S.clipboard=structuredClone(items);
 e.clipboardData.setData(CLIP_TYPE,JSON.stringify(items));
 const text=items.map(a=>a.type==='text'?a.text:a.type==='rich'?(a.plain||richPlainText(a.html)):'').filter(Boolean).join('\n\n');if(text)e.clipboardData.setData('text/plain',text);
 const html=items.map(a=>a.type==='rich'?a.html:a.type==='text'?plainToHtml(a.text):'').join('');if(html)e.clipboardData.setData('text/html',html);
 toast(`已复制 ${items.length} 项，Ctrl V 粘贴`);});
document.addEventListener('cut',e=>{if(!canvasFocus(e)||!S.selection.size)return;e.preventDefault();copySelection(true,true);e.clipboardData.setData(CLIP_TYPE,JSON.stringify(S.clipboard));toast('已剪切');});
document.addEventListener('paste',e=>{
 if(!canvasFocus(e))return;const dt=e.clipboardData;let items=null;
 try{const raw=dt.getData(CLIP_TYPE);if(raw)items=JSON.parse(raw);}catch{}
 if(Array.isArray(items)&&items.length){e.preventDefault();S.clipboard=items.filter(a=>['pen','marker','text','rect','rich'].includes(a?.type));if(S.clipboard.some(a=>a.type==='rich'))S.clipboard=S.clipboard.map(a=>a.type==='rich'?{...a,html:sanitizeHtml(a.html)}:a);pasteClipboard();return;}
 const html=dt.getData('text/html'),text=dt.getData('text/plain');
 if(html&&html.trim()||text&&text.trim()){e.preventDefault();addRichBox(html&&html.trim()?sanitizeHtml(html):textToHtml(text),lastCanvasPoint());toast('已粘贴为文本框，格式已保留');return;}
 if(S.clipboard?.length){e.preventDefault();pasteClipboard();}
});
let lastPointer=null;window.addEventListener('pointermove',e=>{lastPointer={clientX:e.clientX,clientY:e.clientY};},{passive:true});
function lastCanvasPoint(){const ws=$('#workspace');if(!lastPointer||!ws||!page())return null;const r=ws.getBoundingClientRect();if(lastPointer.clientX<r.left||lastPointer.clientX>r.right||lastPointer.clientY<r.top||lastPointer.clientY>r.bottom)return null;const q=point(lastPointer);if(!page().infinite&&(q.x<0||q.y<0||q.x>page().width-40||q.y>page().height-20))return null;return q;}
window.addEventListener('beforeunload',e=>{finishText();if(!closing&&(pending.size||saving)){void flush();e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')run(flush);});
function makeGuide(){return{id:uid(),title:'把想法，写下来',kind:'notebook',color:'olive',guide:true,folder:'个人',createdAt:Date.now(),updatedAt:Date.now(),favorite:true,lastPage:0,pages:[0,1,2].map(i=>({...newPage('guide'),guide:i}))};}
async function loadToolSettings(){const sm=await store.setting('scrollMode');if(sm==='single'||sm==='continuous')S.scrollMode=sm;const dock=await store.setting('toolbarDock');if(DOCKS.includes(dock))S.toolbarDock=dock;const mode=await store.setting('eraserMode');if(mode==='partial'||mode==='stroke')S.eraserMode=mode;const r=+await store.setting('splitRatio');if(r>=.25&&r<=.75)S.splitRatio=r;}
// The right-hand split pane is this same page in an iframe, opened with ?pane=split&doc=ID.
async function initEmbedded(){
 document.body.classList.add('embedded');try{if(window.parent.desktop)document.body.classList.add('caption-space');}catch{}
 try{S.docs=await store.all();S.folders=await store.setting('folders')||S.folders;S.penOnly=await store.setting('penOnly')||false;await loadToolSettings();useTheme(await store.setting('theme')||DEFAULT_THEME,false);
  window.__inknoteEmbed={docId:EMBED_DOC,flush:async()=>{finishText();await flush();},theme:t=>useTheme(t,false),applyTools:st=>applyTools(st),globalTools:on=>document.body.classList.toggle('global-tools',!!on)};
  if(!S.docs.some(d=>d.id===EMBED_DOC))throw new Error('这本笔记已不存在。');
  try{const h=host(),st=h?.toolState?.();if(st)applyTools(st);document.body.classList.toggle('global-tools',!!h?.hasToolbar?.());}catch{}
  await openDoc(EMBED_DOC);await fitIfOverflow();
 }catch(e){view.innerHTML=`<div class="boot boot-error"><img class="brand-logo boot-logo" src="icon.svg" alt="" aria-hidden="true"><h3>无法在分屏中打开</h3><p>${E(e.message)}</p><button class="btn tonal" data-action="home">${icon('close')}关闭分屏</button></div>`;}
}
async function init(){
 S.theme=applyTheme(DEFAULT_THEME,themeChanged).theme;themeChanged();
 try{new ResizeObserver(()=>document.body.classList.toggle('narrow-editor',view.clientWidth-(document.body.classList.contains('caption-space')?150:0)<=700)).observe(view);}catch{}
 if(EMBED)return initEmbedded();
 window.__inknoteHost={toolsChanged:st=>applyTools(st),toolState:()=>toolState(),hasToolbar:()=>!!document.querySelector('.toolbar.global'),download:(bytes,name,mime)=>download(bytes,name,mime),closeSplit:()=>run(closeSplit),swapSplit:()=>run(swapSplit),docSaved:id=>run(()=>reloadDoc(id)),toast:(m,e)=>toast(m,e)};
 view.innerHTML='<div class="boot"><img class="brand-logo boot-logo" src="icon.svg" alt="" aria-hidden="true"><p>正在打开墨页…</p></div>';
 try{S.docs=await store.all();S.folders=await store.setting('folders')||S.folders;S.penOnly=await store.setting('penOnly')||false;await loadToolSettings();useTheme(await store.setting('theme')||DEFAULT_THEME,false);
  if(!await store.setting('initialized')){const guide=makeGuide(),learning={id:uid(),title:'每周学习计划',kind:'notebook',color:'sand',folder:'学习',createdAt:Date.now(),updatedAt:Date.now()-300000,lastPage:0,pages:[makeCanvasPage('ruled',false,'plain',{title:'每周学习计划'}),makeCanvasPage('ruled',false,'plain')]},ideas={id:uid(),title:'灵感与随记',kind:'notebook',color:'blue',folder:'个人',createdAt:Date.now(),updatedAt:Date.now()-3600000,lastPage:0,pages:[makeCanvasPage('dot',false,'plain',{title:'灵感与随记'})]};
    learning.pages[0].annotations=[{id:uid(),type:'text',x:52,y:106,size:14,w:400,h:140,color:'#5f5a68',text:'这一周，给自己一点专注的时间。\n\n周一 / 阅读并整理一份课件\n\n周三 / 写下三个值得追问的问题\n\n周五 / 回顾本周的收获与想法'}];
    ideas.pages[0].annotations=[{id:uid(),type:'text',x:44,y:104,size:24,w:400,h:36,color:'#4f6b76',text:'好想法，值得被记住。'},{id:uid(),type:'text',x:46,y:150,size:13,w:400,h:40,color:'#7c8d92',text:'给突然出现的灵感，留一个位置。'}];
    for(const d of [guide,learning,ideas]){d.sample=d.updatedAt;await store.save(d);S.docs.push(d);}await store.setSetting('initialized',true);
  }
  renderLibrary();
  if(window.desktop){document.body.classList.add('desktop');$('#windowbar').hidden=false;document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>window.desktop.windowAction(b.dataset.window));window.desktop.onBeforeClose(async()=>{try{finishText();await flush();if(S.split)await closeSplit({reload:false});closing=true;window.desktop.closeReady(true);}catch(e){failure(e);window.desktop.closeReady(false);}});}
 }catch(e){window.desktop?.reportStartupError(e?.message||String(e));view.innerHTML=`<div class="boot boot-error"><img class="brand-logo boot-logo" src="icon.svg" alt="" aria-hidden="true"><h3>暂时无法打开本机笔记</h3><p>${E(e.message)}</p><p>请关闭后重新打开墨页。如仍无法启动，请保留错误信息和笔记数据。</p></div>`;failure(e);}
}
run(init);

