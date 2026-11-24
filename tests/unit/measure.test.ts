import { describe, expect, it } from 'vitest';

import { MIN_NOTE_HEIGHT, measureHeight } from '@/note/measure';

/** 只关心 offsetHeight 这一个读数，不必造真元素 */
function fakeEl(offsetHeight: number): HTMLElement {
  return { offsetHeight } as HTMLElement;
}

describe('measureHeight', () => {
  it('内容撑高时取实测值（四舍五入到整像素）', () => {
    expect(measureHeight(fakeEl(183.6))).toBe(184);
    expect(measureHeight(fakeEl(320))).toBe(320);
  });

  it('低于下限时取 minHeight：空便签也要像一个便签', () => {
    expect(measureHeight(fakeEl(48))).toBe(MIN_NOTE_HEIGHT);
    expect(measureHeight(fakeEl(0))).toBe(MIN_NOTE_HEIGHT); // jsdom / 未挂载
  });

  it('minHeight 来自记录（以后允许单卡自定义）', () => {
    expect(measureHeight(fakeEl(100), 220)).toBe(220);
  });
});
