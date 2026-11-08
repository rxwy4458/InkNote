// Minimal ZIP (stored, no compression) writer and reader for large .inknote backups.
// Large originals (PDF / e-book up to 1 GB) are kept as their own entry instead of base64 inside JSON,
// so neither side ever builds a string bigger than the document text itself. Data stays in Blobs:
// writing concatenates Blob parts, reading slices the file, so a 1 GB file is never copied twice.
const TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export function crc32(bytes,crc=0){crc=~crc>>>0;for(let i=0;i<bytes.length;i++)crc=TABLE[(crc^bytes[i])&255]^(crc>>>8);return ~crc>>>0;}
async function crcOf(data){
 if(data instanceof Uint8Array)return crc32(data);
 let crc=0;const step=16*1024*1024;for(let o=0;o<data.size;o+=step)crc=crc32(new Uint8Array(await data.slice(o,o+step).arrayBuffer()),crc);return crc;
}
const enc=new TextEncoder();
function dosTime(d=new Date()){return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};}
// entries: [{name, data: Uint8Array | Blob | string}] → Blob
export async function writeZip(entries){
 const parts=[],central=[];let offset=0;const {time,date}=dosTime();
 for(const e of entries){
  const data=typeof e.data==='string'?enc.encode(e.data):e.data,size=data instanceof Uint8Array?data.length:data.size,name=enc.encode(e.name),crc=await crcOf(data);
  if(size>0xfffffffe||offset>0xfffffffe)throw new Error('备份文件超过 4 GB，无法写入。');
  const local=new DataView(new ArrayBuffer(30));
  local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x0800,true);local.setUint16(8,0,true);local.setUint16(10,time,true);local.setUint16(12,date,true);
  local.setUint32(14,crc,true);local.setUint32(18,size,true);local.setUint32(22,size,true);local.setUint16(26,name.length,true);local.setUint16(28,0,true);
  const head=new DataView(new ArrayBuffer(46));
  head.setUint32(0,0x02014b50,true);head.setUint16(4,20,true);head.setUint16(6,20,true);head.setUint16(8,0x0800,true);head.setUint16(10,0,true);head.setUint16(12,time,true);head.setUint16(14,date,true);
  head.setUint32(16,crc,true);head.setUint32(20,size,true);head.setUint32(24,size,true);head.setUint16(28,name.length,true);head.setUint32(42,offset,true);
  parts.push(local.buffer,name,data);central.push(head.buffer,name);offset+=30+name.length+size;
 }
 const cdSize=central.reduce((n,p)=>n+(p.byteLength??p.length),0),end=new DataView(new ArrayBuffer(22));
 end.setUint32(0,0x06054b50,true);end.setUint16(8,entries.length,true);end.setUint16(10,entries.length,true);end.setUint32(12,cdSize,true);end.setUint32(16,offset,true);
 return new Blob([...parts,...central,end.buffer],{type:'application/octet-stream'});
}
export async function isZip(blob){const b=new Uint8Array(await blob.slice(0,4).arrayBuffer());return b[0]===0x50&&b[1]===0x4b&&b[2]===3&&b[3]===4;}
// → Map(name → {size, crc, blob}) for stored entries; refuses compressed or malformed archives.
export async function readZip(blob){
 const tailSize=Math.min(blob.size,65557),tail=new DataView(await blob.slice(blob.size-tailSize).arrayBuffer());let eocd=-1;
 for(let i=tailSize-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new Error('备份文件不完整。');
 const count=tail.getUint16(eocd+10,true),cdSize=tail.getUint32(eocd+12,true),cdOffset=tail.getUint32(eocd+16,true);
 if(count>64||cdOffset+cdSize>blob.size)throw new Error('备份文件结构无效。');
 const cd=new DataView(await blob.slice(cdOffset,cdOffset+cdSize).arrayBuffer()),dec=new TextDecoder(),out=new Map();let p=0;
 for(let i=0;i<count;i++){
  if(cd.getUint32(p,true)!==0x02014b50)throw new Error('备份文件结构无效。');
  const method=cd.getUint16(p+10,true),crc=cd.getUint32(p+16,true),size=cd.getUint32(p+20,true),nameLen=cd.getUint16(p+28,true),extra=cd.getUint16(p+30,true),comment=cd.getUint16(p+32,true),local=cd.getUint32(p+42,true);
  const name=dec.decode(new Uint8Array(cd.buffer,cd.byteOffset+p+46,nameLen));p+=46+nameLen+extra+comment;
  if(method!==0)throw new Error('备份文件使用了不支持的压缩方式。');
  const lh=new DataView(await blob.slice(local,local+30).arrayBuffer());if(lh.getUint32(0,true)!==0x04034b50)throw new Error('备份文件结构无效。');
  const start=local+30+lh.getUint16(26,true)+lh.getUint16(28,true);if(start+size>blob.size)throw new Error('备份文件不完整。');
  out.set(name,{size,crc,blob:blob.slice(start,start+size)});
 }
 return out;
}
export async function readEntry(entry,{check=true}={}){const bytes=new Uint8Array(await entry.blob.arrayBuffer());if(check&&crc32(bytes)!==entry.crc)throw new Error('备份文件已损坏（校验不一致）。');return bytes;}
