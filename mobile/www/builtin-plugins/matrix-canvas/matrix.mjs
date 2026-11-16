// 二维模板画布的数据模型（纯函数，不碰页面 DOM，可以单独测试）。
//
// 每一页 A4 上存一个矩阵：page.ext.matrix =
//   { v: 1, active: <当前模板 id>, live: <正在书写的图层 id>,
//     templates: [ { id, title, active: <该模板选中的图层 id>,
//                    layers: [ { id, title, locked, strokes: [批注…] } ] } ] }
//
// 横向是平行的模板（广度），纵向是一个模板内部的图层（深度）。
// 画面 = 当前模板里所有锁定层 + 当前选中的那一层。
// 关键约定：“正在书写的图层”（当前模板的选中层）的笔迹放在 page.annotations 里，它自己的 strokes 为空。
// 墨页编辑器的所有工具（笔、荧光笔、橡皮擦、套索、文字、撤销）都只作用于 page.annotations，
// 因此天然只会改动这一层，锁定层永远不会被误擦。切换图层或模板时，只是把数组换进换出。
export const KEY = 'matrix';
const nid = () => globalThis.crypto.randomUUID();

export const get = page => page?.ext?.[KEY] || null;
export const tpl = (m, id = m.active) => m.templates.find(t => t.id === id) || null;
export const layerOf = (t, id = t.active) => t.layers.find(l => l.id === id) || null;
function findLayer(m, id) { for (const t of m.templates) for (const l of t.layers) if (l.id === id) return l; return null; }
function nextName(list, prefix) { const names = new Set(list.map(x => x.title)); let n = list.length + 1; while (names.has(`${prefix} ${n}`)) n++; return `${prefix} ${n}`; }

export function newLayer(title, locked = false, strokes = []) { return { id: nid(), title, locked, strokes }; }
export function newTemplate(title, layers = [newLayer('图层 1')]) { return { id: nid(), title, active: layers[layers.length - 1].id, layers }; }

export function init(page) {
  const t = newTemplate('模板 1');
  page.annotations = page.annotations || [];
  page.ext = { ...(page.ext || {}), [KEY]: { v: 1, active: t.id, live: t.active, templates: [t] } };
  return get(page);
}

// The strokes of a layer wherever they currently are (the live layer's are in page.annotations).
export const strokesOf = (page, l) => (get(page).live === l.id ? page.annotations : l.strokes);

// Put page.annotations back where it belongs and make the active layer of the active template live.
// Called after loading, undo/redo and any switch; fixes inconsistent data instead of failing.
export function bind(page) {
  const m = get(page); if (!m) return null;
  if (!tpl(m)) m.active = m.templates[0].id;
  const t = tpl(m); if (!layerOf(t)) t.active = t.layers[0].id;
  if (m.live === t.active) return m;
  const old = m.live && findLayer(m, m.live), want = layerOf(t);
  if (old) { old.strokes = page.annotations; page.annotations = want.strokes; want.strokes = []; }
  else { page.annotations = [...want.strokes, ...(page.annotations || [])]; want.strokes = []; }
  m.live = want.id; return m;
}
function park(page) { const m = get(page), l = m.live && findLayer(m, m.live); if (l) { l.strokes = page.annotations; page.annotations = []; } m.live = null; }
function wake(page) { const m = get(page), l = layerOf(tpl(m)); page.annotations = l.strokes; l.strokes = []; m.live = l.id; }

export function selectLayer(page, id) {
  const m = get(page), t = tpl(m); if (t.active === id || !layerOf(t, id)) return false;
  park(page); t.active = id; wake(page); return true;
}
export function selectTemplate(page, id) {
  const m = get(page); if (m.active === id || !tpl(m, id)) return false;
  park(page); m.active = id; wake(page); return true;
}

// [+ 新建图层]：在当前模板里加一个空白草稿层并选中它（上一个未锁定的草稿层随之隐藏）。
export function addLayer(page, title) {
  const m = get(page), t = tpl(m), l = newLayer(title || nextName(t.layers, '图层'));
  park(page); t.layers.push(l); t.active = l.id; wake(page); return l;
}
export function toggleLock(page, id) { const l = layerOf(tpl(get(page)), id); if (!l) return null; l.locked = !l.locked; return l.locked; }
export function renameLayer(page, id, title) { const l = layerOf(tpl(get(page)), id); if (l) l.title = String(title).slice(0, 40); return !!l; }
export function removeLayer(page, id) {
  const m = get(page), t = tpl(m), i = t.layers.findIndex(l => l.id === id);
  if (i < 0 || t.layers.length < 2) return false;
  if (id === t.active) { park(page); t.layers.splice(i, 1); t.active = t.layers[Math.max(0, i - 1)].id; wake(page); }
  else t.layers.splice(i, 1);
  return true;
}
export function moveLayer(page, id, delta) {
  const t = tpl(get(page)), i = t.layers.findIndex(l => l.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= t.layers.length) return false;
  [t.layers[i], t.layers[j]] = [t.layers[j], t.layers[i]]; return true;
}
// [↓ 合并至锁定层]：把当前草稿层的笔迹并入它上方最近的锁定层（没有就并入最顶部的锁定层），
// 草稿层随之移除，选中那个锁定层。整个模板还没有锁定层时，直接把当前层锁定为骨架。
export function mergeDown(page) {
  const m = get(page), t = tpl(m), i = t.layers.findIndex(l => l.id === t.active), cur = t.layers[i];
  if (cur.locked) return { result: 'is-locked' };
  let target = null;
  for (let j = i - 1; j >= 0 && !target; j--) if (t.layers[j].locked) target = t.layers[j];
  if (!target) target = [...t.layers].reverse().find(l => l.locked && l !== cur) || null;
  if (!target) { cur.locked = true; return { result: 'locked', layer: cur }; }
  park(page);
  const count = cur.strokes.length;
  target.strokes = [...target.strokes, ...cur.strokes];
  t.layers.splice(t.layers.indexOf(cur), 1); t.active = target.id; wake(page);
  return { result: 'merged', layer: target, count };
}

// [+ 新建空白模板]：带一个空白图层的新模板，放在最后并切换过去。
export function addTemplate(page, title) {
  const m = get(page); park(page);
  const t = newTemplate(title || nextName(m.templates, '模板'));
  m.templates.push(t); m.active = t.id; wake(page); return t;
}
// [⎘ 克隆分叉当前模板]：深拷贝当前模板的全部锁定层，加一个空白的“变体”草稿层，插在当前模板右边并切换过去。
export function fork(page) {
  const m = get(page); park(page);
  const src = tpl(m), locked = src.layers.filter(l => l.locked).map(l => ({ id: nid(), title: l.title, locked: true, strokes: structuredClone(l.strokes).map(a => ({ ...a, id: nid() })) }));
  const draft = newLayer(locked.length ? '变体' : '图层 1');
  const t = { id: nid(), title: (src.title || '模板') + '′', active: draft.id, layers: [...locked, draft] };
  m.templates.splice(m.templates.indexOf(src) + 1, 0, t); m.active = t.id; wake(page);
  return { template: t, copied: locked.length };
}
export function renameTemplate(page, id, title) { const t = tpl(get(page), id); if (t) t.title = String(title).slice(0, 40); return !!t; }
export function removeTemplate(page, id) {
  const m = get(page), i = m.templates.findIndex(t => t.id === id);
  if (i < 0 || m.templates.length < 2) return false;
  if (id === m.active) { park(page); m.templates.splice(i, 1); m.active = m.templates[Math.max(0, i - 1)].id; wake(page); }
  else m.templates.splice(i, 1);
  return true;
}
export function moveTemplate(page, id, delta) {
  const m = get(page), i = m.templates.findIndex(t => t.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= m.templates.length) return false;
  [m.templates[i], m.templates[j]] = [m.templates[j], m.templates[i]]; return true;
}

// 一个模板显示出来的内容：锁定层 + 选中层，按图层顺序从下到上。
export function visible(page, t = tpl(get(page))) { return t.layers.filter(l => l.locked || l.id === t.active).flatMap(l => strokesOf(page, l)); }
// 编辑器里画在“正在书写的图层”下面的部分：当前模板的其它锁定层。
export function lockedBase(page) { const m = get(page), t = tpl(m); return t.layers.filter(l => l.locked && l.id !== m.live).map(l => l.strokes); }
export function searchText(page) {
  const m = get(page); if (!m) return [];
  const out = [];
  for (const t of m.templates) { out.push(t.title); for (const l of t.layers) for (const a of strokesOf(page, l)) { if (a.type === 'text') out.push(a.text); else if (a.type === 'rich') out.push(a.plain || ''); } }
  return out;
}

// 导入备份时检查矩阵数据；每条笔迹交给墨页的批注检查函数（util.annotation）处理。
export function validate(raw, util) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.templates) || !raw.templates.length || raw.templates.length > 300) throw new Error('模板数据无效。');
  const idOk = v => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  const text = (v, d) => (typeof v === 'string' && v.trim() ? v.slice(0, 40) : d);
  const seen = new Set(), fresh = v => { const id = idOk(v) && !seen.has(v) ? v : nid(); seen.add(id); return id; };
  const map = new Map();
  const templates = raw.templates.map((t, ti) => {
    if (!t || typeof t !== 'object' || !Array.isArray(t.layers) || !t.layers.length || t.layers.length > 300) throw new Error('图层数据无效。');
    const layers = t.layers.map((l, li) => {
      if (!l || typeof l !== 'object' || !Array.isArray(l.strokes) || l.strokes.length > 50000) throw new Error('图层数据无效。');
      const id = fresh(l.id); map.set(l.id, id);
      return { id, title: text(l.title, `图层 ${li + 1}`), locked: l.locked === true, strokes: l.strokes.map(a => util.annotation(a)) };
    });
    const id = fresh(t.id); map.set(t.id, id);
    const active = map.get(t.active); return { id, title: text(t.title, `模板 ${ti + 1}`), active: layers.some(l => l.id === active) ? active : layers[0].id, layers };
  });
  const active = map.get(raw.active), m = { v: 1, active: templates.some(t => t.id === active) ? active : templates[0].id, live: null, templates };
  const live = map.get(raw.live), current = templates.find(t => t.id === m.active);
  // Imported data keeps the live layer's strokes in page.annotations only when it points at the current active layer.
  m.live = live && live === current.active ? live : null;
  return m;
}
