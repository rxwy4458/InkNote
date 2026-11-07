import {uid} from './core.mjs';
export const THUMB_SIZE=76;
export async function readCommentImage(file,adapters={}){
 if(file.size>12*1024*1024)throw new Error('单张批注图片最大 12 MB');const bytes=new Uint8Array(await file.arrayBuffer());let mime;
 if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)mime='image/png';
 else if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';
 else if(bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46)mime='image/gif';
 else if(String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP')mime='image/webp';
 else throw new Error('批注图片支持 PNG、JPG、GIF、WebP');
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const src=`data:${mime};base64,${btoa(binary)}`;
 const loaded=adapters.loadImage?await adapters.loadImage(src).then(image=>({image,width:image.width,height:image.height})):await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight,image});image.onerror=()=>reject(new Error('图片文件无法读取'));image.src=src;});
 if(loaded.width>30000||loaded.height>30000)throw new Error('图片单边尺寸超过 30000 像素');
 const canvas=adapters.createCanvas?.()||document.createElement('canvas');canvas.width=THUMB_SIZE*2;canvas.height=THUMB_SIZE*2;const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,canvas.width,canvas.height);const scale=Math.max(canvas.width/loaded.width,canvas.height/loaded.height);c.drawImage(loaded.image,(canvas.width-loaded.width*scale)/2,(canvas.height-loaded.height*scale)/2,loaded.width*scale,loaded.height*scale);
 return {id:uid(),name:file.name,src,thumbnail:canvas.toDataURL('image/jpeg',.82),width:loaded.width,height:loaded.height};
}
