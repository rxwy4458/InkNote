import {paperAccent,spacingStep,pageHeader,drawPageHeader,drawMarginLine} from './infinite.mjs';
const FONT='"Segoe UI","Microsoft YaHei",sans-serif';
const INK='#1d1b20',INK2='#49454f',INK3='#79747e',RULE='#e7e0ec';
export function background(ctx,page,scale=1){
 const {width:w,height:h}=page;
 ctx.save();ctx.scale(scale,scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
 if(page.template==='guide'){guide(ctx,page.guide||0,w,h);ctx.restore();return;}
 const step=spacingStep(page),header=pageHeader(page),top=header.bottom;
 ctx.lineWidth=.45;ctx.strokeStyle='#ddd8e1';
 if(page.template==='ruled'){for(let y=header.legacy?66:Math.max(66,top+step*.6);y<h-36;y+=step){ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(w-38,y);ctx.stroke();}}
 if(page.template==='grid'){const y0=Math.ceil(top/step)*step;for(let x=0;x<w;x+=step){ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,h);ctx.stroke();}for(let y=y0;y<h;y+=step){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}}
 if(page.template==='dot'){ctx.fillStyle='#c4bfca';const y0=Math.max(28,Math.ceil((top+4)/step)*step+8);for(let x=28;x<w;x+=step)for(let y=y0;y<h;y+=step){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill();}}
 drawMarginLine(ctx,page,0,h);
 drawPageHeader(ctx,page);
 ctx.restore();
}
// The three-page welcome notebook. Drawn at render time, so older guide notebooks pick up this look too.
function guide(c,n,w,h){
 const text=(s,x,y,size=13,color=INK2,weight='')=>{c.fillStyle=color;c.font=`${weight}${size}px ${FONT}`;c.fillText(s,x,y);};
 const line=(x1,y1,x2,y2,color=RULE,width=.6)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
 const PRIMARY=paperAccent.primary;
 c.textBaseline='alphabetic';
 text('墨页 · 使用指南',45,55,10,INK3);text(`${n+1} / 3`,w-70,55,10,INK3);line(45,68,w-45,68);
 if(n===0){
  c.fillStyle=paperAccent.container;c.beginPath();c.arc(68,127,23,0,Math.PI*2);c.fill();
  c.fillStyle=paperAccent.onContainer;c.font=`600 22px ${FONT}`;c.textAlign='center';c.textBaseline='middle';c.fillText('墨',68,128);c.textAlign='start';c.textBaseline='alphabetic';
  c.fillStyle=PRIMARY;c.font=`600 40px ${FONT}`;c.fillText('把想法，',45,218);c.fillText('写下来。',45,272);
  text('读一份文档，写几行随想，记下某个时刻。',47,312,13,INK3);
  text('欢迎使用墨页',47,380,16,INK,'600 ');
  ['上方工具栏选择画笔、荧光笔或文字；','时间画布会自动写下创建的日期和时间；','所有内容只保存在这台电脑上。'].forEach((s,i)=>text(s,47,414+i*28,12.5,INK2));
  c.fillStyle='#f7f2fa';c.fillRect(45,520,w-90,180);c.setLineDash([4,5]);c.strokeStyle=paperAccent.container;c.lineWidth=1;c.strokeRect(58,533,w-116,154);c.setLineDash([]);
  text('在这里写下第一笔',92,604,14,INK3);text('鼠标、触控笔或手指都可以',92,630,11,'#938f99');
 }else if(n===1){
  text('常用工具',45,140,31,INK,'600 ');text('键盘上的字母可以直接切换工具。',47,176,12.5,INK3);
  const rows=[['01','画笔与荧光笔  P · H','画笔随笔压变化粗细；荧光笔半透明，不遮挡原文。'],['02','文字、矩形与日期  T · R','点击页面输入文字；「日期」按钮插入可移动的日期。'],['03','套索与橡皮擦  L · E','框选后拖动或按 Delete 删除；橡皮擦按整条擦除。'],['04','批注  C','点击页面固定一个想法，可逐层回复并附图片。'],['05','保存与导出  Ctrl S · Ctrl Shift E','自动保存在本机；导出 PDF 分享，导出 .inknote 继续编辑。']];
  rows.forEach((r,i)=>{const y=250+i*92;text(r[0],47,y,13,PRIMARY,'600 ');text(r[1],85,y,14.5,INK,'600 ');text(r[2],85,y+26,11.5,INK2);line(85,y+50,w-47,y+50);});
 }else{
  text('这一页，',45,140,31,INK,'600 ');text('留给你自己。',45,186,31,INK,'600 ');
  text('慢慢想，慢慢写。',47,226,12.5,INK3);
  for(let y=300;y<h-100;y+=30)line(47,y,w-47,y);
 }
 text('墨页 InkNote',45,h-38,9,INK3);text('本机保存',w-90,h-38,9,INK3);
}
