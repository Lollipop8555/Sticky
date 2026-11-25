import { describe, expect, it } from 'vitest';

import { createLinkIndex, linkKey, normalizeLinks, normalizePair } from '@/link/links';

describe('linkKey / normalizePair', () => {
  it('无向：a|b 与 b|a 是同一个键', () => {
    expect(linkKey('a', 'b')).toBe(linkKey('b', 'a'));
    expect(linkKey('b', 'a')).toBe('a|b');
  });

  it('自连不成立', () => {
    expect(normalizePair('a', 'a')).toBeNull();
    expect(normalizePair('', 'b')).toBeNull();
  });

  it('归一时按字典序交换', () => {
    expect(normalizePair('b', 'a')).toEqual(['a', 'b']);
  });
});

describe('normalizeLinks（外部数据入口）', () => {
  it('非数组 / 垃圾项直接丢，不抛错', () => {
    expect(normalizeLinks(undefined)).toEqual([]);
    expect(normalizeLinks('x')).toEqual([]);
    expect(normalizeLinks([null, 1, ['a'], ['a', 1]])).toEqual([]);
  });

  it('自连、重复、反向重复都收敛成一条', () => {
    const raw = [
      ['b', 'a'],
      ['a', 'b'],
      ['a', 'a'],
      ['a', 'b'],
      ['c', 'b'],
    ];
    expect(normalizeLinks(raw)).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });

  it('保留首次出现顺序（导入后的显示顺序稳定）', () => {
    expect(normalizeLinks([['c', 'd'], ['a', 'b']])).toEqual([
      ['c', 'd'],
      ['a', 'b'],
    ]);
  });
});

describe('createLinkIndex', () => {
  it('add 幂等，反向 add 也是同一条', () => {
    const idx = createLinkIndex();
    idx.add('b', 'a');
    idx.add('a', 'b');

    expect(idx.size()).toBe(1);
    expect(idx.pairs()).toEqual([['a', 'b']]);
    expect(idx.has('a', 'b')).toBe(true);
    expect(idx.has('b', 'a')).toBe(true);
  });

  it('自连被忽略', () => {
    const idx = createLinkIndex();
    idx.add('a', 'a');
    expect(idx.size()).toBe(0);
    expect(idx.has('a', 'a')).toBe(false);
  });

  it('add 无变化时返回同一个数组引用（paint 靠引用判断要不要重绘）', () => {
    const idx = createLinkIndex([['a', 'b']]);
    const before = idx.pairs();
    expect(idx.add('b', 'a')).toBe(before);
  });

  it('neighbors 按插入序返回，且是副本', () => {
    const idx = createLinkIndex([['a', 'c'], ['a', 'b']]);
    expect(idx.neighbors('a')).toEqual(['c', 'b']);
    expect(idx.degree('a')).toBe(2);
    expect(idx.degree('zzz')).toBe(0);

    const list = idx.neighbors('a');
    list.push('hack');
    expect(idx.neighbors('a')).toEqual(['c', 'b']);
  });

  it('remove 双向摘干净，重复 remove 无副作用', () => {
    const idx = createLinkIndex([['a', 'b'], ['a', 'c']]);
    idx.remove('b', 'a');

    expect(idx.size()).toBe(1);
    expect(idx.neighbors('a')).toEqual(['c']);
    expect(idx.neighbors('b')).toEqual([]);
    expect(idx.remove('a', 'b')).toBe(idx.pairs());
  });

  it('replaceAll 重建索引并返回新增条数（导入摘要用）', () => {
    const idx = createLinkIndex([['a', 'b']]);
    const added = idx.replaceAll([['a', 'b'], ['c', 'd'], ['c', 'd']]);

    expect(added).toBe(1);
    expect(idx.pairs()).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(idx.degree('c')).toBe(1);
  });

  it('初始数据也过一遍校验（库里读到的坏形状不该进索引）', () => {
    const idx = createLinkIndex([['a', 'a'], ['a', 'b'], ['a', 'b']] as const);
    expect(idx.pairs()).toEqual([['a', 'b']]);
  });
});
