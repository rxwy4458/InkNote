// Android (Capacitor) integration. The same app/ code runs in the Windows desktop app, in a browser and inside the
// Android shell (mobile/). Everything here is a no-op unless window.Capacitor reports a native platform, so the desktop
// app behaves exactly as before.
// The Android shell injects Capacitor's bridge (window.Capacitor) at the top of the page, and the Android build loads
// Capacitor's core script (vendor/capacitor.js) before 墨页's modules, so no bundler is needed.
export const NATIVE = (() => { try { return !!window.Capacitor?.isNativePlatform?.(); } catch { return false; } })();
export const PLATFORM = NATIVE ? window.Capacitor.getPlatform() : window.desktop ? 'desktop' : 'web';
// Phone and tablet styles (native.css) load before the first screen is drawn.
if (NATIVE) {
  document.documentElement.classList.add('native', 'native-' + PLATFORM);
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./native.css', import.meta.url).href;
  document.head.append(link);
}
const cache = new Map();
// Plugin objects come from Capacitor's core script (vendor/capacitor.js, added to the Android build only). Core
// already registers SystemBars itself, so that one is taken from its exports instead of being registered twice.
const plugin = name => {
  if (!cache.has(name)) {
    const C = window.Capacitor;
    cache.set(name, window.capacitorExports?.[name] || (C.registerPlugin ? C.registerPlugin(name) : C.Plugins?.[name]));
  }
  return cache.get(name);
};
const EXPORT_DIR = '墨页';
const PLUGIN_DIR = 'plugins';

function bytesToBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
// Writes a Blob in pieces (one bridge message per 3 MB, a multiple of 3 so the base64 pieces join cleanly).
async function writeBlob(path, directory, blob) {
  const fs = plugin('Filesystem'), step = 3 * 1024 * 1024;
  if (!blob.size) { await fs.writeFile({ path, directory, data: '', recursive: true }); return; }
  for (let o = 0; o < blob.size; o += step) {
    const data = bytesToBase64(new Uint8Array(await blob.slice(o, o + step).arrayBuffer()));
    if (o === 0) await fs.writeFile({ path, directory, data, recursive: true }); else await fs.appendFile({ path, directory, data });
  }
}
const safeName = s => String(s || '墨页').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+/, '').slice(0, 120) || '墨页';
async function exists(path, directory) { try { await plugin('Filesystem').stat({ path, directory }); return true; } catch { return false; } }
async function freeName(dir, directory, name) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = name; for (let i = 2; await exists(`${dir}/${n}`, directory) && i < 500; i++) n = `${stem} (${i})${ext}`; return n;
}

// Saving an export (PDF, .inknote, .zip): into 文档/墨页 where the Files app shows it, then offer to share it.
// If the shared Documents folder cannot be written (old Android without the permission, some vendor ROMs), the file
// goes to the app's cache and straight to the share sheet instead.
export async function saveFile(blob, name, { dialog, toast }) {
  name = safeName(name);
  try {
    const file = await freeName(EXPORT_DIR, 'DOCUMENTS', name), path = `${EXPORT_DIR}/${file}`;
    await writeBlob(path, 'DOCUMENTS', blob);
    const { uri } = await plugin('Filesystem').getUri({ path, directory: 'DOCUMENTS' });
    dialog?.(file, uri);
    return true;
  } catch (e) {
    console.warn('save to Documents failed, sharing instead', e);
    const path = `share/${Date.now()}/${name}`;
    await writeBlob(path, 'CACHE', blob);
    const { uri } = await plugin('Filesystem').getUri({ path, directory: 'CACHE' });
    try { await plugin('Share').share({ title: name, files: [uri], dialogTitle: '保存或发送 ' + name }); }
    catch (err) { if (!/cancel/i.test(String(err?.message || err))) throw err; }
    toast?.('可以在分享面板里选择保存位置');
    return true;
  }
}
export async function shareUri(uri, name) {
  try { await plugin('Share').share({ title: name, files: [uri], dialogTitle: '发送 ' + name }); }
  catch (err) { if (!/cancel/i.test(String(err?.message || err))) throw err; }
}

// User plugins live in the app's private files folder (files/plugins/<id>/) and are served to the page from the same
// origin through Capacitor's file URLs, so `import()` and the CSP 'self' rule work exactly as on the desktop.
// The page address of the plugins folder, e.g. https://localhost/_capacitor_file_/data/user/0/com.inknote.app/files/plugins/
export async function pluginRoot() {
  const { uri } = await plugin('Filesystem').getUri({ path: PLUGIN_DIR, directory: 'DATA' });
  const url = window.Capacitor.convertFileSrc(uri);
  return url.endsWith('/') ? url : url + '/';
}
export function pluginBridge() {
  const fs = plugin('Filesystem'), D = 'DATA';
  const listDir = async path => { try { return (await fs.readdir({ path, directory: D })).files || []; } catch { return []; } };
  const stampOf = async id => { try { const s = await fs.stat({ path: `${PLUGIN_DIR}/${id}/plugin.json`, directory: D }); return String(s.mtime || s.ctime || 0); } catch { return null; } };
  const api = {
    capabilities: { files: true, folders: false },
    async plugins(channel, payload) {
      try {
        if (channel === 'plugins:list') {
          const out = [];
          for (const e of await listDir(PLUGIN_DIR)) {
            const id = typeof e === 'string' ? e : e.name; if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id || '')) continue;
            const stamp = await stampOf(id); if (stamp) out.push({ id, stamp });
          }
          return { value: out };
        }
        if (channel === 'plugins:install') {
          const { id, files } = payload || {};
          if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id || '') || !Array.isArray(files) || !files.length) throw new Error('插件包无效。');
          for (const f of files) if (typeof f.path !== 'string' || f.path.split('/').some(x => !x || x === '..' || x.startsWith('.'))) throw new Error('插件包里的文件名无效。');
          const dir = `${PLUGIN_DIR}/${id}`;
          try { await fs.rmdir({ path: dir, directory: D, recursive: true }); } catch {}
          // plugin.json goes last: a half-copied plugin (phone switched off midway) has none and is simply not listed.
          const ordered = [...files.filter(f => f.path !== 'plugin.json'), ...files.filter(f => f.path === 'plugin.json')];
          for (const f of ordered) await fs.writeFile({ path: `${dir}/${f.path}`, directory: D, data: bytesToBase64(f.bytes), recursive: true });
          return { value: { id, stamp: await stampOf(id) } };
        }
        if (channel === 'plugins:remove') {
          const { id } = payload || {}; if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id || '')) throw new Error('插件无效。');
          await fs.rmdir({ path: `${PLUGIN_DIR}/${id}`, directory: D, recursive: true });
          return { value: true };
        }
        throw new Error('手机上不能这样安装插件，请用「从文件安装插件…」。');
      } catch (e) { return { error: e?.message || String(e) }; }
    },
  };
  return api;
}

// Hardware back button, app going to the background, status-bar icon colour.
export function init({ onBack, onPause, onResume }) {
  if (!NATIVE) return;
  // Android's file picker greys out files whose type it does not know (.inknote, .inkplugin): offer every file and
  // let 墨页 check what was picked.
  for (const input of document.querySelectorAll('input[type=file]')) if (!input.accept.startsWith('image/')) input.removeAttribute('accept');
  const app = plugin('App');
  // Back: close whatever is open (dialog, drawer, note); on the library itself, send the app to the background
  // like the home button does, so nothing is lost and the next start is instant.
  app.addListener('backButton', () => {
    Promise.resolve().then(() => onBack?.()).then(handled => {
      if (handled) return;
      return app.minimizeApp().catch(() => app.exitApp());
    }).catch(e => console.warn('back button', e));
  });
  app.addListener('pause', () => { try { onPause?.(); } catch (e) { console.warn('pause', e); } });
  app.addListener('resume', () => { try { onResume?.(); } catch (e) { console.warn('resume', e); } });
  try { navigator.storage?.persist?.()?.catch?.(() => {}); } catch {}
}
// Status bar and navigation bar icons. On current WebViews the page draws behind the bars (edge to edge) and
// Capacitor reports their size in --safe-area-inset-*: the icons then follow 墨页's own theme (DARK = light icons).
// On older WebViews Capacitor pads the page instead, the bars show the system background, and the icons follow the
// system (DEFAULT). Capacitor sets the inset variables a moment after start, so this re-checks when they arrive.
let wantDark = false, barStyle = '';
function applyBars() {
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')) || 0;
  const style = top > 0 ? (wantDark ? 'DARK' : 'LIGHT') : 'DEFAULT';
  if (style === barStyle) return;
  barStyle = style; plugin('SystemBars').setStyle({ style }).catch(() => { barStyle = ''; });
}
export function setBarsDark(dark) {
  if (!NATIVE) return;
  wantDark = !!dark; barStyle = ''; applyBars();
}
if (NATIVE) {
  let last = '';
  new MutationObserver(() => {
    const v = document.documentElement.style.getPropertyValue('--safe-area-inset-top');
    if (v !== last) { last = v; applyBars(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}
