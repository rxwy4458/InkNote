// 笔记库文件夹 (library folder): the user picks one folder — it can sit inside a OneDrive / 百度网盘 / Google 云端硬盘
// sync folder, on a USB stick, anywhere. The page mirrors the library into it as plain files: one sub-folder per sidebar
// folder, notes as .inknote files, imported PDFs and e-books as the original file plus "<file>.inknote" with the
// annotations. Files the user copies in are scanned and imported.
// The page never names an arbitrary path: it passes "name" or "folder/name" (one level), and only those inside the
// folder the user chose in the system dialog can be read, written or removed.
const {app,dialog,shell,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const fsWatch=require('node:fs').watch;
const path=require('node:path');
const crypto=require('node:crypto');

const SOURCE=['pdf','epub','txt','md','fb2','html','htm','cbz','mobi','azw','azw3','azw4','prc','rtf','docx','odt','chm','lit','lrf','pdb','snb','tcr','djvu','cbr'];
const ALLOWED=new Set(['inknote',...SOURCE]);
const configFile=()=>path.join(app.getPath('userData'),'exchange-folder.json');
let folder=null,loaded=false;
const writes=new Map();
const MAX_FILE=2*1024*1024*1024,MAX_CHUNK=64*1024*1024;

async function load(){if(!loaded){loaded=true;try{const c=JSON.parse(await fs.readFile(configFile(),'utf8'));if(typeof c.folder==='string'&&path.isAbsolute(c.folder))folder=c.folder;}catch{}}return folder;}
async function save(){const tmp=configFile()+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify({folder}),{flag:'wx'});await fs.rename(tmp,configFile());}
async function exists(dir){try{return (await fs.stat(dir)).isDirectory();}catch{return false;}}
// One file or folder name Windows accepts (no reserved characters or device names such as CON / NUL / COM1).
function segment(s){return typeof s==='string'&&s.length>0&&s.length<=200&&!s.startsWith('.')&&!/[<>:"/\\|?*\x00-\x1f]/.test(s)&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s);}
const SYSTEM_DIR=/^(\$recycle\.bin|system volume information|recycler|found\.\d+)$/i;
// "name.ext" or "folder/name.ext" → path parts, or throw.
function checkName(name,{dir=false}={}){
 if(typeof name!=='string'||name.length>420)throw new Error('文件名无效。');
 const parts=name.split('/');
 if(dir){if(parts.length!==1||!segment(parts[0]))throw new Error('文件夹名无效。');return parts;}
 if(parts.length>2||!parts.every(segment))throw new Error('文件名无效。');
 const ext=parts.at(-1).includes('.')?parts.at(-1).split('.').pop().toLowerCase():'';
 if(!ALLOWED.has(ext))throw new Error('不支持的文件类型。');
 return parts;
}
async function ready(){const dir=await load();if(!dir)throw new Error('还没有选择笔记库文件夹。');if(!await exists(dir))throw new Error('找不到笔记库文件夹「'+dir+'」，它可能被移动、改名或所在的磁盘没有连接。请重新选择。');return dir;}
const inside=(dir,parts)=>{const p=path.resolve(dir,...parts);if(!p.startsWith(path.resolve(dir)+path.sep))throw new Error('文件名无效。');return p;};

async function status(){const dir=await load(),ok=dir?await exists(dir):false;if(ok)startWatch(dir);return {folder:dir,exists:ok};}
// Changes inside the folder (files copied in from Explorer, a cloud client syncing) → tell the page, which rescans.
let watcher=null,watched=null,watchTimer=0;
function stopWatch(){clearTimeout(watchTimer);try{watcher?.close();}catch{}watcher=null;watched=null;}
function startWatch(dir){
 if(watcher&&watched===dir)return;stopWatch();
 try{
  watcher=fsWatch(dir,{recursive:true},(_event,name)=>{
   if(/(^|[\\/])\./.test(String(name||'')))return; // our own temporary files and hidden files
   clearTimeout(watchTimer);watchTimer=setTimeout(()=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send('exchange:changed');},1200);
  });
  watcher.on('error',stopWatch);watched=dir;
 }catch{watcher=null;watched=null;}
}
async function choose(){
 const dir=await load();const win=BrowserWindow.getAllWindows()[0];
 const r=await dialog.showOpenDialog(win,{title:'选择笔记库文件夹',defaultPath:dir&&await exists(dir)?dir:app.getPath('documents'),properties:['openDirectory','createDirectory','promptToCreate']});
 if(r.canceled||!r.filePaths?.[0])return status();
 folder=r.filePaths[0];await fs.mkdir(folder,{recursive:true});await save();stopWatch();return status();
}
// "Make a 墨页笔记库 folder inside the one I picked" (when the picked folder already holds other things).
async function useSub({folder:sub}){const dir=await ready(),target=inside(dir,checkName(sub,{dir:true}));await fs.mkdir(target,{recursive:true});folder=target;await save();stopWatch();return status();}
async function open({folder:sub}={}){const dir=await ready();const target=sub?inside(dir,checkName(sub,{dir:true})):dir;const err=await shell.openPath(target);if(err)throw new Error(err);return true;}
async function fileEntry(dir,rel){try{const s=await fs.stat(path.join(dir,...rel.split('/')));return s.isFile()?{name:rel,folder:rel.includes('/')?rel.split('/')[0]:'',size:s.size,mtime:Math.round(s.mtimeMs)}:null;}catch{return null;}}
// Temporary files left by an export that was cut off (app closed, disk unplugged): removed after a day.
async function sweep(dir,name){
 if(!/^\.inknote-[\w-]+\.tmp$/.test(name))return;const p=path.join(dir,name);if([...writes.values()].some(w=>w.temporary===p))return;
 try{const s=await fs.stat(p);if(Date.now()-s.mtimeMs>86400000)await fs.unlink(p);}catch{}
}
// Everything 墨页 cares about: sub-folders (sidebar folders) and supported files at the top level and one level down.
async function scan(){
 const dir=await ready(),files=[],folders=[];
 for(const e of await fs.readdir(dir,{withFileTypes:true})){
  if(e.name.startsWith('.')){if(e.isFile())await sweep(dir,e.name);continue;}
  if(e.isDirectory()&&segment(e.name)&&!SYSTEM_DIR.test(e.name)){
   folders.push(e.name);
   let inner=[];try{inner=await fs.readdir(path.join(dir,e.name),{withFileTypes:true});}catch{}
   for(const f of inner){if(!f.isFile())continue;if(f.name.startsWith('.')){await sweep(path.join(dir,e.name),f.name);continue;}const rel=e.name+'/'+f.name;try{checkName(rel);}catch{continue;}const x=await fileEntry(dir,rel);if(x)files.push(x);}
  }else if(e.isFile()){try{checkName(e.name);}catch{continue;}const x=await fileEntry(dir,e.name);if(x)files.push(x);}
 }
 return {folders:folders.sort((a,b)=>a.localeCompare(b)),files:files.sort((a,b)=>a.name.localeCompare(b.name))};
}
// Older pages (0.6.1) only asked for top-level .inknote files.
async function list(){return (await scan()).files.filter(f=>!f.folder&&/\.inknote$/i.test(f.name));}
async function read({name,start,end}){
 const dir=await ready(),file=inside(dir,checkName(name));
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start+1>MAX_CHUNK)throw new Error('读取范围无效。');
 const h=await fs.open(file,'r');
 try{const buf=Buffer.alloc(end-start+1);const {bytesRead}=await h.read(buf,0,buf.length,start);return new Uint8Array(buf.buffer,buf.byteOffset,bytesRead);}
 finally{await h.close();}
}
async function mkdir({folder:sub}){const dir=await ready();await fs.mkdir(inside(dir,checkName(sub,{dir:true})),{recursive:true});return true;}
async function writeBegin({name,size}){
 const dir=await ready(),parts=checkName(name);
 if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE)throw new Error('导出数据无效或文件过大。');
 const target=inside(dir,parts);await fs.mkdir(path.dirname(target),{recursive:true});
 const temporary=path.join(path.dirname(target),'.inknote-'+crypto.randomUUID()+'.tmp'),handle=await fs.open(temporary,'wx'),token=crypto.randomUUID();
 writes.set(token,{handle,temporary,target,size,written:0,dir});return {token};
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
  // The same note written earlier under another name (renamed / moved to another folder): remove the old file.
  for(const old of Array.isArray(replaces)?replaces.slice(0,20):[]){try{const p=inside(w.dir,checkName(old));if(p!==w.target)await fs.unlink(p);}catch{}}
  return {saved:true,entry:await fileEntry(w.dir,path.relative(w.dir,w.target).split(path.sep).join('/'))};
 }catch(e){await fs.unlink(w.temporary).catch(()=>{});throw e;}
}
async function rename({from,to}){
 const dir=await ready(),a=inside(dir,checkName(from)),b=inside(dir,checkName(to));
 if(a===b)return fileEntry(dir,to);
 try{await fs.access(b);throw new Error('目标文件已存在：'+to);}catch(e){if(e.code!=='ENOENT'&&!/ENOENT/.test(String(e.code)))throw e;}
 await fs.mkdir(path.dirname(b),{recursive:true});await fs.rename(a,b);return fileEntry(dir,to);
}
// Files another program still has open for writing (Explorer copying a large PDF in, say). Windows answers a second
// writer with a sharing violation (EBUSY) while the copy runs; a read-only file is not busy.
async function busy({names}){
 const dir=await ready(),out=[];
 for(const name of Array.isArray(names)?names.slice(0,200):[]){
  let p;try{p=inside(dir,checkName(name));}catch{continue;}
  try{const h=await fs.open(p,'r+');await h.close();}catch(e){if(e.code==='EBUSY')out.push(name);}
 }
 return out;
}
// trash: files of notes deleted in 墨页 go to the Recycle Bin (where the drive has one) instead of being erased.
async function remove({names,trash=false}){
 const dir=await ready();let n=0;const failed=[];
 for(const name of Array.isArray(names)?names.slice(0,1000):[]){
  let p;try{p=inside(dir,checkName(name));}catch{failed.push(name);continue;}
  if(trash){try{await shell.trashItem(p);n++;continue;}catch{}}
  try{await fs.unlink(p);n++;}catch(e){if(e.code!=='ENOENT')failed.push(name);}
 }
 return {removed:n,failed};
}

function register(ipcMain,trusted){
 const handle=(channel,fn)=>ipcMain.handle(channel,async(event,payload)=>{
  if(!trusted(event))return {error:'操作来源无效。'};
  try{return {value:await fn(payload||{})};}catch(e){return {error:e.message||String(e)};}
 });
 handle('exchange:status',status);handle('exchange:choose',choose);handle('exchange:open',open);handle('exchange:list',list);handle('exchange:scan',scan);handle('exchange:mkdir',mkdir);handle('exchange:rename',rename);handle('exchange:use-sub',useSub);handle('exchange:busy',busy);
 handle('exchange:read',read);handle('exchange:write-begin',writeBegin);handle('exchange:write-chunk',writeChunk);handle('exchange:write-end',writeEnd);handle('exchange:remove',remove);
}
module.exports={register,checkName,segment};
