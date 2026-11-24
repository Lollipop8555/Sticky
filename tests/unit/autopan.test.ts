import { afterEach, describe, expect, it } from 'vitest';

import { createAutoPan, EDGE, edgeVelocity, MAX_SPEED } from '@/canvas/autopan';
import { get, set, toScreen } from '@/canvas/viewport';

const VW = 1280;
const VH = 720;

function speed(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y);
}

afterEach(() => {
  set({ panX: 0, panY: 0, scale: 1 });
});

describe('边缘速度', () => {
  it('中间区域不动', () => {
    expect(edgeVelocity(VW / 2, VH / 2, VW, VH)).toEqual({ x: 0, y: 0 });
    expect(edgeVelocity(EDGE + 1, EDGE + 1, VW, VH)).toEqual({ x: 0, y: 0 });
  });

  /**
   * 方向必须按"内容往哪边挪"来断：贴左边缘 → 画面右移（pan 变大）。
   * 这条曾经写反过，拖卡贴边时新内容从反方向钻出来。
   */
  it('四个方向都把内容推向远离边缘的一侧', () => {
    expect(edgeVelocity(0, VH / 2, VW, VH).x).toBe(MAX_SPEED);
    expect(edgeVelocity(VW, VH / 2, VW, VH).x).toBe(-MAX_SPEED);
    expect(edgeVelocity(VW / 2, 0, VW, VH).y).toBe(MAX_SPEED);
    expect(edgeVelocity(VW / 2, VH, VW, VH).y).toBe(-MAX_SPEED);
  });

  it('边缘带内是渐变：一半位置的速度按 (0.5)^1.5 衰减', () => {
    const v = edgeVelocity(EDGE / 2, VH / 2, VW, VH);
    expect(v.x).toBeCloseTo(MAX_SPEED * Math.pow(0.5, 1.5), 6);
  });

  it('指针甩出窗口也不会超速（比例夹到 1）', () => {
    expect(edgeVelocity(-500, VH / 2, VW, VH).x).toBe(MAX_SPEED);
    expect(speed(edgeVelocity(-500, VH + 900, VW, VH))).toBeCloseTo(MAX_SPEED, 6);
  });

  it('贴角时向量归一化：对角速度不超过 MAX_SPEED', () => {
    const v = edgeVelocity(0, 0, VW, VH);
    expect(speed(v)).toBeCloseTo(MAX_SPEED, 6);
    expect(v.x).toBeCloseTo(MAX_SPEED / Math.SQRT2, 6);
  });
});

describe('帧积分', () => {
  it('贴左边缘 0.1s → 世界原点右移 60px（画面跟着右移，露出左侧内容）', () => {
    const autopan = createAutoPan();
    // 世界坐标 (0,0) 在屏幕上的位置：正速度把它往右推
    const anchor = toScreen(0, 0).x;
    autopan.update(0, VH / 2);
    expect(autopan.tick(0.1)).toBe(true);
    expect(get().panX).toBeCloseTo(MAX_SPEED * 0.1, 6);
    expect(get().panY).toBe(0);
    expect(toScreen(0, 0).x).toBeGreaterThan(anchor);
  });

  it('贴右边缘 0.1s → panX 减小（内容左移）', () => {
    const autopan = createAutoPan();
    autopan.update(VW, VH / 2);
    expect(autopan.tick(0.1)).toBe(true);
    expect(get().panX).toBeCloseTo(-MAX_SPEED * 0.1, 6);
  });

  it('中间区域 tick 返回 false，不动视野', () => {
    const autopan = createAutoPan();
    autopan.update(VW / 2, VH / 2);
    expect(autopan.tick(0.016)).toBe(false);
    expect(get().panX).toBe(0);
  });

  it('stop 之后不再平移（松手即失效，即便还排着一帧）', () => {
    const autopan = createAutoPan();
    autopan.update(0, VH / 2);
    autopan.stop();
    expect(autopan.tick(0.1)).toBe(false);
    expect(get().panX).toBe(0);
  });

  it('dt<=0 不积分：标签页切回时不能瞬移', () => {
    const autopan = createAutoPan();
    autopan.update(0, VH / 2);
    expect(autopan.tick(0)).toBe(false);
    expect(get().panX).toBe(0);
  });
});
