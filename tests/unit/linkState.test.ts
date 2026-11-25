import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetPrefs, getLinks, initPrefs } from '@/app/prefs';
import { addLink, initLinks, linkIndex, mergeLinks, onLinksChange, pruneLinks, removeLink } from '@/link/state';
import { FALLBACK_PREFS } from '@/storage/repo';
import { configureWriteQueue } from '@/storage/writeQueue';

/**
 * 状态层是两条真相（prefs 落库 + 内存索引）的唯一通道：
 * 写操作必须**同时**改索引、写 prefs、发通知，少一样就会出现
 * "菜单数字变了但线还在"这种分叉（曾经真的踩到）。
 */

describe('link state', () => {
  beforeEach(() => {
    // setLinks 会 markPrefsDirty → 写队列必须先有实例，否则直接抛
    configureWriteQueue({
      putNotes: async () => undefined,
      delNotes: async () => undefined,
      savePrefs: async () => undefined,
    });
    __resetPrefs();
    initPrefs(FALLBACK_PREFS);
    initLinks([]);
  });

  it('addLink：改索引 + 写 prefs + 发一次通知；重复添加是空操作', () => {
    const fn = vi.fn();
    const off = onLinksChange(fn);

    expect(addLink('b', 'a')).toBe(true);
    expect(linkIndex().pairs()).toEqual([['a', 'b']]);
    expect(getLinks()).toEqual([['a', 'b']]);
    expect(fn).toHaveBeenCalledTimes(1);

    // 反向重复 / 自连都不算变化，不能再发通知
    expect(addLink('a', 'b')).toBe(false);
    expect(addLink('a', 'a')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);

    off();
  });

  it('removeLink：断开后两端都不再相邻；重复断开是空操作', () => {
    initLinks([
      ['a', 'b'],
      ['a', 'c'],
    ]);
    const fn = vi.fn();
    const off = onLinksChange(fn);

    expect(removeLink('b', 'a')).toBe(true);
    expect(linkIndex().neighbors('a')).toEqual(['c']);
    expect(linkIndex().neighbors('b')).toEqual([]);
    expect(getLinks()).toEqual([['a', 'c']]);
    expect(fn).toHaveBeenCalledTimes(1);

    expect(removeLink('a', 'b')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);

    off();
  });

  it('mergeLinks：并进本地边集，返回真正新增的条数', () => {
    initLinks([['a', 'b']]);

    expect(
      mergeLinks([
        ['b', 'a'],
        ['c', 'd'],
        ['c', 'd'],
      ]),
    ).toBe(1);
    expect(linkIndex().pairs()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(getLinks()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // 没有新增就不该写库/发通知
    expect(mergeLinks([['a', 'b']])).toBe(0);
  });

  it('pruneLinks：只留两端都还活着的边（清空回收站时才调）', () => {
    initLinks([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);

    expect(pruneLinks(new Set(['a', 'b', 'c']))).toBe(1);
    expect(linkIndex().pairs()).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    // 全活时不动索引，也不清空
    expect(pruneLinks(new Set(['a', 'b', 'c']))).toBe(0);
  });
});
