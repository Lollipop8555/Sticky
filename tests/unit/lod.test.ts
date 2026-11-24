import { describe, expect, it } from 'vitest';

import {
  applyLevel,
  BLOCK_SCALE,
  CLUSTER_SCALE,
  LOD,
  levelFor,
  textMinScale,
  textReadable,
} from '@/canvas/lod';

/** 默认字号 16px 下的可辨认下限（tokens 里 --s-text-min 是同一个数的落点） */
const S_TEXT_MIN = 7 / 16;

describe('LOD 判级', () => {
  it('按 scale 从近到远分四档', () => {
    expect(levelFor(1, S_TEXT_MIN)).toBe(LOD.FULL);
    expect(levelFor(0.8, S_TEXT_MIN)).toBe(LOD.FULL);
    expect(levelFor(BLOCK_SCALE, S_TEXT_MIN)).toBe(LOD.FULL); // 恰好等于阈值仍算全量
    expect(levelFor(BLOCK_SCALE - 0.001, S_TEXT_MIN)).toBe(LOD.TEXT);
    expect(levelFor(0.45, S_TEXT_MIN)).toBe(LOD.TEXT);
    expect(levelFor(S_TEXT_MIN - 0.001, S_TEXT_MIN)).toBe(LOD.BLOCK);
    expect(levelFor(CLUSTER_SCALE, S_TEXT_MIN)).toBe(LOD.BLOCK);
    expect(levelFor(CLUSTER_SCALE - 0.001, S_TEXT_MIN)).toBe(LOD.CLUSTER);
  });

  it('字号调到 10px 后文本档被挤掉，不会露出读不清的字', () => {
    const big = textMinScale(10); // 0.7 > BLOCK_SCALE
    expect(big).toBeCloseTo(0.7, 6);
    // 0.65 落在 [0.6, 0.7)：先判 `< 0.6` 的实现会错给 TEXT，正确结果是 BLOCK
    expect(levelFor(0.65, big)).toBe(LOD.BLOCK);
    expect(levelFor(0.72, big)).toBe(LOD.FULL);
  });

  it('正文可读只到 TEXT 档：色块与聚合档都算「看不见」', () => {
    expect(textReadable(1)).toBe(true);
    expect(textReadable(BLOCK_SCALE)).toBe(true);
    expect(textReadable(0.5)).toBe(true); // TEXT 档：字小但还在
    expect(textReadable(S_TEXT_MIN - 0.001)).toBe(false); // BLOCK
    expect(textReadable(CLUSTER_SCALE)).toBe(false); // CLUSTER
    expect(textReadable(0.05)).toBe(false);
  });

  it('只写一次 dataset：值没变就不碰 DOM', () => {
    const world = document.createElement('div');
    expect(world.dataset['lod']).toBeUndefined();

    expect(applyLevel(world, LOD.TEXT)).toBe(true);
    expect(world.dataset['lod']).toBe('1');
    expect(applyLevel(world, LOD.TEXT)).toBe(false);
    expect(applyLevel(world, LOD.BLOCK)).toBe(true);
    expect(world.dataset['lod']).toBe('2');
  });
});
