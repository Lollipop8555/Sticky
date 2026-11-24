/**
 * 整库导出 / 导入的**编排层**（io-persistence §2–§3）。
 *
 * 数据形状在 `bundle.ts`（可单测），这里只做有副作用的三件事：
 *   1. 导出：内存记录 + 资产 → zip → 下载；
 *   2. 导入：zip → 改名去冲突 → 先写资产再写记录 → 内存/库同步 → fitAll；
 *   3. 偏好：包里的背景/配色**问过用户才应用**，应用交给 main 的 `onPrefs`（唯一副作用入口）。
 *
 * 导入语义是**纯追加**（决策 11/14）：撞 id 就改名 `<id>-1`，不做合并、不做去重。
 * 这样"同一个包导两次"最坏是数量翻倍，永远不会覆盖用户现有的东西。
 */

import { getPrefs, setZCounter } from '@/app/prefs';
import { store } from '@/app/store';
import { isBackground, isPaletteId, type Background, type PaletteId } from '@/app/theme';
import { fitAll } from '@/canvas/viewport';
import { t } from '@/i18n';
import { downloadBlob } from '@/io/clipboard';
import { buildBundle, BundleTooLargeError, parseBundle, type ParsedBundle } from '@/io/bundle';
import { getEditingId, stopEditing } from '@/note/editing';
import { repo } from '@/storage/repo';
import type { AssetRecord, NoteRecord, SettingsRecord } from '@/storage/types';
import { flush } from '@/storage/writeQueue';
import { toast } from '@/ui/toast';

/* ------------------------------------------------------------------ 记录清洗 */

const WIDTH_MIN = 120;
const WIDTH_MAX = 640;
const HEIGHT_MIN = 80;
const HEIGHT_MAX = 4000;
/** 坐标上限：1e6 已经远超任何真实墙面的范围，再大就是坏数据了 */
const COORD_LIMIT = 1_000_000;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** frontmatter 的 id 会变成文件名（再导出时），所以只允许安全字符 */
function safeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned === '' ? crypto.randomUUID() : cleaned;
}

/** 时间戳：坏值（0/负数/NaN）会让排序和"最近修改"一起失真 */
function safeTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : Date.now();
}

function safeColor(raw: string): string {
  const cleaned = raw.trim().replace(/[^#A-Za-z0-9_-]/g, '').slice(0, 24);
  return cleaned === '' ? 'yellow' : cleaned;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `assets/<old>.<ext>` → `assets/<new>.<ext>`，只动这个 id 的引用 */
function rewriteAssetRefs(contentMd: string, renames: ReadonlyMap<string, string>): string {
  let next = contentMd;
  for (const [oldId, newId] of renames) {
    next = next.replace(new RegExp(`assets/${escapeRegExp(oldId)}\\.`, 'g'), `assets/${newId}.`);
  }
  return next;
}

/* ------------------------------------------------------------------ 导入计划 */

export interface PlannedAsset {
  id: string;
  ext: string;
  mime: string;
  /** manifest 里登记过的像素尺寸；0 表示导出方没给，落库前再量 */
  w: number;
  h: number;
  blob: Blob;
}

export interface ImportPlan {
  /** 待写入的记录（id 已改名、资产引用已重写） */
  notes: NoteRecord[];
  assets: PlannedAsset[];
  renamedNotes: number;
  renamedAssets: number;
  /** 解析失败被丢弃的 md 数量 */
  skipped: number;
}

export interface PlanInput {
  parsed: ParsedBundle;
  /** 库里已有的 note id（**必须包含废纸篓**：它们还是同一条记录） */
  existingNoteIds: ReadonlySet<string>;
  existingAssetIds: ReadonlySet<string>;
}

/** 冲突时依次试 `<base>-1`、`-2`…：确定性、可读、且不会撞回已有 id */
function claimName(base: string, taken: Set<string>): { name: string; renamed: boolean } {
  if (!taken.has(base)) {
    taken.add(base);
    return { name: base, renamed: false };
  }
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return { name: candidate, renamed: true };
    }
  }
  const fallback = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  taken.add(fallback);
  return { name: fallback, renamed: true };
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/**
 * 纯函数：把解析结果摊成"要写进库的那批记录 + 那批资产"。
 * 不读库、不写库、不碰 DOM —— 改名与路径重写的规则因此可以单测。
 */
export function planImport(input: PlanInput): ImportPlan {
  const { parsed } = input;
  const takenAssets = new Set(input.existingAssetIds);
  const takenNotes = new Set(input.existingNoteIds);

  const assetIdRenames = new Map<string, string>();
  const assets: PlannedAsset[] = [];
  let renamedAssets = 0;

  for (const asset of parsed.assets.values()) {
    const base = safeId(asset.id);
    const { name, renamed } = claimName(base, takenAssets);
    if (renamed) {
      renamedAssets += 1;
      assetIdRenames.set(asset.id, name);
    }
    const meta = asset.meta;
    assets.push({
      id: name,
      ext: asset.ext,
      mime: meta?.mime || asset.blob.type || MIME_BY_EXT[asset.ext] || 'application/octet-stream',
      w: meta && Number.isFinite(meta.w) ? meta.w : 0,
      h: meta && Number.isFinite(meta.h) ? meta.h : 0,
      blob: asset.blob,
    });
  }

  const notes: NoteRecord[] = [];
  let renamedNotes = 0;

  for (const { meta, contentMd } of parsed.notes) {
    const base = safeId(meta.id);
    const { name, renamed } = claimName(base, takenNotes);
    if (renamed) renamedNotes += 1;

    const minHeight = clampNumber(meta.minHeight, HEIGHT_MIN, WIDTH_MAX, 160);
    const height = Math.max(minHeight, clampNumber(meta.height, HEIGHT_MIN, HEIGHT_MAX, minHeight));

    notes.push({
      id: name,
      x: clampNumber(meta.x, -COORD_LIMIT, COORD_LIMIT, 0),
      y: clampNumber(meta.y, -COORD_LIMIT, COORD_LIMIT, 0),
      width: clampNumber(meta.width, WIDTH_MIN, WIDTH_MAX, 320),
      height,
      minHeight,
      z: clampNumber(meta.z, 0, COORD_LIMIT, 0),
      bgColor: safeColor(meta.bgColor),
      // 只有被改名的资产才需要重写引用；没改名时正文一字不动（round-trip 的前提）
      contentMd: assetIdRenames.size === 0 ? contentMd : rewriteAssetRefs(contentMd, assetIdRenames),
      createdAt: safeTime(meta.createdAt),
      updatedAt: safeTime(meta.updatedAt),
      deletedAt: null,
    });
  }

  return { notes, assets, renamedNotes, renamedAssets, skipped: parsed.skipped };
}

/* ------------------------------------------------------------------ 偏好清洗 */

/**
 * 包里的 settings 是**不可信输入**：只接受当前版本认识的这几个字段，
 * 移动模式、界面语言这类设备相关设置一律不导入（换台设备不该继承"我上次是手机"，
 * 也不该因为导入了别人的备份就把自己的界面变成英文，见决策 69）。
 */
export function sanitizeSettings(raw: Partial<SettingsRecord> | undefined): Partial<SettingsRecord> | null {
  if (!raw) return null;
  const patch: Partial<SettingsRecord> = {};

  if (isBackground(raw.background)) patch.background = raw.background as Background;
  if (isPaletteId(raw.palette)) patch.palette = raw.palette as PaletteId;
  if (Number.isFinite(raw.defaultNoteWidth)) {
    patch.defaultNoteWidth = clampNumber(raw.defaultNoteWidth as number, WIDTH_MIN, 480, 320);
  }
  if (Number.isFinite(raw.baseFontSize)) {
    patch.baseFontSize = clampNumber(raw.baseFontSize as number, 12, 24, 16);
  }
  if (raw.wheelMode === 'pan' || raw.wheelMode === 'zoom') patch.wheelMode = raw.wheelMode;
  if (raw.createMode === 'dblclick' || raw.createMode === 'fab') patch.createMode = raw.createMode;

  return Object.keys(patch).length === 0 ? null : patch;
}

/* ------------------------------------------------------------------ 导出 */

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface LibraryCounts {
  notes: number;
  trashed: number;
}

/** 导出前的确认文案要用：导出**只含墙上**的便签，废纸篓必须明说（决策 15） */
export async function libraryCounts(): Promise<LibraryCounts> {
  let trashed = 0;
  try {
    trashed = (await repo.loadTrashed()).length;
  } catch {
    // 库读不出来时按 0 报：确认框不能因为统计失败就拦住导出
  }
  return { notes: store.count(), trashed };
}

export async function exportLibraryBundle(): Promise<boolean> {
  const notes = [...store.getNotes().values()];
  if (notes.length === 0) {
    toast(t('toast.wallEmpty'));
    return false;
  }

  try {
    // 资产一次全读：按 id 逐张 get 会开 N 个事务，整库几百张图时明显更慢
    const assets = new Map((await repo.loadAssetsAll()).map((asset) => [asset.id, asset]));
    const prefs = getPrefs();
    const blob = await buildBundle(notes, (id) => assets.get(id), prefs);
    downloadBlob(blob, `${t('file.wall')}-${today()}.zip`);
    toast(t('toast.exported', { n: notes.length }));
    return true;
  } catch (error) {
    console.error('[io] 导出失败', error);
    toast(t('toast.bundleExportFailed'));
    return false;
  }
}

/* ------------------------------------------------------------------ 导入 */

/**
 * 也接受已经解析好的 `ParsedBundle`：界面要先看 manifest 才能问"要不要应用外观"，
 * 让调用方把解析结果递进来，避免同一个几十 MB 的包被解两遍。
 */
export type ImportSource = Blob | ArrayBuffer | ParsedBundle;

function isParsed(source: ImportSource): source is ParsedBundle {
  return typeof source === 'object' && source !== null && 'notes' in source && 'assets' in source;
}

export interface ImportOptions {
  /** 用户勾选了"应用包内的背景与配色"（默认不应用） */
  applyPreferences?: boolean;
  /** 应用偏好：main 注入，负责主题重绘与落库 —— 这里不直接改 prefs */
  onPrefs?: (patch: Partial<SettingsRecord>) => void;
}

export interface ImportResult {
  added: number;
  renamedNotes: number;
  renamedAssets: number;
  skipped: number;
  /** 包里带了可应用的偏好（用于汇总里说明"已应用 / 保持当前"） */
  hasSettings: boolean;
  preferencesApplied: boolean;
}

/** 老 Safari 没有 createImageBitmap，退回 <img> 量一遍 */
async function measureBlob(blob: Blob): Promise<{ w: number; h: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { w: bitmap.width, h: bitmap.height };
      bitmap.close?.();
      if (size.w > 0 && size.h > 0) return size;
    } catch {
      // 格式不认识时继续走 <img>
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    // 尺寸只影响"图片便签初始比例"，量不出来也不该拦住导入
    return { w: 0, h: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importLibraryBundle(
  source: ImportSource,
  options: ImportOptions = {},
): Promise<ImportResult> {
  // 写队列里可能还有刚建的卡：不冲一次，它的 id 不在库里，改名检测会漏掉
  await flush();

  const parsed = isParsed(source) ? source : await parseBundle(source);
  const [liveNotes, trashedNotes, existingAssets] = await Promise.all([
    repo.loadNotes(),
    repo.loadTrashed(),
    repo.loadAssetsAll(),
  ]);

  const plan = planImport({
    parsed,
    existingNoteIds: new Set([...liveNotes, ...trashedNotes].map((note) => note.id)),
    existingAssetIds: new Set(existingAssets.map((asset) => asset.id)),
  });

  const settings = sanitizeSettings(parsed.manifest?.preferences);
  if (plan.notes.length === 0) {
    return {
      added: 0,
      renamedNotes: 0,
      renamedAssets: plan.renamedAssets,
      skipped: plan.skipped,
      hasSettings: settings !== null,
      preferencesApplied: false,
    };
  }

  // 正在编辑的卡先收笔：fitAll 会移动视野，编辑态还挂在旧位置上
  if (getEditingId() !== null) stopEditing();

  // 先资产后记录：反过来的话，md 先落库、图还没到，用户一刷新就是裂图
  const now = Date.now();
  const assetRecords: AssetRecord[] = [];
  for (const asset of plan.assets) {
    const size = asset.w > 0 && asset.h > 0 ? { w: asset.w, h: asset.h } : await measureBlob(asset.blob);
    assetRecords.push({
      id: asset.id,
      mime: asset.mime,
      ext: asset.ext,
      blob: asset.blob,
      w: size.w,
      h: size.h,
      createdAt: now,
    });
  }
  await repo.putAssets(assetRecords);

  // 记录走 store.commit（唯一写入口）：内存、写队列、重绘一次到位
  store.commit(plan.notes);
  // zCounter 必须抬到导入数据的最大 z 之上，否则"置于顶层"会给出一张比所有卡都低的 z
  for (const note of plan.notes) setZCounter(note.z);

  let preferencesApplied = false;
  if (settings && options.applyPreferences && options.onPrefs) {
    options.onPrefs(settings);
    preferencesApplied = true;
  }

  // 导入完自动概览：否则新卡可能全在视野外，用户以为没导进来（决策 23）
  fitAll(store.getNotes().values());

  return {
    added: plan.notes.length,
    renamedNotes: plan.renamedNotes,
    renamedAssets: plan.renamedAssets,
    skipped: plan.skipped,
    hasSettings: settings !== null,
    preferencesApplied,
  };
}

/** 给 UI 层复用：把异常翻译成一句能读的话 */
export function describeImportError(error: unknown): string {
  if (error instanceof BundleTooLargeError) return error.message;
  const message = error instanceof Error ? error.message : '';
  if (/zip|corrupt|central directory|signature/i.test(message)) return t('toast.badZip');
  return t('toast.importFailed');
}
