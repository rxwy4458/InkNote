// 二维模板画布的界面：顶部（或底部）横向模板条 + 右侧（或左侧）纵向图层条，长按滑动快速切换，松手即停。
// 只通过 host（插件接口）和墨页的页面编辑器打交道。
import * as M from './matrix.mjs';

export function createMatrixUI(host) {
  const ed = host.editor, ui = host.ui, ink = host.ink;
  const E = s => ui.escape(s), icon = (n, c) => ui.icon(n, c);
  let root = null, page = null, thumbFrame = 0, peekTimer = 0, suppressClick = false;
  const cache = new Map();  // template id -> {tpl, arrays, w, h, canvas}: the locked layers of a template, drawn once

  // ---------- locked layers under the live one (two drawImage calls per frame while scrubbing) ----------
  function underlay(ctx, p, size) {
    const m = M.get(p); if (!m) return; M.bind(p);
    const t = M.tpl(m), arrays = M.lockedBase(p); if (!arrays.length) return;
    let c = cache.get(t.id);
    if (!c || c.tpl !== t || c.w !== size.width || c.h !== size.height || c.arrays.length !== arrays.length || c.arrays.some((a, i) => a !== arrays[i])) {
      const canvas = c?.w === size.width && c?.h === size.height ? c.canvas : document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, canvas.width, canvas.height); x.scale(size.width / p.width, size.height / p.height);
      for (const arr of arrays) for (const a of arr) ink.drawAnnotation(x, a);
      c = { tpl: t, arrays, w: size.width, h: size.height, canvas };
      cache.delete(t.id); cache.set(t.id, c);
      while (cache.size > 16) cache.delete(cache.keys().next().value);  // keep the most recent templates only
    } else { cache.delete(t.id); cache.set(t.id, c); }
    ctx.drawImage(c.canvas, 0, 0, p.width, p.height);
  }
  // Text boxes in locked layers are drawn from rasters that must be prepared first.
  async function prepareLocked(p) {
    const m = M.get(p); if (!m) return;
    const rich = m.templates.flatMap(t => t.layers.filter(l => l.locked && l.id !== m.live).flatMap(l => l.strokes.filter(a => a.type === 'rich')));
    if (!rich.length) return;
    const size = ed.inkSize(); await ink.prepareRich(rich, size ? size.width / p.width : 2);
    if (page !== p) return; cache.clear(); ed.redraw(); scheduleThumbs();
  }

  // ---------- DOM ----------
  function mount() {
    const stage = ed.stage(); if (!stage) return;
    root?.remove(); sigT = ''; sigL = '';
    root = document.createElement('div'); root.className = 'mx-root';
    root.innerHTML = `
     <div class="mx-bar mx-templates" role="toolbar" aria-label="平行模板（横向）">
      <span class="mx-axis" title="横向：平行模板。单击切换；按住后左右滑动，画面跟着切换，松手停在那个模板；双击改名；右键更多操作">${icon('templates')}</span>
      <div class="mx-track" data-axis="x" role="listbox" aria-orientation="horizontal" aria-label="模板"></div>
      <span class="mx-sep"></span>
      <button type="button" class="mx-btn" data-mx="add-template" title="新建空白模板（Alt + N）" aria-label="新建空白模板">${icon('plus')}</button>
      <button type="button" class="mx-btn" data-mx="fork" title="克隆分叉当前模板：复制全部锁定层，在右边生成一个平行模板，只改不一样的部分（Alt + K）" aria-label="克隆分叉当前模板">${icon('fork')}</button>
      <button type="button" class="mx-btn" data-mx="template-menu" title="模板操作：改名、移动、删除" aria-label="模板操作">${icon('more-v')}</button>
     </div>
     <div class="mx-bar mx-layers" role="toolbar" aria-label="当前模板的图层（纵向）">
      <span class="mx-axis" title="纵向：当前模板的图层。单击切换；按住后上下滑动快速翻看草稿，松手即停；双击锁定或解锁（锁定层常驻显示，不会被擦掉）；右键更多操作">${icon('layers')}</span>
      <div class="mx-track" data-axis="y" role="listbox" aria-orientation="vertical" aria-label="图层"></div>
      <span class="mx-sep"></span>
      <button type="button" class="mx-btn" data-mx="add-layer" title="新建图层：空白草稿层，自动选中（Alt + L）" aria-label="新建图层">${icon('plus')}</button>
      <button type="button" class="mx-btn" data-mx="merge" title="合并至锁定层：把当前草稿层的笔迹并入上方的锁定层（Alt + M）" aria-label="合并至锁定层">${icon('merge-down')}</button>
      <button type="button" class="mx-btn" data-mx="layer-menu" title="图层操作：锁定、改名、移动、删除" aria-label="图层操作">${icon('more-v')}</button>
     </div>
     <div class="mx-peek" role="status" aria-live="polite"></div>`;
    stage.append(root); stage.classList.add('mx-on');
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    root.addEventListener('contextmenu', onContext);
    root.addEventListener('keydown', onTrackKey);
    for (const track of root.querySelectorAll('.mx-track')) bindScrub(track);
    document.addEventListener('keydown', onKey, true);
  }
  function unmount() {
    document.removeEventListener('keydown', onKey, true);
    root?.closest('.stage')?.classList.remove('mx-on'); root?.remove(); root = null; page = null; cache.clear(); sigT = ''; sigL = '';
  }
  function pageShown(p) {
    page = p;
    if (!M.get(p)) { M.init(p); ed.save(false); }
    M.bind(p);
    if (!root || !root.isConnected) mount();
    render(true); prepareLocked(p);
  }
  function changed(p) { if (p !== page) return; M.bind(p); render(false); }

  const tracks = () => ({ t: root.querySelector('.mx-templates .mx-track'), l: root.querySelector('.mx-layers .mx-track') });
  // Each track is rebuilt only when its structure changes; selecting just moves the highlight (keeps double-click working).
  let sigT = '', sigL = '';
  function render(force) {
    if (!root || !page) return;
    const m = M.get(page), { t: tt } = tracks();
    const st = JSON.stringify(m.templates.map(x => [x.id, x.title]));
    let rebuilt = false;
    if (force || st !== sigT) {
      sigT = st; rebuilt = true;
      tt.innerHTML = m.templates.map((x, i) => `<button type="button" class="mx-cell mx-tpl" data-id="${x.id}" role="option" aria-label="${E(x.title)}" title="${E(x.title)}"><canvas width="64" height="90"></canvas><span class="mx-num">${i + 1}</span></button>`).join('');
    }
    if (renderLayers(force)) rebuilt = true;
    markActive();
    scheduleThumbs(rebuilt ? null : 'live');
  }
  function renderLayers(force = false) {
    const m = M.get(page), t = M.tpl(m), { l: lt } = tracks();
    const sl = JSON.stringify([t.id, t.layers.map(l => [l.id, l.title, l.locked])]);
    if (!force && sl === sigL) return false;
    sigL = sl;
    lt.innerHTML = t.layers.map(l => `<button type="button" class="mx-cell mx-layer ${l.locked ? 'locked' : ''}" data-id="${l.id}" role="option" aria-label="${E(l.title)}${l.locked ? '（已锁定）' : ''}" title="${E(l.title)}${l.locked ? ' · 已锁定，常驻显示' : ' · 草稿'}"><canvas width="60" height="84"></canvas>${l.locked ? `<span class="mx-lock">${icon('lock')}</span>` : ''}</button>`).join('');
    return true;
  }
  function markActive() {
    const m = M.get(page), t = M.tpl(m), { t: tt, l: lt } = tracks();
    for (const c of tt.children) { const on = c.dataset.id === m.active; c.classList.toggle('active', on); c.setAttribute('aria-selected', on); c.tabIndex = on ? 0 : -1; }
    for (const c of lt.children) { const on = c.dataset.id === t.active; c.classList.toggle('active', on); c.setAttribute('aria-selected', on); c.tabIndex = on ? 0 : -1; }
    root.querySelector('[data-mx=merge]').disabled = M.layerOf(t).locked;
    tt.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    lt.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- thumbnails ----------
  // What to repaint: null = every cell, 'layers' = the layer bar (another template was picked), 'live' = the cells
  // being drawn on. Requests within one frame are merged, so a bigger repaint is never lost to a later smaller one.
  const THUMB_RANK = { live: 1, layers: 2 }; let thumbWant = 0;
  function scheduleThumbs(only = null) {
    thumbWant = Math.max(thumbWant, only ? THUMB_RANK[only] || 1 : 3); cancelAnimationFrame(thumbFrame);
    thumbFrame = requestAnimationFrame(() => { const w = thumbWant; thumbWant = 0; paintThumbs(w >= 3 ? null : w === 2 ? 'layers' : 'live'); });
  }
  function paint(canvas, list) {
    if (!canvas) return;
    const w = canvas.width, h = canvas.height, x = canvas.getContext('2d'), s = w / page.width;
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.scale(s, h / page.height);
    const min = 1.15 / s;  // keep thin pen lines visible at thumbnail size
    for (const a of list) ink.drawAnnotation(x, (a.type === 'pen' || a.type === 'rect') && a.width < min ? { ...a, width: min } : a);
  }
  function paintThumbs(only) {
    if (!root || !page) return;
    const m = M.get(page), t = M.tpl(m), { t: tt, l: lt } = tracks();
    for (const x of m.templates) if (!only || x.id === m.active) paint(tt.querySelector(`[data-id="${x.id}"] canvas`), M.visible(page, x));
    for (const l of t.layers) if (only !== 'live' || l.id === t.active) paint(lt.querySelector(`[data-id="${l.id}"] canvas`), M.strokesOf(page, l));
  }

  // ---------- switching (cheap: arrays swap + one redraw) ----------
  function peek() {
    const el = root?.querySelector('.mx-peek'); if (!el) return;
    const m = M.get(page), i = m.templates.findIndex(x => x.id === m.active), t = M.tpl(m), j = t.layers.findIndex(l => l.id === t.active), l = M.layerOf(t);
    el.innerHTML = `${icon('templates')}<span>${E(t.title)} <small>${i + 1}/${m.templates.length}</small></span><span class="mx-dot"></span>${icon(l.locked ? 'lock' : 'layers')}<span>${E(l.title)} <small>${j + 1}/${t.layers.length}</small></span>`;
    el.classList.add('show'); clearTimeout(peekTimer); peekTimer = setTimeout(() => el.classList.remove('show'), 1100);
  }
  function before() { ed.finishText(); ed.clearSelection(); }
  function pickLayer(id) { before(); if (!M.selectLayer(page, id)) return false; markActive(); ed.redraw(); peek(); return true; }
  function pickTemplate(id) { before(); if (!M.selectTemplate(page, id)) return false; if (renderLayers()) scheduleThumbs('layers'); markActive(); ed.redraw(); peek(); return true; }
  // After a switch: remember it, refresh the bars and the page's thumbnail in the page list (it shows what is on screen).
  function settle() { ed.save(false); render(false); ed.refreshThumbnail(); }

  function bindScrub(track) {
    const axis = track.dataset.axis;
    track.addEventListener('pointerdown', e => {
      const cell = e.target.closest('.mx-cell'); if (!cell || e.button !== 0 || !page) return;
      const id0 = cell.dataset.id, x0 = e.clientX, y0 = e.clientY;
      let scrub = false, cells = null, current = id0, frame = 0, want = null;
      const begin = () => {
        if (scrub) return; scrub = true; cells = [...track.querySelectorAll('.mx-cell')].map(c => ({ id: c.dataset.id, el: c, r: c.getBoundingClientRect() }));
        track.classList.add('scrubbing'); document.body.classList.add('mx-scrubbing'); try { track.setPointerCapture(e.pointerId); } catch {}
        apply(id0);
      };
      const apply = id => { want = id; if (frame) return; frame = requestAnimationFrame(() => { frame = 0; if (want && want !== current) { current = want; axis === 'x' ? pickTemplate(want) : pickLayer(want); } else if (want === id0 && current === id0) { axis === 'x' ? pickTemplate(id0) : pickLayer(id0); } }); };
      const hit = (cx, cy) => {
        let best = null, d = Infinity;
        for (const c of cells) { const mid = axis === 'x' ? (c.r.left + c.r.right) / 2 : (c.r.top + c.r.bottom) / 2, v = axis === 'x' ? cx : cy, dd = Math.abs(v - mid); if (dd < d) { d = dd; best = c; } }
        if (best) { apply(best.id); best.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      };
      const timer = setTimeout(begin, 150);
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        const dist = axis === 'x' ? Math.abs(ev.clientX - x0) : Math.abs(ev.clientY - y0);
        if (!scrub && dist > 5) { clearTimeout(timer); begin(); }
        if (scrub) { ev.preventDefault(); hit(ev.clientX, ev.clientY); }
      };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        clearTimeout(timer); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        if (!scrub) return;
        cancelAnimationFrame(frame); if (want && want !== current) { axis === 'x' ? pickTemplate(want) : pickLayer(want); }
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
        track.classList.remove('scrubbing'); document.body.classList.remove('mx-scrubbing'); settle();
      };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    });
  }

  // ---------- commands (undoable through the editor's history) ----------
  function act(fn) { if (!page) return; before(); const snap = ed.snapshot(); const r = fn(); if (r === false || r === null) return r; cache.clear(); ed.commit(snap); render(false); return r; }
  const cmd = {
    'add-template': () => { const t = act(() => M.addTemplate(page)); if (t) { peek(); ui.toast(`已新建「${t.title}」：空白模板，带一个草稿层`); } },
    fork: () => { const r = act(() => M.fork(page)); if (r) { peek(); ui.toast(r.copied ? `已克隆为「${r.template.title}」：复制了 ${r.copied} 个锁定层，只改不一样的部分，再左右滑动对比` : `已克隆为「${r.template.title}」。原模板还没有锁定层，所以是空白的；双击图层可以锁定`); } },
    'add-layer': () => { const l = act(() => M.addLayer(page)); if (l) peek(); },
    merge: () => {
      const t = M.tpl(M.get(page));
      if (M.layerOf(t).locked) { ui.toast('当前层已经是锁定层。先选一个草稿层，再合并。'); return; }
      const r = act(() => M.mergeDown(page));
      if (r?.result === 'merged') { peek(); ui.toast(`已把 ${r.count} 条笔迹合并到锁定层「${r.layer.title}」`); }
      else if (r?.result === 'locked') { peek(); ui.toast(`这个模板还没有锁定层，已把「${r.layer.title}」锁定为骨架`); }
    },
    'template-menu': () => templateMenu(M.get(page).active),
    'layer-menu': () => layerMenu(M.tpl(M.get(page)).active),
  };
  function toggleLock(id) { const l = M.layerOf(M.tpl(M.get(page)), id); if (!l) return; const r = act(() => { const v = M.toggleLock(page, id); return v === null ? null : { on: v }; }); if (!r) return; peek(); ui.toast(r.on ? `「${l.title}」已锁定：常驻显示，换到别的图层也看得到，橡皮擦不会擦到它` : `「${l.title}」已解锁：变回草稿层，只有选中时才显示`); }
  async function renameTemplate(id) { const t = M.tpl(M.get(page), id); if (!t) return; const v = await ui.ask('模板改名', '模板名称', t.title); if (v && page) act(() => M.renameTemplate(page, id, v)); }
  async function renameLayer(id) { const l = M.layerOf(M.tpl(M.get(page)), id); if (!l) return; const v = await ui.ask('图层改名', '图层名称', l.title); if (v && page) act(() => M.renameLayer(page, id, v)); }
  function templateMenu(id) {
    const m = M.get(page), t = M.tpl(m, id), i = m.templates.indexOf(t);
    ui.menu(t.title, [
      { label: '改名', icon: 'edit', run: () => renameTemplate(id) },
      { label: '克隆分叉这个模板', sub: '复制它的锁定层，生成右边的平行模板', icon: 'fork', run: () => { if (id !== m.active) pickTemplate(id); cmd.fork(); } },
      { label: '左移', icon: 'left', disabled: i === 0, run: () => act(() => M.moveTemplate(page, id, -1)) },
      { label: '右移', icon: 'chevron', disabled: i === m.templates.length - 1, run: () => act(() => M.moveTemplate(page, id, 1)) },
      { separator: true },
      { label: '删除这个模板', sub: m.templates.length < 2 ? '至少要保留一个模板' : '可以用 Ctrl Z 撤销', icon: 'trash', danger: true, disabled: m.templates.length < 2, run: () => { const r = act(() => M.removeTemplate(page, id)); if (r !== false) ui.toast(`已删除「${t.title}」`); } },
    ], { subtitle: `模板 ${i + 1} / ${m.templates.length} · ${t.layers.length} 个图层` });
  }
  function layerMenu(id) {
    const t = M.tpl(M.get(page)), l = M.layerOf(t, id), i = t.layers.indexOf(l);
    ui.menu(l.title, [
      { label: l.locked ? '解锁（变回草稿层）' : '锁定（常驻显示）', icon: l.locked ? 'unlock' : 'lock', run: () => toggleLock(id) },
      { label: '改名', icon: 'edit', run: () => renameLayer(id) },
      { label: '合并至锁定层', sub: '把这层笔迹并入上方的锁定层', icon: 'merge-down', disabled: l.locked, run: () => { if (id !== t.active) pickLayer(id); cmd.merge(); } },
      { label: '上移', icon: 'up', disabled: i === 0, run: () => act(() => M.moveLayer(page, id, -1)) },
      { label: '下移', icon: 'down-arrow', disabled: i === t.layers.length - 1, run: () => act(() => M.moveLayer(page, id, 1)) },
      { separator: true },
      { label: '删除这个图层', sub: t.layers.length < 2 ? '每个模板至少保留一个图层' : '可以用 Ctrl Z 撤销', icon: 'trash', danger: true, disabled: t.layers.length < 2, run: () => { const r = act(() => M.removeLayer(page, id)); if (r !== false) ui.toast(`已删除「${l.title}」`); } },
    ], { subtitle: `${t.title} · 图层 ${i + 1} / ${t.layers.length}${l.locked ? ' · 已锁定' : ' · 草稿'}` });
  }

  // ---------- events ----------
  function onClick(e) {
    if (!page) return;
    const b = e.target.closest('[data-mx]'); if (b) { if (!b.disabled) cmd[b.dataset.mx]?.(); return; }
    const cell = e.target.closest('.mx-cell'); if (!cell || suppressClick) return;
    const changedNow = cell.classList.contains('mx-tpl') ? pickTemplate(cell.dataset.id) : pickLayer(cell.dataset.id);
    if (changedNow) settle();
  }
  function onDblClick(e) {
    const cell = e.target.closest('.mx-cell'); if (!cell || !page) return; e.preventDefault();
    if (cell.classList.contains('mx-tpl')) renameTemplate(cell.dataset.id); else toggleLock(cell.dataset.id);
  }
  function onContext(e) {
    const cell = e.target.closest('.mx-cell'); if (!cell || !page) return; e.preventDefault();
    if (cell.classList.contains('mx-tpl')) templateMenu(cell.dataset.id); else layerMenu(cell.dataset.id);
  }
  function onTrackKey(e) {
    const cell = e.target.closest?.('.mx-cell'); if (!cell || !page) return;
    const axis = cell.parentElement.dataset.axis, keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key) || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); step(axis, e.key === keys[0] ? -1 : 1, true);
  }
  function step(axis, delta, focus) {
    const m = M.get(page), t = M.tpl(m), list = axis === 'x' ? m.templates : t.layers, cur = axis === 'x' ? m.active : t.active;
    const i = list.findIndex(x => x.id === cur), next = list[i + delta]; if (!next) return;
    if (axis === 'x' ? pickTemplate(next.id) : pickLayer(next.id)) settle();
    if (focus) root.querySelector(`.mx-track[data-axis="${axis}"] [data-id="${next.id}"]`)?.focus();
  }
  function onKey(e) {
    if (!page || !root?.isConnected || !e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target; if (t?.closest?.('input,textarea,select,[contenteditable="true"],dialog[open]')) return;
    const map = { ArrowLeft: () => step('x', -1), ArrowRight: () => step('x', 1), ArrowUp: () => step('y', -1), ArrowDown: () => step('y', 1), n: cmd['add-template'], N: cmd['add-template'], k: cmd.fork, K: cmd.fork, l: cmd['add-layer'], L: cmd['add-layer'], m: cmd.merge, M: cmd.merge };
    const f = map[e.key]; if (!f) return; e.preventDefault(); e.stopPropagation(); f();
  }

  return { mount, unmount, pageShown, changed, underlay };
}
