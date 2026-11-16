// 普通画布：最基本的画布类型，页面编辑器的全部功能由墨页提供。
const isPlain = d => d.kind === 'notebook' && (!d.canvasType || d.canvasType === 'plain');
export function activate(host) {
  const create = () => host.notebook.newDialog({ canvasType: 'plain' });
  host.notebook.registerCanvasType({ id: 'plain', title: '普通画布', subtitle: '不带时间，需要时用「日期」按钮插入', icon: 'draw', order: 20, defaultTemplate: 'dot', addPageHint: '新页面插入到当前页之后，可以在页面顶部写标题。', createdToast: '画布已创建' });
  host.docTypes.register({ id: 'plain-canvas', label: '普通画布', icon: 'draw', iconClass: 'plain', match: isPlain });
  host.library.addCategory({ id: 'plain', title: '普通画布', icon: 'draw', order: 20, match: isPlain, newCard: { title: '新建普通画布', subtitle: '无限画布或 A4 分页', run: create } });
  host.library.addTile({ id: 'plain', title: '普通画布', subtitle: '可手动插入日期', icon: 'draw', className: 'tile-plain', order: 20, run: create });
  host.library.addNewMenuItem({ id: 'plain', title: '普通画布', subtitle: '不带自动时间，可手动插入日期', icon: 'draw', tone: 'secondary', order: 20, run: create });
}
