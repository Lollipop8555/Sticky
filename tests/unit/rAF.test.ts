import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onFrame, scheduleFrame, stopFrameLoop } from '@/canvas/rAF';

/**
 * 用自己的帧队列替换 rAF：真实 rAF 要等 16ms，测试里既慢又不确定。
 * 这里让「一帧」变成一次显式的 flush()，调度行为就能精确断言。
 */
let queue: FrameRequestCallback[] = [];

function flush(now: number): void {
  const pending = queue;
  queue = [];
  for (const cb of pending) cb(now);
}

describe('rAF 调度', () => {
  beforeEach(() => {
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    stopFrameLoop();
  });

  it('同一帧内多次 scheduleFrame 只排一次', () => {
    scheduleFrame();
    scheduleFrame();
    scheduleFrame();
    expect(queue).toHaveLength(1);
  });

  it('空闲时不常驻：跑完没有新调度就彻底停下', () => {
    const fn = vi.fn();
    onFrame(fn);

    scheduleFrame();
    flush(16);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0); // 关键：没有再排下一帧

    // 时间过去了也不会自己再跑
    flush(33);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('回调里再调度 → 自我续命（autopan 就靠这个）', () => {
    let frames = 0;
    onFrame(() => {
      frames++;
      if (frames < 3) scheduleFrame();
    });

    scheduleFrame();
    flush(16);
    flush(32);
    flush(48);

    expect(frames).toBe(3);
    expect(queue).toHaveLength(0);
  });

  it('dt 以秒为单位，且被夹在 1/30 秒内（切后台回来不会瞬移）', () => {
    const seen: number[] = [];
    let frames = 0;
    onFrame((dt) => {
      seen.push(dt);
      if (++frames < 2) scheduleFrame(); // 连续动画（如 autopan）会自我续命
    });

    scheduleFrame();
    flush(16); // 首帧固定 1/60
    flush(16016); // 隔了 16 秒：dt 必须被夹住，否则贴边平移会瞬移半屏

    expect(seen[0]).toBeCloseTo(1 / 60, 6);
    expect(seen[1]).toBeCloseTo(1 / 30, 6);
  });

  it('回调里退订不影响同帧其它回调', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onFrame(() => {
      a();
      offA();
    });
    onFrame(b);

    scheduleFrame();
    flush(16);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
