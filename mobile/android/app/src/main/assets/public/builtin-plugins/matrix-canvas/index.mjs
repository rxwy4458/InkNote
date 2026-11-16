// 二维模板画布：一种画布类型（canvasType: "matrix"）。
// 用墨页的页面编辑器（笔、荧光笔、橡皮擦、套索、文字、撤销、导出都现成可用），
// 再通过页面扩展（page extension）给每一页加上“模板 × 图层”矩阵和两条滑动选择条。
// 这个插件只使用 host 提供的接口，可以作为写新画布插件的参考。
import * as M from './matrix.mjs';
import { createMatrixUI } from './ui.mjs';

const isMatrix = d => d.kind === 'notebook' && d.canvasType === 'matrix';
let ui = null;

export function activate(host) {
  host.ui.addStyle('matrix.css');
  ui = createMatrixUI(host);
  const create = () => host.notebook.newDialog({ canvasType: 'matrix' });
  host.notebook.registerCanvasType({
    id: 'matrix', title: '二维模板画布', subtitle: '横向平行模板 × 纵向图层草稿，长按滑动对比', icon: 'layers', order: 30,
    paperModes: ['paged'], defaultTemplate: 'blank',
    addPageHint: '新页面带一个空白模板和一个图层；每一页有自己的模板和图层。',
    createdToast: '二维模板画布已创建：横向条切换平行模板，纵向条切换图层，按住滑动即可快速对比',
    page: {
      key: M.KEY,
      init: page => { M.init(page); },
      validate: (raw, util) => M.validate(raw, util),
      displayAnnotations: page => (M.get(page) ? (M.bind(page), M.visible(page)) : page.annotations),
      underlay: (ctx, page, size) => ui.underlay(ctx, page, size),
      searchText: page => M.searchText(page),
      mount: () => ui.mount(),
      pageShown: page => ui.pageShown(page),
      changed: page => ui.changed(page),
      unmount: () => ui.unmount(),
    },
  });
  host.docTypes.register({
    id: 'matrix-canvas', label: '二维模板', icon: 'layers', iconClass: 'matrix', match: isMatrix,
    amount: d => { const n = d.pages.reduce((s, p) => s + (M.get(p)?.templates.length || 1), 0); return `${d.pages.length} 页 · ${n} 个模板`; },
    preview: d => {
      const m = M.get(d.pages[0]), t = m ? M.tpl(m) : null, E = host.ui.escape;
      const cells = m ? m.templates.slice(0, 5).map(x => `<i class="${x.id === m.active ? 'on' : ''}"></i>`).join('') : '<i class="on"></i>';
      const layers = t ? t.layers.slice(0, 5).map(l => `<b class="${l.locked ? 'lk' : ''} ${l.id === t.active ? 'on' : ''}"></b>`).join('') : '<b class="on"></b>';
      return `<div class="pv pv-matrix"><div class="pvm-sheet"><span class="pvm-row">${cells}</span><span class="pvm-col">${layers}</span></div><span class="pv-stamp">${host.ui.icon('layers')}${E(t ? t.title : '模板 1')}</span></div>`;
    },
  });
  host.library.addCategory({ id: 'matrix', title: '二维模板画布', icon: 'layers', order: 30, match: isMatrix, newCard: { title: '新建二维模板画布', subtitle: '平行模板 × 图层草稿', run: create } });
  host.library.addTile({ id: 'matrix', title: '二维模板', subtitle: '模板 × 图层，滑动对比', icon: 'layers', className: 'tile-matrix', order: 30, run: create });
  host.library.addNewMenuItem({ id: 'matrix', title: '二维模板画布', subtitle: '横向：平行模板，可克隆分叉后左右滑动对比；纵向：图层草稿，锁定的骨架常驻显示', icon: 'layers', tone: 'matrix', order: 30, run: create });
}
export function deactivate() { ui?.unmount(); ui = null; }
