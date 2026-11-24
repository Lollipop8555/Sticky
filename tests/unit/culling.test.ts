import { afterEach, describe, expect, it } from 'vitest';

import { CULL_FACTOR, FULL_MOUNT_LIMIT, intersects, needsCulling, visibleRect } from '@/canvas/culling';
import { set } from '@/canvas/viewport';

/** jsdom 默认窗口 1024×768 */
const VIEW_W = 1024;
const VIEW_H = 768;

afterEach(() => {
  set({ panX: 0, panY: 0, scale: 1 });
});

describe('AABB 求交', () => {
  const view = { x: 0, y: 0, width: 100, height: 100 };

  it('相交与包含都算看见', () => {
    expect(intersects(view, { x: 90, y: 90, width: 20, height: 20 })).toBe(true);
    expect(intersects(view, { x: -50, y: -50, width: 60, height: 60 })).toBe(true);
    expect(intersects(view, { x: 10, y: 10, width: 5, height: 5 })).toBe(true); // 完全在内
    expect(intersects(view, { x: -10, y: -10, width: 200, height: 200 })).toBe(true); // 完全包住
  });

  it('贴边不算相交（边界靠外扩缓冲兜住）', () => {
    expect(intersects(view, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
    expect(intersects(view, { x: 0, y: -10, width: 10, height: 10 })).toBe(false);
    expect(intersects(view, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });
});

describe('可见世界矩形', () => {
  it('scale=1、pan=0：以视口为中心，尺寸外扩 1.5 倍', () => {
    const rect = visibleRect();
    expect(rect.width).toBeCloseTo(VIEW_W * CULL_FACTOR, 6);
    expect(rect.height).toBeCloseTo(VIEW_H * CULL_FACTOR, 6);
    expect(rect.x + rect.width / 2).toBeCloseTo(VIEW_W / 2, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo(VIEW_H / 2, 6);
  });

  it('跟着 pan/scale 走：世界矩形 = 屏幕矩形 / scale', () => {
    set({ panX: 100, panY: 50, scale: 0.5 });
    const rect = visibleRect();
    expect(rect.width).toBeCloseTo((VIEW_W * CULL_FACTOR) / 0.5, 6);
    expect(rect.x + rect.width / 2).toBeCloseTo((VIEW_W / 2 - 100) / 0.5, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo((VIEW_H / 2 - 50) / 0.5, 6);
    expect(intersects(rect, { x: 900, y: 600, width: 260, height: 160 })).toBe(true);
  });
});

describe('全量路径上限', () => {
  it('不到 200 张不剔除', () => {
    expect(needsCulling(FULL_MOUNT_LIMIT - 1)).toBe(false);
    expect(needsCulling(FULL_MOUNT_LIMIT)).toBe(true);
  });
});
