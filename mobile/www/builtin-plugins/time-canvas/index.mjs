// 时间画布：一种画布类型。书写、页面、导出都由墨页的页面编辑器（host.notebook）提供，
// 这个插件只规定“新页面要盖上日期和时间”，并把入口放进笔记库。
const isTime = d => d.kind === 'notebook' && d.canvasType === 'time';
export function activate(host) {
  const create = () => host.notebook.newDialog({ canvasType: 'time' });
  host.notebook.registerCanvasType({
    id: 'time', title: '时间画布', subtitle: '创建时自动写入日期和时间，新增页也会标记', icon: 'time', order: 10, defaultTemplate: 'dot',
    initPage(page) { page.timeCanvas = true; page.canvasCreatedAt = Date.now(); },
    addPageHint: '时间画布的新页面会自动写入日期和时间。', createdToast: '时间画布已创建，日期和时间已写入页面',
  });
  host.docTypes.register({ id: 'time-canvas', label: '时间画布', icon: 'time', iconClass: 'time', match: isTime });
  host.library.addCategory({ id: 'time', title: '时间画布', icon: 'time', order: 10, match: isTime, newCard: { title: '新建时间画布', subtitle: '自动记录日期和时间', run: create } });
  host.library.addTile({ id: 'time', title: '时间画布', subtitle: '自动记录日期和时间', icon: 'time', className: 'tile-time', order: 10, run: create });
  host.library.addNewMenuItem({ id: 'time', title: '时间画布', subtitle: '创建即记录日期和时间，新增页自动标记', icon: 'time', tone: 'primary', order: 10, run: create });
}
