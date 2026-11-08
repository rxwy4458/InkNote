import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../app/',import.meta.url)));
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const port=Number(arg('--port')||process.env.PORT||43877),host=arg('--host')||process.env.HOST||'127.0.0.1';
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.json':'application/json','.ttf':'font/ttf','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 const u=new URL(req.url,'http://localhost');if(u.pathname==='/__inknote_health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"product":"InkNote","version":"0.6.1"}');}
 const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 const s=await stat(file);if(!s.isFile()){res.writeHead(404);return res.end();}
 const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,host,()=>process.stdout.write(`InkNote ready at http://${host}:${port}\n`));
