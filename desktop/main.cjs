const {app,BrowserWindow,protocol,ipcMain,dialog,session,Menu}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {convertEbook}=require('./converter.cjs');
const ROOT=path.resolve(__dirname,'../app');
const smokeIndex=process.argv.indexOf('--smoke-test-output');
const smokeOutput=smokeIndex>=0&&process.argv[smokeIndex+1]?path.resolve(process.argv[smokeIndex+1]):null;
const startupIndex=process.argv.indexOf('--startup-report');
const startupReport=startupIndex>=0&&process.argv[startupIndex+1]?path.resolve(process.argv[startupIndex+1]):null;
const reportOutput=smokeOutput||startupReport;
if(smokeOutput){const profile=path.join(path.dirname(smokeOutput),'smoke-profile');require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
let failureReported=false,startupTimer,loaded=false,smokeReported=false;
async function writeStartupReport(value){
 if(!reportOutput)return;const temporary=reportOutput+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temporary,JSON.stringify(value),{flag:'wx'});await fs.rename(temporary,reportOutput);}
 catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
}
async function reportFailure(error){
 if(failureReported)return;failureReported=true;allowClose=true;clearTimeout(startupTimer);
 const message=error?.stack||String(error),log=path.join(app.getPath('userData'),'logs','startup.log');
 try{await fs.mkdir(path.dirname(log),{recursive:true});await fs.appendFile(log,new Date().toISOString()+' '+message+'\n');}catch{}
 if(reportOutput){try{await writeStartupReport({ok:false,error:message});}catch{}}
 if(smokeOutput){app.exit(1);return;}
 dialog.showErrorBox('墨页启动失败','启动未完成，笔记数据会保留。\n\n'+(error?.message||String(error))+'\n\n诊断文件：'+log);app.quit();
}
async function completeSmoke(){
 if(!reportOutput||!loaded||!rendererReady||smokeReported||failureReported)return;smokeReported=true;
 try{await writeStartupReport({ok:true,version:app.getVersion(),rendererReady:true,packaged:app.isPackaged,profile:app.getPath('userData')});if(smokeOutput)win.close();}catch(e){await reportFailure(e);}
}

protocol.registerSchemesAsPrivileged([{scheme:'inknote',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setAppUserModelId('com.inknote.desktop');
let win,allowClose=false,closePending=false,rendererReady=false;
function trusted(event){try{const u=new URL(event.senderFrame.url);return event.sender===win?.webContents&&u.protocol==='inknote:'&&u.hostname==='app';}catch{return false;}}
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.json':'application/json','.ttf':'font/ttf'};
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(async()=>{
  startupTimer=setTimeout(()=>void reportFailure(new Error('启动等待超过 30 秒，请查看诊断文件。')),30000);
  protocol.handle('inknote',async request=>{
   try{const u=new URL(request.url);if(u.hostname!=='app'||request.method!=='GET')return new Response('Forbidden',{status:403});
    const file=path.resolve(ROOT,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(ROOT+path.sep))return new Response('Forbidden',{status:403});
    return new Response(await fs.readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'}});
   }catch{return new Response('Not found',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  Menu.setApplicationMenu(null);
  win=new BrowserWindow({width:1440,height:940,minWidth:820,minHeight:610,icon:path.join(ROOT,'icon.png'),title:'墨页 InkNote',backgroundColor:'#f2ecf5',frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('inknote://app/'))e.preventDefault();});
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('render-process-gone',(_event,details)=>void reportFailure(new Error('页面进程退出：'+details.reason)));
  win.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)void reportFailure(new Error('页面加载失败：'+code+' '+description));});
  win.on('close',e=>{if(!allowClose&&rendererReady){e.preventDefault();if(!closePending){closePending=true;win.webContents.send('inknote:before-close');}}});
  ipcMain.on('inknote:renderer-ready',event=>{if(!trusted(event))return;rendererReady=true;clearTimeout(startupTimer);void completeSmoke();});
  ipcMain.on('inknote:startup-error',(event,message)=>{if(trusted(event)&&!rendererReady)void reportFailure(new Error(String(message).slice(0,2000)));});
  ipcMain.on('inknote:close-ready',(event,ok)=>{if(!trusted(event))return;closePending=false;if(ok===true){allowClose=true;win.close();}});
  ipcMain.on('inknote:window',(event,action)=>{if(!trusted(event))return;if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
  const converterConfig=path.join(app.getPath('userData'),'converter.json');let converterPath,converting=false;
  try{converterPath=JSON.parse(await fs.readFile(converterConfig,'utf8')).executable;}catch{}
  ipcMain.handle('inknote:choose-converter',async event=>{
   if(!trusted(event))return {error:'操作来源无效'};const result=await dialog.showOpenDialog(win,{title:'选择 Calibre 的 ebook-convert.exe',properties:['openFile'],filters:[{name:'Calibre 转换组件',extensions:['exe']}]});if(result.canceled)return {selected:false};
   const file=result.filePaths[0];if(path.basename(file).toLowerCase()!=='ebook-convert.exe')return {error:'请选择 Calibre 安装目录中的 ebook-convert.exe'};
   try{await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(converterConfig,JSON.stringify({executable:file}));converterPath=file;return {selected:true};}catch(e){return {error:'组件设置保存失败：'+e.message};}
  });
  ipcMain.handle('inknote:convert-ebook',async(event,payload)=>{
   if(!trusted(event))return {ok:false,error:'操作来源无效'};if(converting)return {ok:false,error:'另一本电子书正在转换，请稍候'};converting=true;
   try{return {ok:true,bytes:await convertEbook(payload,converterPath)};}catch(e){return {ok:false,error:e.message};}finally{converting=false;}
  });
  ipcMain.handle('inknote:save-file',async(event,payload)=>{
   if(!trusted(event))return {error:'操作来源无效。'};
   if(!payload||typeof payload.name!=='string'||!ArrayBuffer.isView(payload.bytes)||payload.bytes.byteLength>400*1024*1024)return {error:'导出数据无效或文件过大。'};
   const ext=path.extname(payload.name).toLowerCase();if(!['.pdf','.inknote'].includes(ext))return {error:'不支持此文件类型。'};
   const name=path.basename(payload.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
   const result=await dialog.showSaveDialog(win,{defaultPath:name,filters:[{name:ext==='.pdf'?'PDF 文档':'InkNote 可编辑备份',extensions:[ext.slice(1)]}]} );
   if(result.canceled)return {saved:false};let temporary;
   try{temporary=path.join(path.dirname(result.filePath),'.inknote-'+randomUUID()+'.tmp');await fs.writeFile(temporary,Buffer.from(payload.bytes.buffer,payload.bytes.byteOffset,payload.bytes.byteLength),{flag:'wx'});await fs.rename(temporary,result.filePath);return {saved:true};}
   catch(e){if(temporary)await fs.unlink(temporary).catch(()=>{});return {error:'导出失败：'+e.message};}
  });
  await win.loadURL('inknote://app/index.html');loaded=true;await completeSmoke();if(!smokeOutput)win.show();
 }).catch(reportFailure);
 app.on('window-all-closed',()=>app.quit());
}
