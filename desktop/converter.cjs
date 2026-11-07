const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const formats=new Set(['mobi','azw','azw3','azw4','prc','rtf','docx','odt','chm','lit','lrf','pdb','snb','tcr','djvu','cbr']);
async function locateConverter(configured){
 const candidates=[configured];
 for(const root of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean))candidates.push(path.join(root,'Calibre2','ebook-convert.exe'),path.join(root,'calibre','ebook-convert.exe'));
 for(const file of candidates.filter(Boolean)){
  if(path.basename(file).toLowerCase()!=='ebook-convert.exe')continue;
  try{if((await fs.stat(file)).isFile())return file;}catch{}
 }
 return null;
}
async function convertEbook(payload,configured){
 if(!payload||typeof payload.name!=='string'||!ArrayBuffer.isView(payload.bytes)||payload.bytes.byteLength>200*1024*1024)throw new Error('电子书文件无效或超过 200 MB');
 const ext=path.extname(payload.name).slice(1).toLowerCase();if(!formats.has(ext))throw new Error('不支持此转换格式');
 const executable=await locateConverter(configured);
 if(!executable)throw new Error('此格式需要本机 Calibre 转换组件。请安装 Calibre，或在「偏好设置」选择 ebook-convert.exe。EPUB、TXT、FB2、CBZ 可直接导入。');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inknote-book-'));
 try{
  const input=path.join(dir,'input.'+ext),output=path.join(dir,'book.epub');await fs.writeFile(input,Buffer.from(payload.bytes.buffer,payload.bytes.byteOffset,payload.bytes.byteLength));
  await new Promise((resolve,reject)=>{
   const child=spawn(executable,[input,output],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let details='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill();},120000);
   const capture=data=>{if(details.length<8000)details+=data.toString().slice(0,8000-details.length);};child.stdout.on('data',capture);child.stderr.on('data',capture);
   child.on('error',e=>{clearTimeout(timer);reject(new Error('转换组件无法启动：'+e.message));});
   child.on('close',code=>{clearTimeout(timer);if(timedOut)reject(new Error('电子书转换超过 2 分钟，请先用 Calibre 单独转换为 EPUB'));else if(code!==0)reject(new Error(/DRM|encrypted/i.test(details)?'电子书受 DRM 或密码保护，请使用原阅读软件导出可读取的副本':'Calibre 未能转换这份电子书，请检查文件是否损坏或格式受支持'));else resolve();});
  });
  const stat=await fs.stat(output);if(stat.size>128*1024*1024)throw new Error('转换后的 EPUB 超过 128 MB');const data=await fs.readFile(output);if(data[0]!==0x50||data[1]!==0x4b)throw new Error('转换输出不是有效 EPUB');return new Uint8Array(data);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={locateConverter,convertEbook};
