const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
 reportStartupError:message=>ipcRenderer.send('inknote:startup-error',String(message).slice(0,2000)),
 windowAction:action=>{if(['minimize','maximize','close'].includes(action))ipcRenderer.send('inknote:window',action);},
 saveFile:payload=>ipcRenderer.invoke('inknote:save-file',payload),
 chooseConverter:()=>ipcRenderer.invoke('inknote:choose-converter'),
 convertEbook:payload=>ipcRenderer.invoke('inknote:convert-ebook',payload),
 onBeforeClose:callback=>{ipcRenderer.on('inknote:before-close',()=>callback());ipcRenderer.send('inknote:renderer-ready');},
 closeReady:ok=>ipcRenderer.send('inknote:close-ready',ok===true)
});
