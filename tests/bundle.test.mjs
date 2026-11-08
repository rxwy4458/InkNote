import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,writeZip,readZip,readEntry,isZip} from '../app/bundle.mjs';

test('大文件备份容器：写入后可以原样读回，校验和与文件名都正确',async()=>{
 const big=new Uint8Array(3*1024*1024+17);for(let i=0;i<big.length;i++)big[i]=(i*2654435761)>>>24;
 const blob=await writeZip([{name:'inknote.json',data:JSON.stringify({format:'inknote',version:2,title:'中文名'})},{name:'source.bin',data:big}]);
 assert.ok(await isZip(blob));
 const z=await readZip(blob);
 assert.deepEqual([...z.keys()],['inknote.json','source.bin']);
 assert.equal(JSON.parse(new TextDecoder().decode(await readEntry(z.get('inknote.json')))).title,'中文名');
 const back=await readEntry(z.get('source.bin'));assert.equal(back.length,big.length);assert.ok(back.every((v,i)=>v===big[i]));
});

test('备份容器：损坏的数据会被发现，普通 JSON 备份不会被当成容器',async()=>{
 const blob=await writeZip([{name:'source.bin',data:new Uint8Array([1,2,3,4,5,6,7,8])}]);
 const bytes=new Uint8Array(await blob.arrayBuffer());bytes[40]^=0xff;
 const z=await readZip(new Blob([bytes]));await assert.rejects(readEntry(z.get('source.bin')),/损坏/);
 assert.equal(await isZip(new Blob(['{"format":"inknote","version":1}'])),false);
 await assert.rejects(readZip(new Blob([new Uint8Array(10)])),/不完整|无效/);
});

test('CRC-32 与标准值一致，可以分段累计',()=>{
 const s=new TextEncoder().encode('123456789');assert.equal(crc32(s),0xcbf43926);
 assert.equal(crc32(s.subarray(4),crc32(s.subarray(0,4))),0xcbf43926);
});
