import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const mainFile=fileURLToPath(new URL('../desktop/main.cjs',import.meta.url));
const source=await fs.readFile(mainFile,'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'inknote-startup-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'existing-profile'),report=path.join(root,'ready.json');
 await fs.mkdir(profile);await fs.writeFile(path.join(profile,'notes-marker'),'existing notes');
 const loaded=deferred(),renamed=deferred(),state={profileChanges:0,shown:false,closed:false,quit:false};
 const ipcMain=new EventEmitter();ipcMain.handle=()=>{};
 const app=new EventEmitter();Object.assign(app,{isPackaged:true,setAppUserModelId(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),getVersion:()=> '0.3.3',getPath:()=>profile,setPath(){state.profileChanges++;},quit(){state.quit=true;},exit(code){state.exit=code;}});
 class BrowserWindow extends EventEmitter{
  constructor(){super();state.window=this;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};}
  async loadURL(url){state.url=url;loaded.resolve();}
  show(){state.shown=true;}
  close(){state.closed=true;}
 }
 const fakeFs={...fs,async rename(from,to){await fs.rename(from,to);if(to===report)renamed.resolve();}};
 const electron={app,BrowserWindow,ipcMain,protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}}},Menu:{setApplicationMenu(){}},dialog:{showErrorBox(title,message){state.error={title,message};}}};
 vm.runInNewContext(source,{require:name=>name==='electron'?electron:name==='node:fs/promises'?fakeFs:name==='./converter.cjs'?{convertEbook(){}}:name==='./exchange.cjs'?{register(){}}:require(name),__dirname:path.dirname(mainFile),process:{argv:['InkNote.exe','--startup-report',report],pid:process.pid},URL,Response,setTimeout:()=>1,clearTimeout(){},console},{filename:mainFile});
 await loaded.promise;await tick();
 const event=url=>({sender:state.window.webContents,senderFrame:{url}});
 async function waitReport(){let timer;try{await Promise.race([renamed.promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('No startup report')),2000))]);await tick();return JSON.parse(await fs.readFile(report,'utf8'));}finally{clearTimeout(timer);}}
 return {root,profile,report,ipcMain,state,event,waitReport};
}

test('安装启动检查等待可信页面就绪，并继续使用已有笔记目录',async t=>{
 const f=await fixture(t);
 f.ipcMain.emit('inknote:renderer-ready',f.event('https://example.invalid/'));await tick();
 await assert.rejects(fs.access(f.report));
 f.ipcMain.emit('inknote:renderer-ready',f.event('inknote://app/index.html'));
 const report=await f.waitReport();
 assert.equal(report.ok,true);assert.equal(report.rendererReady,true);assert.equal(report.profile,f.profile);
 assert.equal(f.state.profileChanges,0);assert.equal(f.state.closed,false);assert.equal(f.state.shown,true);
 assert.equal(await fs.readFile(path.join(f.profile,'notes-marker'),'utf8'),'existing notes');
 assert.equal((await fs.readdir(f.root)).filter(name=>name.endsWith('.tmp')).length,0);
});
test('页面初始化失败向安装器报告错误并保留诊断信息和笔记',async t=>{
 const f=await fixture(t);
 f.ipcMain.emit('inknote:startup-error',f.event('inknote://app/index.html'),'测试：本机存储初始化失败');
 const report=await f.waitReport();
 assert.equal(report.ok,false);assert.match(report.error,/本机存储初始化失败/);
 assert.equal(f.state.quit,true);assert.match(f.state.error.message,/诊断文件/);
 assert.match(await fs.readFile(path.join(f.profile,'logs/startup.log'),'utf8'),/本机存储初始化失败/);
 assert.equal(await fs.readFile(path.join(f.profile,'notes-marker'),'utf8'),'existing notes');
});
