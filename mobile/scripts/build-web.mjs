// Builds mobile/www (the web content of the Android app) from the shared app/ folder.
// The Android app runs exactly the same code as the Windows desktop app; only these things differ:
//  1. index.html gets an Android viewport (edge to edge, no page zoom: the editor handles pinch itself);
//  2. PDF.js is the "legacy" build of the same version, which also runs on older Android System WebViews;
//  3. webview-update.html is added: Capacitor shows it when the phone's WebView is too old to run 墨页.
//  4. the built-in plugins move from plugins/ to builtin-plugins/: Capacitor empties a top-level plugins/ folder on
//     every sync (it is where Cordova plugins would go), and app.mjs looks in builtin-plugins/ on Android;
//  5. Capacitor's core script (vendor/capacitor.js) is loaded first: it turns the bridge the Android shell injects into
//     plugin objects (Capacitor.registerPlugin) that app/native.mjs uses.
// Usage: node scripts/build-web.mjs           build www/
//        node scripts/build-web.mjs --check   verify that www/ is an up-to-date build (used in CI)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = path.resolve(root, '..', 'app');
const www = path.join(root, 'www');
const legacy = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const PDFJS = '5.6.205';
const VIEWPORT = '<meta name="viewport" content="width=device-width,initial-scale=1">';
const VIEWPORT_ANDROID = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">';
const FIRST_SCRIPT = '<script src="vendor/pdf-lib.min.js"></script>';
const CORE_SCRIPT = '<script src="vendor/capacitor.js"></script>';
const REPLACED = {'vendor/pdf.min.mjs': 'pdf.min.mjs', 'vendor/pdf.worker.min.mjs': 'pdf.worker.min.mjs'};
// Windows-only files that the Android app never loads.
const SKIP = new Set(['icon.ico']);

const check = process.argv.includes('--check');
const fail = m => { console.error('✗ ' + m); process.exit(1); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function expected() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'));
  if (pkg.version !== PDFJS) fail(`pdfjs-dist ${pkg.version} is installed, the app uses ${PDFJS}. Run npm ci in mobile/.`);
  const files = new Map();
  for (const rel of walk(app)) {
    if (SKIP.has(rel)) continue;
    let data = fs.readFileSync(path.join(app, rel));
    if (REPLACED[rel]) data = fs.readFileSync(path.join(legacy, REPLACED[rel]));
    if (rel === 'index.html') {
      const html = data.toString('utf8');
      if (!html.includes(VIEWPORT)) fail('app/index.html: the viewport meta tag changed; update scripts/build-web.mjs.');
      if (!html.includes(FIRST_SCRIPT)) fail('app/index.html: the first script tag changed; update scripts/build-web.mjs.');
      data = Buffer.from(html.replace(VIEWPORT, VIEWPORT_ANDROID).replace(FIRST_SCRIPT, CORE_SCRIPT + '\n  ' + FIRST_SCRIPT), 'utf8');
    }
    files.set(rel.startsWith('plugins/') ? 'builtin-plugins/' + rel.slice('plugins/'.length) : rel, data);
  }
  files.set('webview-update.html', Buffer.from(fs.readFileSync(path.join(here, 'webview-update.html'), 'utf8'), 'utf8'));
  files.set('licenses-android.txt', fs.readFileSync(path.join(here, 'licenses-android.txt')));
  files.set('vendor/capacitor.js', fs.readFileSync(path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js')));
  return files;
}

const want = expected();
if (check) {
  if (!fs.existsSync(www)) fail('www/ does not exist. Run npm run build:web.');
  const have = new Set(walk(www));
  for (const [rel, data] of want) {
    if (!have.has(rel)) fail(`www/${rel} is missing. Run npm run build:web.`);
    if (sha(fs.readFileSync(path.join(www, rel))) !== sha(data)) fail(`www/${rel} is out of date. Run npm run build:web.`);
    have.delete(rel);
  }
  if (have.size) fail(`www/ has files that are not in app/: ${[...have].slice(0, 5).join(', ')}`);
  console.log(`✓ www/ is up to date (${want.size} files)`);
} else {
  fs.rmSync(www, {recursive: true, force: true});
  let bytes = 0;
  for (const [rel, data] of want) {
    const dest = path.join(www, rel);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, data);
    bytes += data.length;
  }
  console.log(`✓ built www/: ${want.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (PDF.js ${PDFJS} legacy build)`);
}
