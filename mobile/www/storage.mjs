let dbPromise;
function db(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('inknote-local',1);r.onupgradeneeded=()=>{r.result.createObjectStore('documents',{keyPath:'id'});r.result.createObjectStore('binaries');r.result.createObjectStore('settings');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function transaction(store,mode,fn){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(store,mode);const r=fn(t.objectStore(store));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('保存已中断'));});}
export const store={
 all:()=>transaction('documents','readonly',s=>s.getAll()),
 get:id=>transaction('documents','readonly',s=>s.get(id)),
 save:doc=>transaction('documents','readwrite',s=>s.put(structuredClone(doc))),
 remove:async id=>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(['documents','binaries'],'readwrite');t.objectStore('documents').delete(id);t.objectStore('binaries').delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});},
 binary:id=>transaction('binaries','readonly',s=>s.get(id)),
 putBinary:(id,bytes)=>transaction('binaries','readwrite',s=>s.put(bytes,id)),
 setting:key=>transaction('settings','readonly',s=>s.get(key)),
 setSetting:(key,value)=>transaction('settings','readwrite',s=>s.put(value,key))
};
