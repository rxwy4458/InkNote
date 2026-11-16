// 墨页 InkNote 插件接口（apiVersion 1）的类型定义。
// 插件入口：export function activate(host: InkNoteHost): void | Promise<void>
//          export function deactivate?(): void | Promise<void>
// 说明见同目录的《插件开发指南.md》。这里列出的就是插件能用的全部接口。

export interface PluginManifest {
  id: string;                 // /^[a-z0-9][a-z0-9-]{1,40}$/，与文件夹名相同
  name: string;
  version: string;            // "1.0.0"
  apiVersion: 1;
  main?: string;              // 默认 "index.mjs"
  icon?: string;              // IconName 或插件里的 .svg 文件名
  author?: string;
  description?: string;
  documents?: { kind: DocKind | string; canvasType?: string }[];
  fileTypes?: string[];
  minAppVersion?: string;
}

// ---------- 数据 ----------
export type DocKind = 'notebook' | 'pdf' | 'ebook' | 'discussion';
export interface Doc {
  id: string; title: string; kind: DocKind | string;
  canvasType?: string;        // kind 为 notebook 时：'time' | 'plain' | 'matrix' | 你的画布类型
  color?: 'olive' | 'sand' | 'blue' | 'pink';
  folder: string; favorite?: boolean;
  createdAt: number; updatedAt: number; lastPage: number;
  pages: Page[];
}
export interface Page {
  id: string; width: number; height: number;
  infinite?: boolean; sourceIndex: number | null;
  template: 'blank' | 'ruled' | 'grid' | 'dot' | string;
  spacing?: 'narrow' | 'standard' | 'wide'; margin?: boolean; title?: string;
  annotations: Annotation[];  // 编辑器工具只读写这里
  comments?: unknown[];
  ext?: Record<string, unknown>;  // 插件数据：ext[你的 key]
  [field: string]: unknown;
}
export type Point = { x: number; y: number; p: number };
export type Annotation =
  | { id: string; type: 'pen' | 'marker'; color: string; width: number; pressure: boolean; points: Point[] }
  | { id: string; type: 'rect'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { id: string; type: 'text'; color: string; text: string; x: number; y: number; size: number; w?: number; h?: number }
  | { id: string; type: 'rich'; color: string; x: number; y: number; w: number; h?: number; size: number; html: string; plain: string };

// ---------- 登记项 ----------
type Run = () => void | Promise<void>;
export interface TileSpec { id: string; title: string; subtitle?: string; icon?: string; className?: string; order?: number; run: Run }
export interface CategorySpec { id: string; title: string; icon?: string; order?: number; match(doc: Doc): boolean; newCard?: { title: string; subtitle?: string; icon?: string; run: Run } }
export interface MenuItemSpec { id: string; title: string; subtitle?: string; icon?: string; tone?: 'primary' | 'secondary' | 'tertiary' | 'neutral' | string; order?: number; run: Run }
export interface DocTypeSpec {
  id: string; label: string; icon?: string; iconClass?: string;
  match(doc: Doc): boolean;
  preview?(doc: Doc): string;       // HTML
  amount?(doc: Doc): string;
  searchText?(doc: Doc): string;
}
export interface PageExtension {
  key: string;
  init(page: Page): void;
  validate(raw: unknown, util: { annotation(a: unknown): Annotation }): unknown;  // 返回干净数据，不合格就 throw
  decorate?(ctx: CanvasRenderingContext2D, page: Page): void;                      // 纸面装饰：编辑器、缩略图、导出
  underlay?(ctx: CanvasRenderingContext2D, page: Page, size: { width: number; height: number }): void;  // 仅编辑器，画在可编辑笔迹下面
  displayAnnotations?(page: Page): Annotation[];
  searchText?(page: Page): string[];
  mount?(): void;
  pageShown?(page: Page): void;
  changed?(page: Page): void;
  unmount?(): void;
}
export interface CanvasTypeSpec {
  id: string; title: string; subtitle?: string; icon?: string; order?: number;
  paperModes?: ('infinite' | 'paged')[];
  defaultTemplate?: 'blank' | 'ruled' | 'grid' | 'dot';
  initPage?(page: Page): void;
  addPageHint?: string; createdToast?: string;
  page?: PageExtension;
}
export interface ImporterSpec { id: string; label?: string; extensions: string[]; import(file: File): Promise<string | void> }
export interface MenuEntry { label: string; sub?: string; icon?: string; danger?: boolean; disabled?: boolean; run?: Run; separator?: false }

// ---------- host ----------
export interface InkNoteHost {
  readonly apiVersion: 1;
  readonly appVersion: string;
  readonly plugin: { id: string; version: string; name: string; baseUrl: string; url(path: string): string };
  readonly library: {
    addTile(spec: TileSpec): void;
    addCategory(spec: CategorySpec): void;
    addNewMenuItem(spec: MenuItemSpec): void;
    refresh(): void;
  };
  readonly docTypes: { register(spec: DocTypeSpec): void };
  readonly notebook: {
    registerCanvasType(spec: CanvasTypeSpec): void;
    create(options: { canvasType: string; title?: string; folder?: string; template?: string; mode?: 'infinite' | 'paged'; spacing?: string; color?: string }): Promise<Doc>;
    newDialog(options?: { canvasType?: string }): void;
  };
  readonly importers: { register(spec: ImporterSpec): void; pick(): void };
  readonly docs: {
    all(): Doc[]; get(id: string): Doc | undefined; uid(): string;
    create(doc: Partial<Doc> & { title: string; pages: Page[] }): Promise<Doc>;
    save(doc: Doc, options?: { touch?: boolean }): Promise<void>;
    open(id: string): Promise<void>;
  };
  readonly services: { importPdf(file: File): Promise<string>; importEbook(file: File): Promise<string>; newPost(): void };
  readonly ink: {
    drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation): void;
    bounds(a: Annotation): { x: number; y: number; w: number; h: number };
    hitAnnotation(a: Annotation, point: { x: number; y: number }, radius?: number): boolean;
    readonly PAPER: { width: number; height: number };
    readonly COLORS: string[]; readonly MARKERS: string[];
    prepareRich(list: Annotation[], scale: number): Promise<void>;
  };
  readonly editor: {
    doc(): Doc | null; page(): Page | null; pageIndex(): number;
    stage(): HTMLElement | null;
    redraw(): void;
    snapshot(): unknown; commit(before: unknown): void;
    save(touch?: boolean): void;
    refreshThumbnail(): void;
    zoom(): number; inkSize(): { width: number; height: number } | null;
    finishText(): void; clearSelection(): void;
    dock(): 'bottom' | 'top' | 'left' | 'right';
  };
  readonly ui: {
    icon(name: string, className?: string): string;
    escape(text: unknown): string;
    toast(message: string, isError?: boolean): void;
    dialog(title: string, html: string, options?: { subtitle?: string; submit?(form: FormData): void | Promise<void> }): void;
    close(): void;
    actions(okText?: string, danger?: boolean): string;
    ask(title: string, label: string, value?: string, options?: { type?: string; ok?: string }): Promise<string | null>;
    menu(title: string, items: (MenuEntry | { separator: true })[], options?: { subtitle?: string }): void;
    addStyle(href: string): void;
    run(fn: () => unknown): Promise<void>;
  };
}
