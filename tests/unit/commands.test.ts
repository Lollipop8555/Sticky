import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/app/commands';
import { __resetPrefs } from '@/app/prefs';
import { __resetStore, store } from '@/app/store';
import { configureWriteQueue } from '@/storage/writeQueue';

function fakeQueue(): void {
  configureWriteQueue({
    putNotes: async () => undefined,
    delNotes: async () => undefined,
    savePrefs: async () => undefined,
  });
}

describe('commands', () => {
  beforeEach(() => {
    __resetStore();
    __resetPrefs();
    fakeQueue();
  });

  afterEach(() => {
    __resetStore();
  });

  it('create 以落点为中心建卡（默认 320 见方 / 顶层 z）', () => {
    const note = commands.create({ world: { x: 500, y: 400 } });

    expect(note.width).toBe(320);
    expect(note.height).toBe(320);
    expect(note.minHeight).toBe(320);
    expect(note.x).toBe(500 - 160);
    expect(note.y).toBe(400 - 160);
    expect(note.z).toBeGreaterThan(0);
    expect(note.deletedAt).toBeNull();
    expect(store.getNote(note.id)).toEqual(note);
  });

  it('z 单调递增：连续建卡不会出现同层', () => {
    const a = commands.create({ world: { x: 0, y: 0 } });
    const b = commands.create({ world: { x: 900, y: 0 } });
    expect(b.z).toBeGreaterThan(a.z);
  });

  it('落点与已有卡重叠 > 30% 时向右下试探（避免"点了没看见新卡"）', () => {
    const first = commands.create({ world: { x: 500, y: 400 } });
    const second = commands.create({ world: { x: 500, y: 400 } });

    expect(second.id).not.toBe(first.id);

    const dx = second.x - first.x;
    const dy = second.y - first.y;
    // 用记录自己的宽高算，避免默认尺寸一改就要跟着改这条断言
    const overlap = ((first.width - dx) * (first.height - dy)) / (first.width * first.height);
    // 断言的是"不再挤在一起"这件事，而不是具体挪了几步（步长调整不该让测试失败）
    expect(overlap).toBeLessThan(0.3);
    expect(dx).toBeGreaterThan(0);
  });

  it('内容没变就不 commit（否则 updatedAt 抖动、写队列白写）', () => {
    const note = commands.create({ world: { x: 0, y: 0 } });
    const listener = vi.fn();
    store.subscribeNotes(listener);

    commands.updateContent(note.id, ''); // 与初始值相同
    expect(listener).not.toHaveBeenCalled();

    commands.updateContent(note.id, 'hi');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getNote(note.id)?.contentMd).toBe('hi');
  });

  it('setHeight 带容差：亚像素级差异不写库', () => {
    const note = commands.create({ world: { x: 0, y: 0 } });
    const listener = vi.fn();
    store.subscribeNotes(listener);

    commands.setHeight(note.id, note.height + 1, 2); // 1px 偏差，容差 2 → 忽略
    expect(listener).not.toHaveBeenCalled();

    commands.setHeight(note.id, note.height + 40, 2);
    expect(store.getNote(note.id)?.height).toBe(note.height + 40);
  });

  it('setHeight 不会把卡片压到 minHeight 以下', () => {
    const note = commands.create({ world: { x: 0, y: 0 } });
    commands.setHeight(note.id, 20);
    expect(store.getNote(note.id)?.height).toBe(note.minHeight);
  });

  it('bringToFront 提高 z（编辑中的卡要在最上面）', () => {
    const a = commands.create({ world: { x: 0, y: 0 } });
    const b = commands.create({ world: { x: 900, y: 0 } });

    commands.bringToFront(a.id);
    expect((store.getNote(a.id)?.z ?? 0) > (store.getNote(b.id)?.z ?? 0)).toBe(true);
  });

  it('操作不存在的 id 是安全空操作（竞态：卡刚被删）', () => {
    expect(() => commands.updateContent('nope', 'x')).not.toThrow();
    expect(() => commands.setHeight('nope', 200)).not.toThrow();
    expect(() => commands.bringToFront('nope')).not.toThrow();
  });
});
