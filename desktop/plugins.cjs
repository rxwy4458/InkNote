// User-installed plugins live in <app data>/plugins/<id>/ (each with plugin.json). The page reads them through
// inknote://app/user-plugins/<id>/… (served by main.cjs from this folder only). Installing writes into a temporary
// folder first and swaps it in, so a half-copied plugin never loads. Copying a plugin folder in by hand also works:
// the page rescans when the window regains focus.
const {app,dialog,shell,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const ID=/^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_TOTAL=64*1024*1024,MAX_FILES=2000;
const dir=()=>path.join(app.getPath('userData'),'plugins');
const sdkDir=()=>path.resolve(__dirname,'../app/plugin-sdk');

function checkRel(rel){
 if(typeof rel!=='string'||!rel||rel.length>240||rel.includes('\\')||rel.startsWith('/')||/[<>:"|?*\x00-\x1f]/.test(rel))throw new Error('插件包里有无效的文件名：'+String(rel).slice(0,80));
 const parts=rel.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))throw new Error('插件包里有无效的路径：'+rel.slice(0,80));
 return parts;
}
async function stampOf(folder){let latest=0;for(const name of ['plugin.json','index.mjs']){try{latest=Math.max(latest,(await fs.stat(path.join(folder,name))).mtimeMs);}catch{}}return String(Math.round(latest));}
async function list(){
 const root=dir();let entries=[];try{entries=await fs.readdir(root,{withFileTypes:true});}catch{return [];}
 const out=[];
 for(const e of entries){
  if(!e.isDirectory()||!ID.test(e.name))continue;
  const folder=path.join(root,e.name);try{await fs.access(path.join(folder,'plugin.json'));}catch{continue;}
  out.push({id:e.name,stamp:await stampOf(folder)});
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id));
}
async function swapIn(id,staged){
 const root=dir(),target=path.join(root,id);
 let old=null;try{await fs.access(target);old=path.join(root,'.old-'+crypto.randomUUID());await fs.rename(target,old);}catch{old=null;}
 try{await fs.rename(staged,target);}catch(e){if(old)await fs.rename(old,target).catch(()=>{});throw e;}
 if(old)await fs.rm(old,{recursive:true,force:true}).catch(()=>{});
 return {id,stamp:await stampOf(target)};
}
async function install({id,files}){
 if(typeof id!=='string'||!ID.test(id))throw new Error('插件 id 无效。');
 if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)throw new Error('插件包是空的或文件太多。');
 let total=0;for(const f of files){checkRel(f.path);if(!ArrayBuffer.isView(f.bytes))throw new Error('插件文件数据无效。');total+=f.bytes.byteLength;}
 if(total>MAX_TOTAL)throw new Error('插件包超过 64 MB。');
 if(!files.some(f=>f.path==='plugin.json'))throw new Error('插件包里没有 plugin.json。');
 const manifest=JSON.parse(Buffer.from(files.find(f=>f.path==='plugin.json').bytes).toString('utf8'));if(manifest.id!==id)throw new Error('plugin.json 里的 id 不一致。');
 const root=dir();await fs.mkdir(root,{recursive:true});
 const staged=path.join(root,'.install-'+crypto.randomUUID());await fs.mkdir(staged);
 try{for(const f of files){const p=path.join(staged,...checkRel(f.path));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,Buffer.from(f.bytes.buffer,f.bytes.byteOffset,f.bytes.byteLength),{flag:'wx'});}return await swapIn(id,staged);}
 catch(e){await fs.rm(staged,{recursive:true,force:true}).catch(()=>{});throw e;}
}
async function copyTree(from,to,budget){
 for(const e of await fs.readdir(from,{withFileTypes:true})){
  if(e.name.startsWith('.')||e.name==='node_modules')continue;
  const src=path.join(from,e.name),dst=path.join(to,e.name);
  if(e.isSymbolicLink())continue;
  if(e.isDirectory()){await fs.mkdir(dst);await copyTree(src,dst,budget);}
  else if(e.isFile()){const st=await fs.stat(src);budget.bytes-=st.size;budget.files--;if(budget.bytes<0||budget.files<0)throw new Error('插件文件夹太大（超过 64 MB 或 2000 个文件）。');await fs.copyFile(src,dst);}
 }
}
async function installFolder(){
 const win=BrowserWindow.getAllWindows()[0];
 const r=await dialog.showOpenDialog(win,{title:'选择插件文件夹（里面有 plugin.json）',properties:['openDirectory']});
 if(r.canceled||!r.filePaths?.[0])return null;
 const from=r.filePaths[0];let manifest;
 try{manifest=JSON.parse(await fs.readFile(path.join(from,'plugin.json'),'utf8'));}catch{throw new Error('这个文件夹里没有有效的 plugin.json。');}
 if(typeof manifest.id!=='string'||!ID.test(manifest.id))throw new Error('plugin.json 里的 id 无效：只能用小写字母、数字和连字符。');
 const root=dir();if(path.resolve(from).startsWith(path.resolve(root)+path.sep))throw new Error('这个文件夹已经在插件文件夹里了，回到墨页会自动扫描。');
 await fs.mkdir(root,{recursive:true});const staged=path.join(root,'.install-'+crypto.randomUUID());await fs.mkdir(staged);
 try{await copyTree(from,staged,{bytes:MAX_TOTAL,files:MAX_FILES});return await swapIn(manifest.id,staged);}
 catch(e){await fs.rm(staged,{recursive:true,force:true}).catch(()=>{});throw e;}
}
async function remove({id}){
 if(typeof id!=='string'||!ID.test(id))throw new Error('插件 id 无效。');
 const target=path.join(dir(),id);try{await fs.access(target);}catch{return true;}
 try{await shell.trashItem(target);}catch{const gone=path.join(dir(),'.removed-'+crypto.randomUUID());await fs.rename(target,gone);await fs.rm(gone,{recursive:true,force:true}).catch(()=>{});}
 return true;
}
async function openFolder(){const root=dir();await fs.mkdir(root,{recursive:true});const err=await shell.openPath(root);if(err)throw new Error(err);return true;}
async function openSdk(){const err=await shell.openPath(sdkDir());if(err)throw new Error(err);return true;}
// For the inknote:// protocol: map /user-plugins/<id>/<file> to a file inside that plugin's folder, or null.
function resolveUserFile(pathname){
 const rest=pathname.slice('/user-plugins/'.length),parts=rest.split('/');
 if(parts.length<2||!ID.test(parts[0])||parts.slice(1).some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))return null;
 const root=path.join(dir(),parts[0]),file=path.resolve(root,...parts.slice(1));
 return file.startsWith(root+path.sep)?file:null;
}
function register(ipcMain,trusted){
 const handle=(channel,fn)=>ipcMain.handle(channel,async(event,payload)=>{if(!trusted(event))return {error:'操作来源无效。'};try{return {value:await fn(payload||{})};}catch(e){return {error:e.message||String(e)};}});
 handle('plugins:list',list);handle('plugins:install',install);handle('plugins:install-folder',installFolder);handle('plugins:remove',remove);handle('plugins:open-folder',openFolder);handle('plugins:open-sdk',openSdk);
}
module.exports={register,resolveUserFile,dir};
