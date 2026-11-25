/**
 * 连线几何：世界坐标 → 画布上的点。
 *
 * 锚点定成"卡片内左上角的定点"而不是"卡片中心"：中心要读 height，而 height 会随正文变长，
 * 每改一个字都要重算所有关联线的端点；左上角只依赖 x/y，内容怎么变都不动。
 *
 * 11 是视觉值：卡片内边距是 `14px 16px`，11 落在内边距里，
 * 圆点（直径 9）压不到第一行字，又足够贴近左上角"像钉在卡上"。
 */

import type { NoteRecord } from '@/storage/types';

export const ANCHOR_INSET = 11;

export interface Point {
  x: number;
  y: number;
}

export function anchorOf(note: Pick<NoteRecord, 'x' | 'y'>): Point {
  return { x: note.x + ANCHOR_INSET, y: note.y + ANCHOR_INSET };
}
