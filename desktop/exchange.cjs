// Import/export folder: the user picks one folder (it can sit inside a OneDrive / Baidu / Google Drive sync folder,
// on a USB stick, anywhere); "export all" writes one .inknote per note there and "import" reads them back.
// The page never names an arbitrary path: it only ever passes plain file names, and only .inknote files directly
// inside the folder the user chose in the system dialog can be read, written or removed.
const {app,dialog,shell,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const configFile=()=>path.join(app.getPath('userData'),'exchange-folder.json');
let folder=null,loaded=false;
const writes=new Map();
const MAX_FILE=2*1024*1024*1024,MAX_CHUNK=64*1024*1024;

async function load(){if(!loaded){loaded=true;try{const c=JSON.parse(await fs.readFile(configFile(),'utf8'));if(typeof c.folder==='string'&&path.isAbsolute(c.folder))folder=c.folder;}catch{}}return folder;}
async function save(){const tmp=configFile()+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify({folder}),{flag:'wx'});await fs.rename(tmp,configFile());}
async function exists(dir){try{return (await fs.stat(dir)).isDirectory();}catch{return false;}}
function checkName(name){
 if(typeof name!=='string'||!name||name.length>200||path.basename(name)!==name||name.startsWith('.')||!/\.inknote$/i.test(name)||/[<>:"/\\|?*\x00-\x1f]/.test(name))throw new Error('文件名无效。');
 return name;
}
async function ready(){const dir=await load();if(!dir)throw new Error('还没有选择导入导出文件夹。');if(!await exists(dir))throw new Error('找不到导入导出文件夹「'+dir+'」，它可能被移动、改名或所在的磁盘没有连接。请重新选择。');return dir;}

async function status(){const dir=await load();return {folder:dir,exists:dir?await exists(dir):false};}
async function choose(){
 const dir=await load();const win=BrowserWindow.getAllWindows()[0];
 const r=await dialog.showOpenDialog(win,{title:'选择导入导出文件夹',defaultPath:dir&&await exists(dir)?dir:app.getPath('documents'),properties:['openDirectory','createDirectory','promptToCreate']});
 if(r.canceled||!r.filePaths?.[0])return status();
 folder=r.filePaths[0];await fs.mkdir(folder,{recursive:true});await save();return status();
}
async function open(){const dir=await ready();const err=await shell.openPath(dir);if(err)throw new Error(err);return true;}
async function list(){
 const dir=await ready();const out=[];
 for(const e of await fs.readdir(dir,{withFileTypes:true})){
  if(!e.isFile()||e.name.startsWith('.')||!/\.inknote$/i.test(e.name))continue;
  try{const s=await fs.stat(path.join(dir,e.name));out.push({name:e.name,size:s.size,mtime:s.mtimeMs});}catch{}
 }
 return out.sort((a,b)=>a.name.localeCompare(b.name));
}
async function read({name,start,end}){
 const dir=await ready(),file=path.join(dir,checkName(name));
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start+1>MAX_CHUNK)throw new Error('读取范围无效。');
 const h=await fs.open(file,'r');
 try{const buf=Buffer.alloc(end-start+1);const {bytesRead}=await h.read(buf,0,buf.length,start);return new Uint8Array(buf.buffer,buf.byteOffset,bytesRead);}
 finally{await h.close();}
}
async function writeBegin({name,size}){
 const dir=await ready();checkName(name);
 if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE)throw new Error('导出数据无效或文件过大。');
 const temporary=path.join(dir,'.inknote-'+crypto.randomUUID()+'.tmp'),handle=await fs.open(temporary,'wx'),token=crypto.randomUUID();
 writes.set(token,{handle,temporary,target:path.join(dir,name),size,written:0,dir});return {token};
}
async function writeChunk({token,bytes}){
 const w=writes.get(token);if(!w||!ArrayBuffer.isView(bytes)||!bytes.byteLength||bytes.byteLength>MAX_CHUNK||w.written+bytes.byteLength>w.size)throw new Error('导出数据无效。');
 await w.handle.write(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength));w.written+=bytes.byteLength;return {written:w.written};
}
async function writeEnd({token,ok,replaces}){
 const w=writes.get(token);if(!w)throw new Error('导出已结束。');writes.delete(token);
 try{
  await w.handle.close();
  if(ok!==true||w.written!==w.size){await fs.unlink(w.temporary).catch(()=>{});if(ok===true)throw new Error('导出的数据不完整。');return {saved:false};}
  await fs.rename(w.temporary,w.target);
  // The same note exported earlier under its old title: remove that file so the folder holds one file per note.
  for(const old of Array.isArray(replaces)?replaces.slice(0,20):[]){try{const p=path.join(w.dir,checkName(old));if(p!==w.target)await fs.unlink(p);}catch{}}
  return {saved:true};
 }catch(e){await fs.unlink(w.temporary).catch(()=>{});throw e;}
}
async function remove({names}){
 const dir=await ready();let n=0;
 for(const name of Array.isArray(names)?names.slice(0,1000):[]){try{await fs.unlink(path.join(dir,checkName(name)));n++;}catch{}}
 return {removed:n};
}

function register(ipcMain,trusted){
 const handle=(channel,fn)=>ipcMain.handle(channel,async(event,payload)=>{
  if(!trusted(event))return {error:'操作来源无效。'};
  try{return {value:await fn(payload||{})};}catch(e){return {error:e.message||String(e)};}
 });
 handle('exchange:status',status);handle('exchange:choose',choose);handle('exchange:open',open);handle('exchange:list',list);
 handle('exchange:read',read);handle('exchange:write-begin',writeBegin);handle('exchange:write-chunk',writeChunk);handle('exchange:write-end',writeEnd);handle('exchange:remove',remove);
}
module.exports={register};
