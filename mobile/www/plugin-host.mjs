// Plugin host. The app itself is a carrier: library, storage, the page editor (pens, PDF, text, export) and the
// post view are shared services; what you can create and open comes from plugins. A plugin is a folder holding
// plugin.json and an ES module whose activate(host) registers tiles, categories, document types, canvas types and
// importers through the `host` object built by createApi() below (API version 1, documented in 插件开发指南.md).
// Plugins never import the app's own modules: everything they may use is on `host`, so the app can change inside
// without breaking them.
export const API_VERSION = 1;
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

const reg = { plugins: new Map(), tiles: [], categories: [], menu: [], docTypes: [], canvasTypes: [], importers: [] };
const listeners = new Set();
export function onPluginsChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

// ---------- manifest ----------
export function checkManifest(m, { expectId } = {}) {
  if (!m || typeof m !== 'object') throw new Error('plugin.json 无效。');
  if (typeof m.id !== 'string' || !ID.test(m.id)) throw new Error('插件 id 只能用小写字母、数字和连字符（2–41 个字符）。');
  if (expectId && m.id !== expectId) throw new Error(`插件文件夹名「${expectId}」和 plugin.json 里的 id「${m.id}」不一致。`);
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) throw new Error('插件缺少名称（name）。');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(m.version)) throw new Error('插件版本号（version）应类似 1.0.0。');
  if (m.apiVersion !== API_VERSION) throw new Error(`这个插件需要接口版本 ${m.apiVersion}，当前墨页提供的是 ${API_VERSION}。`);
  if (m.main !== undefined && (typeof m.main !== 'string' || !/^[\w./-]+\.m?js$/.test(m.main) || m.main.includes('..'))) throw new Error('main 应是插件文件夹里的 .mjs 文件。');
  const documents = Array.isArray(m.documents) ? m.documents.filter(d => d && typeof d.kind === 'string').map(d => ({ kind: d.kind, ...(typeof d.canvasType === 'string' ? { canvasType: d.canvasType } : {}) })) : [];
  return {
    id: m.id, name: m.name.trim(), version: m.version, apiVersion: m.apiVersion, main: m.main || 'index.mjs',
    description: typeof m.description === 'string' ? m.description.slice(0, 300) : '',
    author: typeof m.author === 'string' ? m.author.slice(0, 80) : '',
    icon: typeof m.icon === 'string' ? m.icon.slice(0, 80) : 'plugin',
    documents, fileTypes: Array.isArray(m.fileTypes) ? m.fileTypes.filter(x => typeof x === 'string').slice(0, 60) : [],
    minAppVersion: typeof m.minAppVersion === 'string' ? m.minAppVersion : '',
  };
}
function versionLess(a, b) { const pa = a.split(/[.+-]/).map(Number), pb = b.split(/[.+-]/).map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); } return false; }

// ---------- discovery and lifecycle ----------
// sources: [{base, source:'builtin'|'user', stamp?}] where base is the folder URL ending in '/'.
export async function discover(sources, state, appVersion) {
  for (const src of sources) {
    let manifest, error = null;
    try {
      const res = await fetch(src.base + 'plugin.json' + (src.stamp ? '?v=' + src.stamp : ''), { cache: 'no-store' });
      if (!res.ok) throw new Error('找不到 plugin.json');
      manifest = checkManifest(await res.json(), { expectId: src.id });
      if (manifest.minAppVersion && versionLess(appVersion, manifest.minAppVersion)) throw new Error(`需要墨页 ${manifest.minAppVersion} 或更新版本。`);
    } catch (e) { error = e.message || String(e); manifest = manifest || { id: src.id, name: src.id, version: '?', documents: [], icon: 'plugin', description: '' }; }
    const prev = reg.plugins.get(manifest.id);
    if (prev && prev.source === 'user' && src.source === 'builtin') { prev.builtinBase = src.base; continue; }  // a user install overrides the built-in copy
    const st = state[manifest.id] || {};
    reg.plugins.set(manifest.id, { ...src, manifest, error, enabled: !error && st.enabled !== false && !st.removed, removed: !!st.removed, active: false, module: null, builtinBase: prev?.builtinBase || (src.source === 'builtin' ? src.base : null) });
  }
}
export function plugins() { return [...reg.plugins.values()]; }
export function plugin(id) { return reg.plugins.get(id); }
export async function activate(id, makeApi) {
  const p = reg.plugins.get(id); if (!p || p.active || p.error || !p.enabled) return p;
  try {
    p.module = await import(p.base + p.manifest.main + (p.stamp ? '?v=' + p.stamp : ''));
    if (typeof p.module.activate !== 'function') throw new Error('插件没有导出 activate(host) 函数。');
    p.active = true; await p.module.activate(makeApi(p));
  } catch (e) { console.error('Plugin', id, e); unregister(id); p.active = false; p.error = '启动失败：' + (e.message || e); }
  changed(); return p;
}
export async function activateAll(makeApi) { for (const p of plugins()) if (p.enabled && !p.error) await activate(p.manifest.id, makeApi); }
export async function deactivate(id) {
  const p = reg.plugins.get(id); if (!p) return;
  if (p.active) { try { await p.module?.deactivate?.(); } catch (e) { console.error(e); } }
  p.active = false; unregister(id); changed();
}
export function forget(id) { reg.plugins.delete(id); unregister(id); changed(); }
function unregister(id) { for (const k of ['tiles', 'categories', 'menu', 'docTypes', 'canvasTypes', 'importers']) reg[k] = reg[k].filter(x => x.pluginId !== id); }

// ---------- what the library and editor read ----------
const byOrder = (a, b) => (a.order ?? 100) - (b.order ?? 100);
export const tiles = () => reg.tiles.slice().sort(byOrder);
export const categories = () => reg.categories.slice().sort(byOrder);
export const menuItems = () => reg.menu.slice().sort(byOrder);
export const canvasTypes = () => reg.canvasTypes.slice().sort(byOrder);
export const canvasType = id => reg.canvasTypes.find(c => c.id === id);
export const importers = () => reg.importers.slice();
export function importerFor(name) { const ext = String(name).split('.').pop().toLowerCase(); return reg.importers.find(i => i.extensions.includes(ext)); }
export function docTypeOf(doc) { return reg.docTypes.find(t => { try { return t.match(doc); } catch { return false; } }); }
// Which installed plugin owns a note, even when that plugin is switched off (from plugin.json "documents").
export function ownerOf(doc) {
  for (const p of reg.plugins.values()) for (const d of p.manifest.documents || []) {
    if (d.kind !== doc.kind) continue;
    if (d.canvasType === undefined || d.canvasType === (doc.canvasType || 'plain')) return p;
  }
  return null;
}
// Page extension of the note's canvas type (e.g. the template × layer matrix), or null.
export function pageExtension(doc) { if (doc?.kind !== 'notebook') return null; return canvasType(doc.canvasType || 'plain')?.page || null; }

// ---------- the object every plugin receives ----------
function str(v, max, name) { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 必须是非空文字。`); return v.slice(0, max); }
function fn(v, name, optional = false) { if (v === undefined && optional) return undefined; if (typeof v !== 'function') throw new Error(`${name} 必须是函数。`); return v; }
export function createApi(p, services) {
  const pluginId = p.manifest.id, base = p.base;
  const iconHtml = (name, cls = '') => typeof name === 'string' && /\.svg$/i.test(name) ? `<span class="icon icon-svg ${cls}" aria-hidden="true" style="--icon-url:url('${new URL(name, base).href}')"></span>` : services.icon(name || 'plugin', cls);
  const own = spec => ({ ...spec, pluginId });
  return Object.freeze({
    apiVersion: API_VERSION,
    appVersion: services.appVersion,
    plugin: Object.freeze({ id: pluginId, version: p.manifest.version, name: p.manifest.name, baseUrl: base, url: path => new URL(path, base).href }),
    library: Object.freeze({
      addTile(spec) { reg.tiles.push(own({ id: str(spec.id, 40, 'id'), title: str(spec.title, 20, 'title'), subtitle: String(spec.subtitle || '').slice(0, 30), icon: spec.icon || p.manifest.icon, className: typeof spec.className === 'string' ? spec.className.replace(/[^\w -]/g, '') : '', tone: spec.tone || 'neutral', order: +spec.order || 100, run: fn(spec.run, 'run') })); changed(); },
      addCategory(spec) { reg.categories.push(own({ id: str(spec.id, 40, 'id'), title: str(spec.title, 20, 'title'), icon: spec.icon || p.manifest.icon, order: +spec.order || 100, match: fn(spec.match, 'match'), newCard: spec.newCard ? { title: str(spec.newCard.title, 30, 'newCard.title'), subtitle: String(spec.newCard.subtitle || '').slice(0, 40), icon: spec.newCard.icon || 'plus', run: fn(spec.newCard.run, 'newCard.run') } : null })); changed(); },
      addNewMenuItem(spec) { reg.menu.push(own({ id: str(spec.id, 40, 'id'), title: str(spec.title, 20, 'title'), subtitle: String(spec.subtitle || '').slice(0, 60), icon: spec.icon || p.manifest.icon, tone: spec.tone || 'neutral', order: +spec.order || 100, run: fn(spec.run, 'run') })); changed(); },
      refresh: () => services.refreshLibrary(),
    }),
    docTypes: Object.freeze({
      register(spec) { reg.docTypes.push(own({ id: str(spec.id, 40, 'id'), label: str(spec.label, 20, 'label'), icon: spec.icon || p.manifest.icon, iconClass: typeof spec.iconClass === 'string' ? spec.iconClass.replace(/[^\w-]/g, '') : 'plugin', match: fn(spec.match, 'match'), preview: fn(spec.preview, 'preview', true), amount: fn(spec.amount, 'amount', true), searchText: fn(spec.searchText, 'searchText', true) })); changed(); },
    }),
    notebook: Object.freeze({
      registerCanvasType(spec) {
        const page = spec.page ? Object.freeze({ key: str(spec.page.key, 40, 'page.key'), init: fn(spec.page.init, 'page.init'), validate: fn(spec.page.validate, 'page.validate'), displayAnnotations: fn(spec.page.displayAnnotations, 'page.displayAnnotations', true), underlay: fn(spec.page.underlay, 'page.underlay', true), decorate: fn(spec.page.decorate, 'page.decorate', true), searchText: fn(spec.page.searchText, 'page.searchText', true), mount: fn(spec.page.mount, 'page.mount', true), pageShown: fn(spec.page.pageShown, 'page.pageShown', true), changed: fn(spec.page.changed, 'page.changed', true), unmount: fn(spec.page.unmount, 'page.unmount', true) }) : null;
        reg.canvasTypes.push(own({ id: str(spec.id, 40, 'id'), title: str(spec.title, 20, 'title'), subtitle: String(spec.subtitle || '').slice(0, 60), icon: spec.icon || p.manifest.icon, order: +spec.order || 100, paperModes: Array.isArray(spec.paperModes) && spec.paperModes.length ? spec.paperModes.filter(m => m === 'infinite' || m === 'paged') : ['infinite', 'paged'], defaultTemplate: ['blank', 'ruled', 'grid', 'dot'].includes(spec.defaultTemplate) ? spec.defaultTemplate : 'dot', initPage: fn(spec.initPage, 'initPage', true), addPageHint: typeof spec.addPageHint === 'string' ? spec.addPageHint : '', createdToast: typeof spec.createdToast === 'string' ? spec.createdToast : '', page }));
        changed();
      },
      create: options => services.createNotebook(options),
      newDialog: options => services.newNotebookDialog(options || {}),
    }),
    importers: Object.freeze({
      register(spec) { const exts = (spec.extensions || []).map(e => String(e).toLowerCase().replace(/^\./, '')).filter(e => /^[a-z0-9]{1,8}$/.test(e)); if (!exts.length) throw new Error('importers.register 需要 extensions。'); reg.importers.push(own({ id: str(spec.id, 40, 'id'), label: String(spec.label || '').slice(0, 60), extensions: exts, import: fn(spec.import, 'import') })); changed(); },
      pick: () => services.pickFiles(),
    }),
    docs: Object.freeze({
      all: () => services.docs.all(), get: id => services.docs.get(id), uid: () => services.uid(),
      create: doc => services.docs.create(doc), save: (doc, opts) => services.docs.save(doc, opts), open: id => services.docs.open(id),
    }),
    services: Object.freeze({
      importPdf: file => services.importPdf(file), importEbook: file => services.importEbook(file), newPost: () => services.newPost(),
    }),
    ink: Object.freeze({ ...services.ink }),
    editor: Object.freeze({ ...services.editor }),
    ui: Object.freeze({
      icon: iconHtml, escape: s => services.escape(s), toast: (m, e = false) => services.toast(m, e), dialog: (t, html, opts) => services.dialog(t, html, opts), close: () => services.closeModal(),
      ask: (t, l, v, o) => services.ask(t, l, v, o), actions: (ok, danger) => services.actions(ok, danger), run: f => services.run(f),
      menu: (title, items, opts) => services.menu(title, items, opts),
      addStyle(href) { const url = new URL(href, base).href; if (document.querySelector(`link[data-plugin-style="${pluginId}"][href="${url}"]`)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; l.dataset.pluginStyle = pluginId; document.head.append(l); },
    }),
  });
}
export function removeStyles(id) { document.querySelectorAll(`link[data-plugin-style="${id}"]`).forEach(l => l.remove()); }
