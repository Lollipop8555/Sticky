/**
 * 视口状态与坐标数学。**这里不碰 DOM**，只写状态 + 通知订阅者（渲染层自己去画）。
 *
 * 两套坐标：
 *   screen = world * scale + pan        屏幕像素，原点在视口左上角
 *   world  = (screen - pan) / scale     世界单位，无界
 *
 * 不变量：scale ∈ [SCALE_EPS, SCALE_MAX]，pan 无界，任何值都必须是有限数。
 */

import { scheduleFrame } from './rAF';

export interface Viewport {
  panX: number;
  panY: number;
  scale: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 数值安全线，不是产品约束：再小 float 精度和 getBoundingClientRect 都不够用 */
export const SCALE_EPS = 0.002;
export const SCALE_MAX = 3;

/** 值真的变了才算变化。1e-6 世界单位远小于一个像素，肉眼不可见但能挡住浮点抖动 */
const EPS = 1e-6;

let current: Viewport = { panX: 0, panY: 0, scale: 1 };

const listeners = new Set<(v: Readonly<Viewport>) => void>();

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_EPS, scale));
}

function isFiniteViewport(v: Viewport): boolean {
  return Number.isFinite(v.panX) && Number.isFinite(v.panY) && Number.isFinite(v.scale);
}

function same(a: Viewport, b: Viewport): boolean {
  return (
    Math.abs(a.panX - b.panX) <= EPS &&
    Math.abs(a.panY - b.panY) <= EPS &&
    Math.abs(a.scale - b.scale) <= EPS
  );
}

/**
 * 唯一的写入口。所有 set/panBy/zoomAt 都从这里过，好处是"变了才通知"只有一处实现：
 * 拖动时每帧都通知会让剔除白算一遍，而剔除比重绘还贵。
 */
function commit(next: Viewport): void {
  if (!isFiniteViewport(next)) return; // NaN 一旦进状态就再也出不来，直接丢弃
  const value: Viewport = {
    panX: next.panX,
    panY: next.panY,
    scale: clampScale(next.scale),
  };
  if (same(value, current)) return;
  current = value;
  scheduleFrame();
  for (const fn of listeners) fn(current);
}

export function get(): Readonly<Viewport> {
  return current;
}

export function set(next: Viewport): void {
  commit(next);
}

export function panBy(dx: number, dy: number): void {
  commit({ panX: current.panX + dx, panY: current.panY + dy, scale: current.scale });
}

export function toWorld(sx: number, sy: number): { x: number; y: number } {
  const { panX, panY, scale } = current;
  return { x: (sx - panX) / scale, y: (sy - panY) / scale };
}

export function toScreen(wx: number, wy: number): { x: number; y: number } {
  const { panX, panY, scale } = current;
  return { x: wx * scale + panX, y: wy * scale + panY };
}

/**
 * 以屏幕点 (sx,sy) 为锚点缩放。
 *
 * 顺序必须是「先算世界锚点 → 再算新 pan」，且新 pan 用**原始** scale 推导：
 * 先改 scale 再补 pan 的话，补偿量会基于已经变过的 scale，连续调用会累积漂移。
 * 这条有单测兜底（连续 100 次同点缩放，锚点漂移 < 0.5px）。
 */
export function zoomAt(sx: number, sy: number, factor: number): void {
  const { panX, panY, scale } = current;
  if (!Number.isFinite(factor) || factor <= 0) return;

  const nextScale = clampScale(scale * factor);
  // 已经顶到上下限：这时若继续算 pan，会因为 scale 没变而算出 != pan 的值，锚点就漂了
  if (Math.abs(nextScale - scale) <= EPS) return;

  const wx = (sx - panX) / scale;
  const wy = (sy - panY) / scale;

  commit({
    panX: sx - wx * nextScale,
    panY: sy - wy * nextScale,
    scale: nextScale,
  });
}

/** 缩放到指定比例，锚点缺省为视口中心 */
export function zoomTo(target: number, anchor?: { sx: number; sy: number }): void {
  const { scale } = current;
  const next = clampScale(target);
  if (Math.abs(next - scale) <= EPS) return;

  const center = viewportSize();
  const sx = anchor?.sx ?? center.width / 2;
  const sy = anchor?.sy ?? center.height / 2;
  zoomAt(sx, sy, next / scale);
}

/**
 * 概览：把给定矩形全部装进视口。
 * - 空集合什么都不做（保持当前视野，而不是跳到 (0,0) 的 1× —— 那等于凭空"重置"了用户的视点）
 * - 上限 1 倍：只有一两张卡时不要放大到发糊
 */
export function fitAll(items: Iterable<Bounds>, padding = 120): void {
  let union: Bounds | null = null;
  for (const item of items) {
    if (!union) {
      union = { ...item };
      continue;
    }
    const right = Math.max(union.x + union.width, item.x + item.width);
    const bottom = Math.max(union.y + union.height, item.y + item.height);
    union.x = Math.min(union.x, item.x);
    union.y = Math.min(union.y, item.y);
    union.width = right - union.x;
    union.height = bottom - union.y;
  }
  if (!union) return;

  const { width: vw, height: vh } = viewportSize();
  // 单卡或极窄集合时 width 可能是 0，除零会把 scale 炸成 Infinity
  const bw = Math.max(union.width + padding * 2, 1);
  const bh = Math.max(union.height + padding * 2, 1);

  const scale = clampScale(Math.min(vw / bw, vh / bh, 1));
  const cx = union.x + union.width / 2;
  const cy = union.y + union.height / 2;

  set({ panX: vw / 2 - cx * scale, panY: vh / 2 - cy * scale, scale });
}

/**
 * 恢复上次视野，但**不允许打开即白屏**：若上次视野与任何一张便签都没有交集
 * （换过设备、便签被删光后重新粘在一处、窗口从竖屏变横屏），就退回 fitAll。
 *
 * `margin` 给了 160 世界单位的宽容度：窗口尺寸变化会让"刚好在边缘"的卡变成"刚好在框外"，
 * 这种情况不该被判定为失效——那会让每次改窗口大小都像被重置了视野。
 */
export function restoreViewport(
  last: Viewport,
  rects: Iterable<Bounds>,
  margin = 160,
): 'restored' | 'fitted' | 'empty' {
  const all = [...rects];
  if (all.length === 0) {
    // 空墙：恢复比例无副作用（没有东西可看），也让"我刚调好的缩放"跨刷新保留
    set(last);
    return 'empty';
  }

  const { width: vw, height: vh } = viewportSize();
  const scale = clampScale(last.scale);
  const view: Bounds = {
    x: -last.panX / scale,
    y: -last.panY / scale,
    width: vw / scale,
    height: vh / scale,
  };

  const visible = all.some(
    (r) =>
      r.x - margin < view.x + view.width &&
      r.x + r.width + margin > view.x &&
      r.y - margin < view.y + view.height &&
      r.y + r.height + margin > view.y,
  );

  if (visible) {
    set(last);
    return 'restored';
  }

  fitAll(all);
  return 'fitted';
}

/** 只在值真的变了时回调；返回取消订阅 */
export function onChange(fn: (v: Readonly<Viewport>) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 视口像素尺寸。剔除（culling）也要用它把世界矩形还原出来，
 * 所以不设成私有的：两处各写一份 `window.innerWidth` 迟早有一处忘记兜底。
 */
export function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  };
}
