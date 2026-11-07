import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['vendor','node_modules','release','.git'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(cjs|mjs)$/.test(e.name))files.push(p);}}
await walk(root);
for(const f of files){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status){process.stderr.write(r.stderr);process.exit(1);}}
for(const f of ['app/vendor/pdf.min.mjs','app/vendor/pdf.worker.min.mjs','app/vendor/pdf-lib.min.js','app/vendor/jszip.min.js','app/vendor/xml-js.min.js','app/vendor/cmaps/UniGB-UCS2-H.bcmap','app/vendor/standard_fonts/FoxitSerif.pfb','app/vendor/wasm/openjpeg.wasm','app/vendor/material-color.mjs','app/fonts/material-symbols-rounded-subset.woff2','app/fonts/google-sans-flex-latin.woff2','app/index.html','app/styles.css','installer/bootstrap.c','installer/setup.ps1','installer/setup-offline.ps1','installer/runtime.json','installer/build-offline-exe.py','installer/build-online-exe.py','installer/uninstall.c','installer/uninstall-imports.def','installer/build-uninstaller.py','scripts/verify-windows-install.ps1'])await stat(path.join(root,f));
const html=await readFile(path.join(root,'app/index.html'),'utf8');
for(const [,src] of html.matchAll(/(?:src|href)="(?!https?:|#)([^"?]+)"/g))await stat(path.join(root,'app',src));
const css=await readFile(path.join(root,'app/styles.css'),'utf8');
for(const [,src] of css.matchAll(/url\((?!"?data:)"?([^")]+)"?\)/g))await stat(path.join(root,'app',src));
process.stdout.write(`Checked ${files.length} JavaScript modules and all required offline assets.\n`);
