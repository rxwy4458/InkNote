import {bounds,intersects,newPage,PAPER} from './core.mjs';
import {formatTimestamp,roots,commentPosition} from './comments.mjs';
export function newInfinitePage(template='dot'){return {...newPage(template),infinite:true,width:1600,height:2000};}
export function nonnegative(p){return {...p,x:Math.max(0,p.x),y:Math.max(0,p.y)};}
export function growExtent(page,x,y,padding=900){const w=page.width,h=page.height;if(x>page.width-400)page.width=Math.ceil((x+padding)/512)*512;if(y>page.height-400)page.height=Math.ceil((y+padding)/512)*512;return w!==page.width||h!==page.height;}
export function visibleAnnotations(annotations,view){return annotations.filter(a=>intersects(bounds(a),view));}
export function contentExtent(page){let width=PAPER.width,height=PAPER.height;for(const a of page.annotations){const b=bounds(a);width=Math.max(width,b.x+b.w+40);height=Math.max(height,b.y+b.h+40);}for(const root of roots(page)){const pos=commentPosition(page,root);width=Math.max(width,pos.x+40);height=Math.max(height,pos.y+40);}return {width,height};}
export function exportTiles(page,max=600){const e=contentExtent(page),cols=Math.ceil(e.width/PAPER.width),rows=Math.ceil(e.height/PAPER.height);if(cols*rows>max)throw new Error('画布内容超过 600 张 A4 纸，请分成多份笔记后导出；可编辑备份可保留完整画布。');const result=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)result.push({x:c*PAPER.width,y:r*PAPER.height,width:PAPER.width,height:PAPER.height});return result;}
export function dateLabel(iso){if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw new Error('请选择有效日期');const d=new Date(iso+'T00:00:00Z');if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==iso)throw new Error('日期无效');return `${d.getUTCFullYear()}年${d.getUTCMonth()+1}月${d.getUTCDate()}日` ;}
// Accent colours used on the paper itself (page header, guide pages). The app sets these from the
// light variant of the current theme, so pages and exported PDFs always stay on white paper.
export const paperAccent={primary:'#65558f',container:'#e9ddff',onContainer:'#4d3d75',tertiary:'#7e5260',tertiaryContainer:'#ffd9e3'};
export function setPaperAccent(a){for(const k of Object.keys(paperAccent))if(typeof a?.[k]==='string'&&/^#[\da-f]{6}$/i.test(a[k]))paperAccent[k]=a[k];}
export const PAPER_FONT='"Segoe UI","Microsoft YaHei",sans-serif';
export const SPACINGS=['narrow','standard','wide'];
const STEPS={paged:{ruled:{narrow:18,standard:25,wide:34},grid:{narrow:16,standard:22,wide:30},dot:{narrow:14,standard:20,wide:28}},infinite:{ruled:{narrow:19,standard:26,wide:35},grid:{narrow:16,standard:22,wide:30},dot:{narrow:16,standard:22,wide:30}}};
export function spacingStep(page){const t=STEPS[page.infinite?'infinite':'paged'][page.template];return t?t[SPACINGS.includes(page.spacing)?page.spacing:'standard']:0;}
// OneNote-style header: an editable title on an underline, with the date and time below it.
// Pages saved before 0.5.0 have no title field; they keep a compact header where the old time chip was.
export function pageHeader(page){
 const inf=!!page.infinite,x=inf?44:38,top=inf?28:14,h=30,size=21,legacy=page.title===undefined;
 return {x,top,h,size,legacy,underline:top+h+3,metaY:top+h+15,legacyMetaY:inf?53:38.5,width:inf?640:Math.max(120,(page.width||595)-x*2),bottom:legacy?(page.timeCanvas?(inf?70:54):0):top+h+(page.timeCanvas?24:8)};
}
export function marginX(page){return page.infinite?34:30;}
export function stampParts(time){
 const f=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',weekday:'long',hour:'numeric',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
 const v=t=>f.find(p=>p.type===t)?.value||'';return {date:`${v('year')}年${v('month')}月${v('day')}日 ${v('weekday')}`,time:`${+v('hour')}:${v('minute')}`};
}
export function drawPageHeader(ctx,page){
 const g=pageHeader(page);ctx.save();ctx.textBaseline='middle';
 if(!g.legacy){
  let tw=0;
  if(page.title){ctx.font=`600 ${g.size}px ${PAPER_FONT}`;tw=ctx.measureText(page.title).width;ctx.save();ctx.beginPath();ctx.rect(g.x-2,g.top,g.width+4,g.h);ctx.clip();ctx.fillStyle='#1d1b20';ctx.fillText(page.title,g.x,g.top+g.h/2+1);ctx.restore();}
  ctx.strokeStyle='#cac4d0';ctx.lineWidth=.9;ctx.beginPath();ctx.moveTo(g.x,g.underline);ctx.lineTo(g.x+Math.min(g.width,Math.max(260,tw+28)),g.underline);ctx.stroke();
 }
 if(page.timeCanvas&&Number.isFinite(page.canvasCreatedAt)){
  const s=stampParts(page.canvasCreatedAt),y=g.legacy?g.legacyMetaY:g.metaY;ctx.font=`11.5px ${PAPER_FONT}`;
  ctx.fillStyle='#625d68';ctx.fillText(s.date,g.x,y);ctx.fillStyle=paperAccent.primary;ctx.fillText(s.time,g.x+ctx.measureText(s.date).width+16,y);
 }
 ctx.restore();
}
export function drawMarginLine(ctx,page,y0,y1){if(!page.margin)return;const x=marginX(page);ctx.save();ctx.strokeStyle='#f2b8b5';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y1);ctx.stroke();ctx.restore();}
export function drawInfinitePaper(ctx,page,view){
 ctx.save();ctx.fillStyle='#ffffff';ctx.fillRect(view.x,view.y,view.width,view.height);ctx.lineWidth=.45;ctx.strokeStyle='#ddd8e1';
 const step=spacingStep(page)||22,top=pageHeader(page).bottom,x1=view.x+view.width,y1=view.y+view.height;
 const x0=Math.max(0,Math.floor(view.x/step)*step),y0=Math.max(Math.ceil(top/step)*step,Math.floor(view.y/step)*step);
 if(page.template==='dot'){ctx.fillStyle='#c4bfca';for(let x=x0;x<x1;x+=step)for(let y=y0;y<y1;y+=step){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill();}}
 if(page.template==='grid'){for(let x=x0;x<x1;x+=step){ctx.beginPath();ctx.moveTo(x,Math.max(view.y,y0));ctx.lineTo(x,y1);ctx.stroke();}}
 if(page.template==='grid'||page.template==='ruled'){for(let y=y0;y<y1;y+=step){ctx.beginPath();ctx.moveTo(view.x,y);ctx.lineTo(x1,y);ctx.stroke();}}
 drawMarginLine(ctx,page,Math.max(view.y,0),y1);
 ctx.strokeStyle='#cac4cf';ctx.lineWidth=2;ctx.beginPath();if(view.x<2){ctx.moveTo(1,Math.max(0,view.y));ctx.lineTo(1,y1);}if(view.y<2){ctx.moveTo(Math.max(0,view.x),1);ctx.lineTo(x1,1);}ctx.stroke();
 if(view.x<100&&view.y<40){ctx.fillStyle='#79747e';ctx.font=`10px ${PAPER_FONT}`;ctx.textBaseline='alphabetic';ctx.fillText('0, 0 · 纸张起点',14,21);}
 if(view.y<top+20)drawPageHeader(ctx,page);
 ctx.restore();
}
