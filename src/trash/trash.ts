/**
 * 废纸篓的读写（S12/S13）。**只有这里改 `deletedAt`**。
 *
 * 三条纪律：
 * 1. 软删除 = 记录打 `deletedAt` + 从内存里摘掉，**不是物理删**。
 *    摘内存必须走 `store.detach`：`commit(upserts, removed)` 的 `removed` 会入队 `delete`，
 *    用它做软删等于把卡删没了，恢复无从谈起（决策 55）。
 * 2. 落库复用 `enqueue('upsert', trashed)`。写队列按 id 合并，所以"墙上"与"废纸篓"
 *    永远是同一条行的两个状态，不会出现两条同 id 的记录。
 * 3. 读/清废纸篓前先 `flush()`。刚删的卡还在 400ms 的节流窗口里，不冲一次就会出现
 *    "刚点了删除，打开废纸篓却是空的"这种看起来像丢数据的时序。
 */

import { nextZ } from '@/app/prefs';
import { store } from '@/app/store';
import { assetIdOf } from '@/assets/urls';
import { intersects, visibleRect } from '@/canvas/culling';
import { toWorld, viewportSize } from '@/canvas/viewport';
import { getEditingId, stopEditing } from '@/note/editing';
import { repo } from '@/storage/repo';
import type { NoteRecord } from '@/storage/types';
import { enqueue, flush } from '@/storage/writeQueue';

export type RestoreResult = 'restored' | 'relocated' | 'missing';

/**
 * 移到废纸篓。返回落库用的那条记录（调用方拿去弹撤销 toast），卡已经不在墙上。
 *
 * 正在编辑的卡先走一遍 `stopEditing()`：编辑内容只活在 Tiptap 实例里，
 * 直接摘 DOM 会让最后几个字跟着实例一起消失。
 */
export function trashNote(id: string): NoteRecord | null {
  const note = store.getNote(id);
  if (!note) return null;

  if (getEditingId() === id) stopEditing();
  // stopEditing 会回写内容与高度，所以记录必须重新取
  const latest = store.getNote(id) ?? note;

  const trashed: NoteRecord = { ...latest, deletedAt: Date.now() };
  // 先入队再摘内存：反过来会有一个"库里还在墙上、内存已经没了"的窗口，
  // 而 pagehide 的 flush 完全可能落在这个窗口里（下次启动卡就回来了）
  enqueue('upsert', trashed);
  store.detach([id]);
  return trashed;
}

/**
 * 恢复一张卡。
 *
 * 位置规则（interaction-spec §8）：原坐标还在视野里就原地放回；
 * 否则摆到当前视野中心并置顶 —— 否则用户点了"恢复"，墙上什么都没多出来。
 */
export async function restoreNote(id: string): Promise<RestoreResult> {
  // 已在墙上（连点两次恢复）：幂等，不重复建卡
  if (store.getNote(id)) return 'restored';

  // 刚删的卡可能只在写队列里，没冲进库就读不到
  await flush();
  const record = (await repo.loadTrashed()).find((n) => n.id === id);
  if (!record) return 'missing';

  const view = visibleRect(1);
  const inView = intersects(view, record);

  let restored: NoteRecord = { ...record, deletedAt: null };
  if (!inView) {
    const { width: vw, height: vh } = viewportSize();
    const center = toWorld(vw / 2, vh / 2);
    restored = {
      ...restored,
      x: Math.round(center.x - record.width / 2),
      y: Math.round(center.y - record.height / 2),
      z: nextZ(),
    };
  }

  store.commit([restored]);
  return inView ? 'restored' : 'relocated';
}

/** 废纸篓列表，按删除时间倒序（最近删的在最上面）。面板每次打开现读，不缓存 */
export async function listTrash(): Promise<NoteRecord[]> {
  await flush();
  const rows = await repo.loadTrashed();
  return rows.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/**
 * 清空废纸篓：物理删除记录 → 回收孤儿资产。
 *
 * 顺序不能反：**先删记录再 GC**，否则被清掉的那些卡还引用着图，GC 会把它们当活引用留着。
 */
export async function emptyTrash(): Promise<{ removed: number; freed: number }> {
  await flush();
  const rows = await repo.loadTrashed();
  if (rows.length > 0) await repo.delNotes(rows.map((n) => n.id));
  const freed = await gcAssets();
  return { removed: rows.length, freed };
}

// 与 assets/urls.ts 的 ASSET_SRC 同源：含导入进来的非 hex id（与 `-1` 改名后缀）
const ASSET_REF = /assets\/([A-Za-z0-9_-]+)\.[a-z0-9]+/gi;

/** 从一段 markdown 里收集资产 id。只扫 `assets/<id>.<ext>`，外链图本来就不入库 */
export function collectAssetIds(contentMd: string): string[] {
  const ids: string[] = [];
  for (const match of contentMd.matchAll(ASSET_REF)) {
    const id = match[1] ?? assetIdOf(match[0]);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * 孤儿资产回收：扫**全表笔记**（墙上 + 废纸篓）的 `contentMd`，留下被引用的。
 *
 * 只在"用户明确清空废纸篓"之后跑（决策 57）：boot 时跑会和导入/备份抢时序，
 * 而导入的流程是"先清库再写"，那一刻旧记录还没进来，GC 会把新资产误杀。
 *
 * 引用也看废纸篓：删掉的卡还能恢复，它的图不能先没了。
 */
export async function gcAssets(): Promise<number> {
  await flush();

  const [live, trashed, assets] = await Promise.all([
    repo.loadNotes(),
    repo.loadTrashed(),
    repo.loadAssetsAll(),
  ]);
  if (assets.length === 0) return 0;

  const referenced = new Set<string>();
  for (const note of [...live, ...trashed]) {
    for (const id of collectAssetIds(note.contentMd)) referenced.add(id);
  }

  const orphans = assets.filter((asset) => !referenced.has(asset.id)).map((asset) => asset.id);
  if (orphans.length > 0) await repo.delAssets(orphans);
  return orphans.length;
}
