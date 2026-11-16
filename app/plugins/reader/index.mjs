// 导入阅读：PDF 与电子书。读取、分页、渲染和批注由墨页的阅读服务提供，这个插件登记能打开的文件类型和入口。
const BOOKS = ['epub', 'txt', 'fb2', 'html', 'htm', 'cbz', 'md', 'mobi', 'azw', 'azw3', 'azw4', 'prc', 'rtf', 'docx', 'odt', 'chm', 'lit', 'lrf', 'pdb', 'snb', 'tcr', 'djvu', 'cbr'];
const isReading = d => d.kind === 'pdf' || d.kind === 'ebook';
export function activate(host) {
  const pick = () => host.importers.pick();
  host.docTypes.register({ id: 'pdf', label: 'PDF', icon: 'file', iconClass: 'pdf', match: d => d.kind === 'pdf' });
  host.docTypes.register({ id: 'ebook', label: '电子书', icon: 'reading', iconClass: 'book', match: d => d.kind === 'ebook' });
  host.importers.register({ id: 'pdf', label: 'PDF 文档', extensions: ['pdf'], import: file => host.services.importPdf(file) });
  host.importers.register({ id: 'ebook', label: '电子书与文本', extensions: BOOKS, import: file => host.services.importEbook(file) });
  host.library.addCategory({ id: 'reading', title: 'PDF 与电子书', icon: 'reading', order: 50, match: isReading, newCard: { title: '导入 PDF 或电子书', subtitle: 'EPUB · TXT · FB2 · CBZ …', icon: 'upload', run: pick } });
  host.library.addTile({ id: 'import', title: '导入阅读', subtitle: 'PDF · EPUB · TXT', icon: 'upload', className: 'tile-import', order: 50, run: pick });
  host.library.addNewMenuItem({ id: 'import', title: '导入文件', subtitle: 'PDF、EPUB、TXT 等电子书，或 .inknote 备份', icon: 'upload', tone: 'neutral', order: 50, run: pick });
}
