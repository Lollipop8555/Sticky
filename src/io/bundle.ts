/**
 * 整库导出 / 导入的**纯数据层**（PRD §2.5）：只负责"记录 + 资产 → zip"和"zip → 记录 + 资产"，
 * 不碰 UI、不写库。写库、问偏好、fitAll 那些编排在 `importFlow.ts` 里 —— 分开才好单测。
 *
 * zip 布局（io-persistence §2.2）：
 *   notes/<id>.md      每张便签一个文件，头部是位置/尺寸/颜色
 *   assets/<id>.<ext>  被 contentMd 引用的图片
 *   manifest.json      settings + lastViewport（**可选**，缺了也能导入）
 *
 * `jszip` 走动态 import：导出/导入是低频操作，不该进首屏包。
 */

import { collectAssetIds } from '@/trash/trash';
import { serializeNote, parseNote, type NoteMeta } from '@/io/frontmatter';
import type { AssetRecord, NoteRecord, PrefsRecord, SettingsRecord, ViewportRecord } from '@/storage/types';

export const BUNDLE_VERSION = 1;

/** 单个条目的解压上限：一张 40MB 的图已经远超"便签里插张图"的合理范围 */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
/** 整包解压总量上限：防 zip bomb（压缩比极高的包在这一步被拦下） */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export class BundleTooLargeError extends Error {
  constructor(message = '压缩包过大，已中止导入') {
    super(message);
    this.name = 'BundleTooLargeError';
  }
}

/**
 * 资产索引（io-persistence §2.2）：导入时直接拿到 mime 与像素尺寸，
 * 不用为了算图片便签比例再解一遍码。缺失也能工作（importFlow 会自己量）。
 */
export interface BundleAssetMeta {
  id: string;
  ext: string;
  mime: string;
  w: number;
  h: number;
}

/**
 * 字段名与 io-persistence §2.2 一致：`preferences` / `lastViewport`。
 * 导入只读 `preferences`（视图不被包内视野劫持），`lastViewport` 留给未来的"还原现场"。
 */
export interface BundleManifest {
  app: 'sticky-wall';
  version: number;
  exportedAt: number;
  noteCount?: number;
  preferences?: Partial<SettingsRecord>;
  lastViewport?: ViewportRecord;
  assets?: BundleAssetMeta[];
}

export interface ParsedAsset {
  /** zip 内完整路径，如 `assets/<id>.png` */
  path: string;
  /** 文件名主体 = 资产 id；导入改名时以它为准 */
  id: string;
  ext: string;
  blob: Blob;
  /** manifest 里登记的元数据（没有就是 undefined） */
  meta?: BundleAssetMeta;
}

export interface ParsedBundle {
  notes: Array<{ meta: NoteMeta; contentMd: string }>;
  /** key = `assets/<id>.<ext>`（zip 内路径） */
  assets: Map<string, ParsedAsset>;
  manifest: BundleManifest | null;
  /** 解析失败/缺 id 而被丢弃的 md 数量 */
  skipped: number;
}

type JSZipConstructor = typeof import('jszip');

/**
 * `jszip` 的类型是 `export = JSZip`（CJS），动态 import 出来的模块命名空间
 * 在打包器与 Node 下形状不同：这里统一成"构造函数"，调用方只管 `new`。
 */
async function loadJSZip(): Promise<JSZipConstructor> {
  const mod = (await import('jszip')) as unknown as { default?: JSZipConstructor };
  return mod.default ?? (mod as unknown as JSZipConstructor);
}

const MD_DIR = 'notes/';
const ASSET_DIR = 'assets/';
const ASSET_PATH = /^assets\/(.+)\.([a-z0-9]+)$/i;

export async function buildBundle(
  notes: readonly NoteRecord[],
  getAsset: (id: string) => AssetRecord | undefined,
  prefs: Pick<PrefsRecord, 'background' | 'palette' | 'defaultNoteWidth' | 'baseFontSize' | 'wheelMode' | 'createMode'> & {
    lastViewport: ViewportRecord;
  },
): Promise<Blob> {
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  const assetIds = new Set<string>();
  for (const note of notes) {
    // 文件名用 id 而不是"第几张"：用户解开之后能对着记录找，重名也永远不会发生
    zip.file(`${MD_DIR}${note.id}.md`, serializeNote(note));
    for (const id of collectAssetIds(note.contentMd)) assetIds.add(id);
  }

  const index: BundleAssetMeta[] = [];
  let missing = 0;
  for (const id of assetIds) {
    const asset = getAsset(id);
    if (!asset) {
      // 引用在、图不在（被 GC 过/同步坏了）：跳过而不是让整包导出失败
      missing += 1;
      continue;
    }
    index.push({ id, ext: asset.ext, mime: asset.mime, w: asset.w, h: asset.h });
    // 图片本身已经是压缩过的 WebP/PNG，再 deflate 一遍只是白烧 CPU（决策 D8）
    zip.file(`${ASSET_DIR}${id}.${asset.ext}`, asset.blob, { compression: 'STORE' });
  }

  const manifest: BundleManifest = {
    app: 'sticky-wall',
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    noteCount: notes.length,
    preferences: {
      background: prefs.background,
      palette: prefs.palette,
      defaultNoteWidth: prefs.defaultNoteWidth,
      baseFontSize: prefs.baseFontSize,
      wheelMode: prefs.wheelMode,
      createMode: prefs.createMode,
    },
    lastViewport: prefs.lastViewport,
    assets: index,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  if (missing > 0) console.warn(`[bundle] 有 ${missing} 张图片引用不到，已跳过`);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** `../` 与绝对路径一律跳过：包是不可信输入，不给自己留"拼路径"的机会 */
function isUnsafePath(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]/).includes('..');
}

/**
 * @param data 也接受 ArrayBuffer：单测里不需要造一个 Blob 才能读包
 * @throws BundleTooLargeError 单条目或解压总量超过上限
 */
export async function parseBundle(data: Blob | ArrayBuffer): Promise<ParsedBundle> {
  if (data instanceof Blob && data.size > MAX_TOTAL_BYTES) throw new BundleTooLargeError();
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(data);

  const notes: ParsedBundle['notes'] = [];
  const assets: ParsedBundle['assets'] = new Map();
  let skipped = 0;
  let manifest: BundleManifest | null = null;
  let total = 0;

  // manifest 先读：资产的 mime/尺寸索引要用来填充下面每一个 entry
  const manifestEntry = zip.file('manifest.json');
  if (manifestEntry) {
    try {
      manifest = JSON.parse(await manifestEntry.async('string')) as BundleManifest;
    } catch {
      manifest = null; // 坏掉的 manifest 不该毁掉整次导入
    }
  }
  if (manifest && typeof manifest.version === 'number' && manifest.version > BUNDLE_VERSION) {
    console.warn(`[bundle] 包版本 ${manifest.version} 高于本机 ${BUNDLE_VERSION}，尽力导入`);
  }
  const metaById = new Map<string, BundleAssetMeta>();
  for (const meta of manifest?.assets ?? []) {
    if (meta && typeof meta.id === 'string') metaById.set(meta.id, meta);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    if (isUnsafePath(entry.name)) continue;
    // macOS"压缩"生成的垃圾：`__MACOSX/` 与资源分支 `._*`。
    // 它们在 Finder 里解压后重新打包时必然出现，且 `._a.md` 也以 .md 结尾 —— 不拦就会计入 skipped
    if (entry.name.startsWith('__MACOSX/')) continue;
    const base = entry.name.slice(entry.name.lastIndexOf('/') + 1);
    if (base.startsWith('._') || base === '.DS_Store') continue;

    if (entry.name.startsWith(ASSET_DIR)) {
      const match = ASSET_PATH.exec(entry.name);
      const id = match?.[1];
      const ext = match?.[2];
      if (!id || !ext) continue;
      const blob = await entry.async('blob');
      total += blob.size;
      if (blob.size > MAX_ENTRY_BYTES) throw new BundleTooLargeError(`单张图片超过 40MB：${entry.name}`);
      if (total > MAX_TOTAL_BYTES) throw new BundleTooLargeError();
      assets.set(entry.name, { path: entry.name, id, ext: ext.toLowerCase(), blob, meta: metaById.get(id) });
      continue;
    }

    if (entry.name.endsWith('.md')) {
      const text = await entry.async('string');
      total += text.length;
      if (total > MAX_TOTAL_BYTES) throw new BundleTooLargeError();
      const parsed = parseNote(text);
      if (parsed) notes.push(parsed);
      else skipped += 1;
      continue;
    }
    // 其它文件（.DS_Store、__MACOSX/…）静默忽略
  }

  return { notes, assets, manifest, skipped };
}
