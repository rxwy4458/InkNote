const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
 reportStartupError:message=>ipcRenderer.send('inknote:startup-error',String(message).slice(0,2000)),
 windowAction:action=>{if(['minimize','maximize','close'].includes(action))ipcRenderer.send('inknote:window',action);},
 saveFile:payload=>ipcRenderer.invoke('inknote:save-file',payload),
 saveBegin:payload=>ipcRenderer.invoke('inknote:save-begin',payload),
 saveChunk:(token,bytes)=>ipcRenderer.invoke('inknote:save-chunk',{token,bytes}),
 saveEnd:(token,ok)=>ipcRenderer.invoke('inknote:save-end',{token,ok:ok===true}),
 chooseConverter:()=>ipcRenderer.invoke('inknote:choose-converter'),
 convertEbook:payload=>ipcRenderer.invoke('inknote:convert-ebook',payload),
 onBeforeClose:callback=>{ipcRenderer.on('inknote:before-close',()=>callback());ipcRenderer.send('inknote:renderer-ready');},
 closeReady:ok=>ipcRenderer.send('inknote:close-ready',ok===true),
 plugins:(channel,payload)=>['plugins:list','plugins:install','plugins:install-folder','plugins:remove','plugins:open-folder','plugins:open-sdk'].includes(channel)?ipcRenderer.invoke(channel,payload):Promise.resolve({error:'不支持的操作'}),
 onExchangeChange:callback=>{ipcRenderer.removeAllListeners('exchange:changed');ipcRenderer.on('exchange:changed',()=>callback());},
 exchange:(channel,payload)=>['exchange:status','exchange:choose','exchange:open','exchange:list','exchange:scan','exchange:mkdir','exchange:rename','exchange:use-sub','exchange:busy','exchange:read','exchange:write-begin','exchange:write-chunk','exchange:write-end','exchange:remove'].includes(channel)?ipcRenderer.invoke(channel,payload):Promise.resolve({error:'不支持的操作'})
});
