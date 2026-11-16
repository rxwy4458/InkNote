// 示例插件：康奈尔笔记画布。
// 一个“画布类型”插件：书写、橡皮擦、文字、撤销、导出 PDF 全部由墨页的页面编辑器提供，
// 插件只在每一页存一点自己的数据（page.ext.cornell），并在笔迹下面画出分区线。
// 只使用 activate(host) 收到的 host 对象，不导入墨页自己的任何文件。

const KEY = 'cornell';
const isCornell = d => d.kind === 'notebook' && d.canvasType === 'cornell';

export function activate(host) {
  const create = () => host.notebook.newDialog({ canvasType: 'cornell' });

  host.notebook.registerCanvasType({
    id: 'cornell', title: '康奈尔笔记', subtitle: '线索栏 · 笔记区 · 总结区', icon: 'cornell.svg', order: 60,
    paperModes: ['paged'], defaultTemplate: 'ruled',
    addPageHint: '新页面同样分成三栏。',
    createdToast: '康奈尔笔记已创建：左边写线索，右边记笔记，下面写总结',
    page: {
      key: KEY,
      // 新页面：存分区尺寸（单位是页面坐标，A4 宽 595.28、高 841.89）。
      init(page) { page.ext = { ...(page.ext || {}), [KEY]: { v: 1, cue: 150, summary: 150 } }; },
      // 导入备份时检查数据，返回干净的对象；数据不对就抛出错误。
      validate(raw) {
        const n = (v, d, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d);
        return { v: 1, cue: n(raw?.cue, 150, 60, 300), summary: n(raw?.summary, 150, 60, 400) };
      },
      // 在纸面上画分区线和标签（编辑器、缩略图、导出的 PDF 都会画）。ctx 已经换算成页面坐标。
      decorate(ctx, page) {
        const c = page.ext[KEY], top = 70, bottom = page.height - c.summary;
        ctx.save();
        ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(c.cue, top); ctx.lineTo(c.cue, bottom); ctx.moveTo(24, bottom); ctx.lineTo(page.width - 24, bottom); ctx.stroke();
        ctx.fillStyle = '#9aa0a6'; ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.fillText('线索 · 关键词', 38, top + 16); ctx.fillText('笔记', c.cue + 12, top + 16); ctx.fillText('总结', 38, bottom + 18);
        ctx.restore();
      },
    },
  });

  host.docTypes.register({ id: 'cornell', label: '康奈尔笔记', icon: 'cornell.svg', iconClass: 'plugin', match: isCornell });
  host.library.addCategory({ id: 'cornell', title: '康奈尔笔记', icon: 'cornell.svg', order: 60, match: isCornell, newCard: { title: '新建康奈尔笔记', subtitle: '线索 · 笔记 · 总结', run: create } });
  host.library.addNewMenuItem({ id: 'cornell', title: '康奈尔笔记', subtitle: '左边线索、右边笔记、下面总结', icon: 'cornell.svg', order: 60, run: create });
}
