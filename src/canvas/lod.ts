/**
 * 细节层次（tech-design §2.4）：`scale` → `world.dataset.lod`。
 *
 * 这一层**只写一个 dataset**，样式全在 CSS。绝不逐卡改 class/style ——
 * 500 张卡时逐卡写样式会让每一帧都变成一次全表重算样式，而 dataset 只有一个元素。
 *
 * 阈值不是拍脑袋的数字：`sTextMin = 7px / baseFontSize`（可辨认下限），
 * 所以用户调大字号时"文字消失"的时机自动往后推，不会露出一段"卡上什么都没有"的空白区。
 * 算这个数的**唯一**来源是 prefs，不是在 CSS 里再抄一份。
 */

import { getPrefs } from '@/app/prefs';
import { MIN_READABLE_PX } from '@/app/theme';

export const LOD = {
  /** 全量：阴影、正文、工具条 */
  FULL: 0,
  /** 去阴影去工具条，保留正文 */
  TEXT: 1,
  /** 纯色块：正文 `visibility: hidden`，尺寸按 `--w/--h` 还原比例 */
  BLOCK: 2,
  /** 聚合气泡（M4 接 cluster.ts；S5 只把 dataset 写上） */
  CLUSTER: 3,
} as const;

export type LodLevel = (typeof LOD)[keyof typeof LOD];

/** 低于它就只剩色块；0.6 是"文字还看不清但阴影已经没意义"的分界 */
export const BLOCK_SCALE = 0.6;
/** 低于它就进入聚合（M4） */
export const CLUSTER_SCALE = 0.2;

/** 可辨认下限对应的 scale。读 prefs 而不是读 DOM：CSS 变量只是它的落点，不是真相 */
export function textMinScale(baseFontSize: number = getPrefs().baseFontSize): number {
  return MIN_READABLE_PX / baseFontSize;
}

/**
 * 判级。顺序必须是"从远到近"：`sTextMin` 可能大于 0.6（字号调到 12 以下时），
 * 这时 TEXT 档被自然挤掉，若先判 `< 0.6` 就会先命中 TEXT，露出读不清的文字。
 */
export function levelFor(scale: number, sTextMin: number = textMinScale()): LodLevel {
  if (scale < CLUSTER_SCALE) return LOD.CLUSTER;
  if (scale < sTextMin) return LOD.BLOCK;
  if (scale < BLOCK_SCALE) return LOD.TEXT;
  return LOD.FULL;
}

/**
 * 正文此刻是否看得见 —— 也就是"这张卡值不值得让人打字"。
 *
 * 单独抽出来是因为它与"进编辑"是同一件事的两个说法：色块/聚合档下正文是
 * `visibility: hidden` 的，进去编辑等于让人对着空白盲打。阈值必须复用 `levelFor`，
 * 另抄一份 `scale < 0.2` 迟早会和 LOD 分档对不上（比如以后给 CLUSTER 单独加一层）。
 */
export function textReadable(scale: number): boolean {
  return levelFor(scale) <= LOD.TEXT;
}

/**
 * 写进 `world.dataset.lod`。**只在真的变了时写**：
 * dataset 改动会触发该子树的样式重算，静止时每帧重写一次等于白烧 CPU。
 * 返回是否变化，调用方据此决定要不要做与层级相关的事（M4 的聚合层切换）。
 */
export function applyLevel(world: HTMLElement, level: LodLevel): boolean {
  const next = String(level);
  if (world.dataset['lod'] === next) return false;
  world.dataset['lod'] = next;
  return true;
}
