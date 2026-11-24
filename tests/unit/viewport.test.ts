import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCALE_EPS,
  SCALE_MAX,
  fitAll,
  get,
  onChange,
  panBy,
  restoreViewport,
  set,
  toScreen,
  toWorld,
  zoomAt,
  zoomTo,
} from '@/canvas/viewport';

const VIEW_W = 1024;
const VIEW_H = 768;

/** 单测里锚点误差上限（px），与 impl-01 §7 的验收一致 */
const ANCHOR_TOLERANCE = 0.5;

function reset(): void {
  set({ panX: 0, panY: 0, scale: 1 });
}

function drift(sx: number, sy: number, before: { x: number; y: number }): number {
  const after = toWorld(sx, sy);
  return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
}

describe('viewport', () => {
  beforeEach(() => {
    reset();
  });

  it('默认是 1 倍、原点可见', () => {
    expect(get()).toEqual({ panX: 0, panY: 0, scale: 1 });
    expect(toWorld(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('toWorld ∘ toScreen 往返误差 < 1e-9', () => {
    set({ panX: 137.25, panY: -42.5, scale: 1.7 });
    for (const [sx, sy] of [
      [0, 0],
      [VIEW_W, VIEW_H],
      [123.5, 456.25],
    ] as const) {
      const w = toWorld(sx, sy);
      const back = toScreen(w.x, w.y);
      expect(Math.abs(back.x - sx)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - sy)).toBeLessThan(1e-9);
    }
  });

  it('锚点缩放：光标下的世界坐标在缩放前后不动（< 0.5px）', () => {
    set({ panX: 30, panY: -70, scale: 0.8 });
    const sx = 412;
    const sy = 288;
    const before = toWorld(sx, sy);

    zoomAt(sx, sy, 1.6);

    expect(get().scale).toBeCloseTo(1.28, 10);
    expect(drift(sx, sy, before)).toBeLessThan(ANCHOR_TOLERANCE);
  });

  it('连续 100 次同点缩放：不累积漂移（< 0.5px）', () => {
    const sx = 640;
    const sy = 360;
    const before = toWorld(sx, sy);

    for (let i = 0; i < 100; i++) zoomAt(sx, sy, 1.1);

    expect(drift(sx, sy, before)).toBeLessThan(ANCHOR_TOLERANCE);
    expect(get().scale).toBe(SCALE_MAX); // 中途撞到上限后仍应锚定不动
  });

  it('缩小到下限同样不漂，且比例夹在安全线内', () => {
    const sx = 200;
    const sy = 700;
    const before = toWorld(sx, sy);

    for (let i = 0; i < 200; i++) zoomAt(sx, sy, 0.9);

    expect(drift(sx, sy, before)).toBeLessThan(ANCHOR_TOLERANCE);
    expect(get().scale).toBe(SCALE_EPS);
    expect(Number.isFinite(get().panX)).toBe(true);
  });

  it('zoomTo 缺省以视口中心为锚点', () => {
    set({ panX: 50, panY: 20, scale: 0.5 });
    const center = { sx: VIEW_W / 2, sy: VIEW_H / 2 };
    const before = toWorld(center.sx, center.sy);

    zoomTo(2);
    expect(get().scale).toBeCloseTo(2, 10);
    expect(drift(center.sx, center.sy, before)).toBeLessThan(ANCHOR_TOLERANCE);
  });

  it('zoomTo 目标等于当前比例时完全不动（含 pan）', () => {
    set({ panX: 11, panY: 22, scale: 1 });
    zoomTo(1);
    expect(get()).toEqual({ panX: 11, panY: 22, scale: 1 });
  });

  it('panBy 累加，且不改 scale', () => {
    panBy(10, -5);
    panBy(-3, 8);
    expect(get()).toEqual({ panX: 7, panY: 3, scale: 1 });
  });

  it('fitAll 空集：视野原地不动（不是重置到 0,0）', () => {
    set({ panX: -300, panY: 120, scale: 0.42 });
    fitAll([]);
    expect(get()).toEqual({ panX: -300, panY: 120, scale: 0.42 });
  });

  it('fitAll 单卡：不放大（上限 1 倍），且卡居中', () => {
    fitAll([{ x: 40, y: -60, width: 260, height: 184 }]);

    expect(get().scale).toBe(1);
    const center = toScreen(40 + 130, -60 + 92);
    expect(Math.abs(center.x - VIEW_W / 2)).toBeLessThan(0.5);
    expect(Math.abs(center.y - VIEW_H / 2)).toBeLessThan(0.5);
  });

  it('fitAll 多卡：包围盒全部落在视口内', () => {
    const notes = [
      { x: -2000, y: -1500, width: 260, height: 184 },
      { x: 2400, y: 1900, width: 260, height: 184 },
    ];
    fitAll(notes);

    const { scale } = get();
    expect(scale).toBeLessThan(1);
    for (const n of notes) {
      const tl = toScreen(n.x, n.y);
      const br = toScreen(n.x + n.width, n.y + n.height);
      expect(tl.x).toBeGreaterThanOrEqual(0);
      expect(tl.y).toBeGreaterThanOrEqual(0);
      expect(br.x).toBeLessThanOrEqual(VIEW_W);
      expect(br.y).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it('NaN 进不来：状态一旦被污染就再也恢复不了，必须挡在入口', () => {
    set({ panX: Number.NaN, panY: 0, scale: 1 });
    expect(get()).toEqual({ panX: 0, panY: 0, scale: 1 });

    zoomAt(100, 100, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(get().scale)).toBe(true);
  });

  it('restoreViewport：空墙保留上次比例（没有东西可看，不该重置）', () => {
    expect(restoreViewport({ panX: 10, panY: 20, scale: 0.5 }, [])).toBe('empty');
    expect(get()).toEqual({ panX: 10, panY: 20, scale: 0.5 });
  });

  it('restoreViewport：上次视野里有卡片 → 原样恢复', () => {
    const vp = { panX: 120, panY: -60, scale: 0.5 };
    expect(restoreViewport(vp, [{ x: 0, y: 0, width: 260, height: 184 }])).toBe('restored');
    expect(get()).toEqual(vp);
  });

  it('restoreViewport：卡片全在视野外 → 退回 fitAll（打开即白屏是最糟的首屏）', () => {
    const notes = [
      { x: 0, y: 0, width: 260, height: 184 },
      { x: 1000, y: 800, width: 260, height: 184 },
    ];

    expect(restoreViewport({ panX: 100000, panY: 100000, scale: 1 }, notes)).toBe('fitted');

    const { scale } = get();
    expect(scale).toBeLessThan(1);
    for (const n of notes) {
      const tl = toScreen(n.x, n.y);
      expect(tl.x).toBeGreaterThanOrEqual(0);
      expect(tl.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('restoreViewport：卡片只是被窗口挤到边缘外一点点，不算失效', () => {
    // 卡片在世界 (0,0)，视野从 x=300 开始 → 差 40px 没进画面，但在 160 的容差内
    const vp = { panX: -300, panY: 0, scale: 1 };
    expect(restoreViewport(vp, [{ x: 0, y: 0, width: 260, height: 184 }])).toBe('restored');
    expect(get()).toEqual(vp);
  });

  it('onChange 只在值真的变了时触发', () => {
    const spy = vi.fn();
    const off = onChange(spy);

    set({ panX: 0, panY: 0, scale: 1 }); // 无变化
    expect(spy).not.toHaveBeenCalled();

    panBy(1, 0);
    expect(spy).toHaveBeenCalledTimes(1);

    const tiny = 1e-9; // 小于 EPS 的抖动不算变化
    panBy(tiny, 0);
    expect(spy).toHaveBeenCalledTimes(1);

    off();
    panBy(50, 0);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
