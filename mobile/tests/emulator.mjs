// Checks 墨页 on a real Android system (the emulator in the GitHub Actions build), through the WebView's DevTools
// socket. Needs the debug build (only debug builds let DevTools in) and `npm i playwright`.
// Usage: node tests/emulator.mjs <package> <output folder>
import { _android as android } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = process.argv[2] || 'com.inknote.app.debug';
const OUT = path.resolve(process.argv[3] || 'emulator-results');
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
let fails = 0;
const ok = (c, m) => { const l = (c ? '✓ ' : '✗ ') + m; console.log(l); lines.push(l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const [device] = await android.devices();
if (!device) throw new Error('no Android device');
console.log('device:', device.model(), device.serial());
const shot = async name => { await sleep(600); await device.screenshot({ path: path.join(OUT, name + '.png') }); };

await device.shell(`am force-stop ${PKG}`);
await device.shell(`pm clear ${PKG}`);
await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
const webview = await device.webView({ pkg: PKG }, { timeout: 90000 });
const page = await webview.page();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.waitForSelector('.library', { timeout: 90000 });
await sleep(1500);

const env = await page.evaluate(() => ({
  ua: navigator.userAgent, native: document.documentElement.classList.contains('native'),
  platform: window.Capacitor?.getPlatform?.(), width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  insetTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
  padTop: getComputedStyle(document.body).paddingTop,
}));
console.log(JSON.stringify(env));
lines.push('WebView: ' + (env.ua.match(/Chrome\/[\d.]+/) || ['?'])[0] + ` · ${env.width}×${env.height} @${env.dpr} · inset ${env.insetTop || 'none'}`);
ok(env.native && env.platform === 'android', 'runs as the Android app (Capacitor, native styles)');
await shot('01-library');

// ---- touch helpers through the DevTools protocol (several fingers at once)
const cdp = await page.context().newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 3, radiusY: 3, force: .5 })) });
async function drag(a, b, steps = 12) { await touch('touchStart', [[a.x, a.y, 1]]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1]]); await sleep(16); } await touch('touchEnd', []); }
async function pinch(m, from, to, steps = 12) {
  await touch('touchStart', [[m.x - from, m.y, 1]]); await sleep(20); await touch('touchStart', [[m.x - from, m.y, 1], [m.x + from, m.y, 2]]);
  for (let i = 1; i <= steps; i++) { const d = from + (to - from) * i / steps; await touch('touchMove', [[m.x - d, m.y, 1], [m.x + d, m.y, 2]]); await sleep(16); }
  await touch('touchEnd', [[m.x + to, m.y, 2]]); await sleep(10); await touch('touchEnd', []);
}
const docs = () => page.evaluate(async () => { const r = await new Promise(res => { const q = indexedDB.open('inknote-local', 1); q.onsuccess = () => res(q.result); }); return new Promise(res => { const x = r.transaction('documents').objectStore('documents').getAll(); x.onsuccess = () => res(x.result); }); });
const zoom = async () => parseInt(await page.textContent('#zoom-value')) / 100;

// ---- open the guide, write with a finger, pinch
await page.evaluate(() => [...document.querySelectorAll('.doc-card')].find(c => /把想法/.test(c.textContent))?.click());
await page.waitForSelector('#ink-canvas', { timeout: 30000 }); await sleep(1500);
const z0 = await zoom(); ok(z0 < .9, `page fitted to the screen (${Math.round(z0 * 100)}%)`);
await shot('02-editor');
const box = await page.locator('#ink-canvas').boundingBox();
const at = (x, y) => ({ x: box.x + x * box.width / 595.28, y: box.y + y * box.height / 841.89 });
await drag(at(120, 560), at(320, 600)); await sleep(800);
ok((await docs()).find(d => /把想法/.test(d.title)).pages.some(p => p.annotations.length > 0), 'finger stroke saved');
await pinch(at(300, 450), 40, 120); await sleep(1200);
ok(await zoom() > z0 * 1.8, `pinch zoom ${Math.round(z0 * 100)}% → ${Math.round(await zoom() * 100)}%`);
await shot('03-zoomed');
await page.evaluate(() => document.querySelector('[data-action=fit]').click()); await sleep(800);

// ---- export a PDF into Documents/墨页
await page.evaluate(() => document.querySelector('[data-action=export]').click()); await sleep(400);
await page.evaluate(() => document.querySelector('[data-export=pdf]').click());
const saved = await page.waitForSelector('#saved-share', { timeout: 60000 }).then(() => true, () => false);
ok(saved, 'export finished with the 「已保存到手机」 dialog');
await shot('04-saved');
const listing = (await device.shell('ls -l /sdcard/Documents/墨页/ 2>&1')).toString();
ok(/\.pdf/.test(listing), 'PDF is in 文档/墨页: ' + listing.trim().split('\n').filter(l => /\.pdf/.test(l)).map(l => l.split(/\s+/).slice(4).join(' ')).join('; '));

// ---- back button: dialog, then the note
await device.shell('input keyevent 4'); await sleep(800);
ok(await page.locator('#modal[open]').count() === 0, 'back closes the dialog');
await device.shell('input keyevent 4'); await sleep(1200);
ok(await page.locator('.library').count() === 1, 'back returns to the library');

// ---- a plugin from the app's own files (what 「从文件安装插件」 writes), loaded through the WebView's file URLs
const ex = path.resolve(here, '..', 'www', 'plugin-sdk', 'examples', 'cornell-canvas');
const files = fs.readdirSync(ex).map(n => ({ path: n, data: fs.readFileSync(path.join(ex, n)).toString('base64') }));
await page.evaluate(async files => {
  const F = window.Capacitor.registerPlugin('Filesystem');
  for (const f of files.sort((a, b) => (a.path === 'plugin.json') - (b.path === 'plugin.json'))) await F.writeFile({ path: 'plugins/cornell-canvas/' + f.path, directory: 'DATA', data: f.data, recursive: true });
}, files);
await page.reload(); await page.waitForSelector('.library', { timeout: 60000 }); await sleep(2000);
const plugin = await page.evaluate(() => !!document.querySelector('[data-id^="cornell-canvas"]') || [...document.querySelectorAll('.nav-label,.qs-text strong')].some(x => /康奈尔/.test(x.textContent)));
ok(plugin, 'plugin installed in the app\'s files is loaded (module import from the WebView file URL)');

// ---- the release-style start: no errors
ok(!errors.length, 'no errors in the page' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
await shot('05-library-after');
fs.writeFileSync(path.join(OUT, 'results.txt'), lines.join('\n') + '\n');
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
await device.close();
process.exit(fails ? 1 : 0);
