export const PAPER={width:595.28,height:841.89};
export const COLORS=['#1f1f1f','#1a73e8','#d93025','#188038','#9334e6','#e37400'];
export const MARKERS=['#fdd663','#81c995','#8ab4f8','#f6aea9'];
export function uid(){if(globalThis.crypto.randomUUID)return globalThis.crypto.randomUUID();const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function clamp(n,min,max){return Math.min(max,Math.max(min,n));}
export function distanceToSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;const t=dx*dx+dy*dy?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy),0,1):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
export function bounds(a){
 if(a.type==='text')return {x:a.x,y:a.y,w:a.w||Math.max(...a.text.split('\n').map(t=>[...t].length))*a.size,h:a.h||a.text.split('\n').length*a.size*1.45};
 if(a.type==='rect')return {x:Math.min(a.x,a.x+a.w),y:Math.min(a.y,a.y+a.h),w:Math.abs(a.w),h:Math.abs(a.h)};
 const xs=a.points.map(p=>p.x),ys=a.points.map(p=>p.y),r=a.width/2;return {x:Math.min(...xs)-r,y:Math.min(...ys)-r,w:Math.max(...xs)-Math.min(...xs)+2*r,h:Math.max(...ys)-Math.min(...ys)+2*r};
}
export function inside(p,b,pad=0){return p.x>=b.x-pad&&p.x<=b.x+b.w+pad&&p.y>=b.y-pad&&p.y<=b.y+b.h+pad;}
export function intersects(a,b){return a.x<=b.x+b.w&&a.x+a.w>=b.x&&a.y<=b.y+b.h&&a.y+a.h>=b.y;}
export function hitAnnotation(a,p,r=9){
 if(!inside(p,bounds(a),r))return false;
 if(a.type==='text')return true;
 if(a.type==='rect'){const b=bounds(a);return Math.min(distanceToSegment(p,{x:b.x,y:b.y},{x:b.x+b.w,y:b.y}),distanceToSegment(p,{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h}),distanceToSegment(p,{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}),distanceToSegment(p,{x:b.x,y:b.y+b.h},{x:b.x,y:b.y}))<=r+a.width/2;}
 return a.points.some((q,i)=>distanceToSegment(p,q,a.points[Math.max(0,i-1)])<=r+a.width/2);
}
export function translate(a,dx,dy){if(a.points)a.points=a.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}));else{a.x+=dx;a.y+=dy;}}
export function drawAnnotation(ctx,a){
 ctx.save();ctx.strokeStyle=a.color;ctx.fillStyle=a.color;ctx.lineCap='round';ctx.lineJoin='round';
 if(a.type==='text'){ctx.font=`${a.size}px "Segoe UI", "Microsoft YaHei", sans-serif`;ctx.textBaseline='top';a.text.split('\n').forEach((s,i)=>ctx.fillText(s,a.x,a.y+i*a.size*1.45));}
 else if(a.type==='rect'){ctx.lineWidth=a.width;ctx.strokeRect(a.x,a.y,a.w,a.h);}
 else if(a.type==='marker'){
   ctx.globalAlpha=.38;ctx.lineWidth=a.width;ctx.beginPath();a.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(a.points.length===1){ctx.lineTo(a.points[0].x+.01,a.points[0].y);}ctx.stroke();
 }else{
   if(a.points.length===1){const p=a.points[0];ctx.beginPath();ctx.arc(p.x,p.y,a.width*(.35+.65*p.p)/2,0,Math.PI*2);ctx.fill();}
   for(let i=1;i<a.points.length;i++){const p=a.points[i-1],q=a.points[i];ctx.lineWidth=a.width*(a.pressure?(.35+.65*(p.p+q.p)/2):1);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
 }
 ctx.restore();
}
// Map an upright viewport image back to the unrotated PDF crop box.
export function overlayPlacement(crop,rotation){
 const r=((rotation%360)+360)%360;const {x,y,width:w,height:h}=crop;
 if(r===90)return {x:x+w,y,width:h,height:w,rotation:90};
 if(r===180)return {x:x+w,y:y+h,width:w,height:h,rotation:180};
 if(r===270)return {x,y:y+h,width:h,height:w,rotation:270};
 return {x,y,width:w,height:h,rotation:0};
}
export function newPage(template='ruled'){return {id:uid(),sourceIndex:null,width:PAPER.width,height:PAPER.height,template,annotations:[],bookmark:false};}
