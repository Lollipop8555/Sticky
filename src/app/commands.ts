/**
 * 便签的写操作。**全部同步**（除了 flush）：UI 永远不需要 `await` 一次移动或输入，
 * 落库由写队列在后台合批。异步只发生在 `flush()`。
 *
 * 每个命令都只做三件事：校验 → 组装完整的新记录 → `store.commit`。
 * 不做增量字段更新（`Object.assign` 半个记录），因为写队列存的是整条快照，
 * 半个记录会覆盖掉别处的改动。
 */

import { getPrefs, nextZ } from '@/app/prefs';
import { store } from '@/app/store';
import { pickColor } from '@/note/palette';
import type { NoteRecord } from '@/storage/types';

export interface CreateNoteOpts {
  /** 落点（**卡片中心**的世界坐标） */
  world: { x: number; y: number };
  contentMd?: string;
  width?: number;
  /**
   * 初始高度。只在**建卡时就知道成品高度**的情况下给（图片便签按图比例算），
   * 其余一律 minHeight：先猜一个高度、挂载后再量，会让卡片首帧闪一下。
   */
  height?: number;
}

/** 与已有卡片重叠超过这个比例就挪一挪：否则"点了没看见新卡" */
const OVERLAP_TOLERANCE = 0.3;
const NUDGE = 24;
const NUDGE_STEPS = 8;

function overlapRatio(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return 0;
  return (ox * oy) / (a.w * a.h);
}

function isCrowded(rect: { x: number; y: number; w: number; h: number }): boolean {
  for (const n of store.getNotes().values()) {
    if (overlapRatio(rect, { x: n.x, y: n.y, w: n.width, h: n.height }) > OVERLAP_TOLERANCE) {
      return true;
    }
  }
  return false;
}

export const commands = {
  create(opts: CreateNoteOpts): NoteRecord {
    const width = opts.width ?? getPrefs().defaultNoteWidth;
    // 文字便签默认 1:1（决策 64）：高度跟宽度走，空卡就是个方块而不是窄长条。
    // 图片便签建卡时就拿到了成品高度，下限仍取 160（宽图不能矮成一条线）。
    const minHeight = opts.height === undefined ? width : 160;
    // 空卡的实测高度就等于 minHeight，不必先量一遍
    const height = Math.max(minHeight, Math.round(opts.height ?? minHeight));

    let x = Math.round(opts.world.x - width / 2);
    let y = Math.round(opts.world.y - height / 2);

    // 逐级向右下试探，最多 8 次。找不到就认了（墙很挤时硬塞回原点，
    // 至少保证卡在指针附近出现，而不是飞到别处）
    for (let i = 0; i < NUDGE_STEPS; i++) {
      if (!isCrowded({ x, y, w: width, h: height })) break;
      x += NUDGE;
      y += NUDGE;
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const record: NoteRecord = {
      id,
      x,
      y,
      width,
      height,
      minHeight,
      z: nextZ(), // z 单调递增且持久化：重启后新建的卡仍在最上面
      // 取色用**落定后**的坐标（挪过之后的位置），否则避撞统计的是"原本想放的地方"
      bgColor: pickColor({
        poolId: getPrefs().palette,
        notes: store.getNotes().values(),
        cx: x + width / 2,
        cy: y + height / 2,
        id,
      }),
      contentMd: opts.contentMd ?? '',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    store.commit([record]);
    return record;
  },

  /** 内容更新：相同就不写，否则 `updatedAt` 会无意义抖动（写队列也会白写一次） */
  updateContent(id: string, contentMd: string): void {
    const note = store.getNote(id);
    if (!note || note.contentMd === contentMd) return;
    store.commit([{ ...note, contentMd, updatedAt: Date.now() }]);
  },

  /** 高度回填：`tolerance` 用来吸收亚像素误差，避免每次挂载都写一次库 */
  setHeight(id: string, height: number, tolerance = 0): void {
    const note = store.getNote(id);
    if (!note) return;
    const next = Math.max(note.minHeight, Math.round(height));
    if (Math.abs(next - note.height) <= tolerance) return;
    store.commit([{ ...note, height: next, updatedAt: Date.now() }]);
  },

  /**
   * 移动：拖动时每帧都会调一次，所以**相同就返回**。
   * 坐标取整与 `patchNoteEl` 保持一致，否则 store 里的值和小数位抖动会让
   * "有没有变化"每帧都成立，一次拖动等于几十次无意义的 commit。
   *
   * 不动 `updatedAt`：位置不是内容修改，让"最近修改"跟着拖动乱跳没有意义。
   */
  move(id: string, x: number, y: number): void {
    const note = store.getNote(id);
    if (!note) return;
    const nx = Math.round(x);
    const ny = Math.round(y);
    if (nx === note.x && ny === note.y) return;
    store.commit([{ ...note, x: nx, y: ny }]);
  },

  bringToFront(id: string): void {
    const note = store.getNote(id);
    if (!note) return;
    store.commit([{ ...note, z: nextZ() }]);
  },
};
