import { beforeEach, describe, expect, it } from 'vitest';

import {
  BACKGROUNDS,
  CANVAS_THEME_COLOR,
  applyBackground,
  applyPalette,
  isBackground,
  isPaletteId,
} from '@/app/theme';

describe('背景类型守卫', () => {
  it('接受四种合法材质', () => {
    for (const bg of BACKGROUNDS) expect(isBackground(bg)).toBe(true);
  });

  it('拒绝非法值（含 null / undefined / 数字 / 大小写不符）', () => {
    for (const bad of [null, undefined, 0, '', 'Paper', 'black', {}, ['paper']]) {
      expect(isBackground(bad)).toBe(false);
    }
  });

  it('调色池 id 只认 macaron / monet', () => {
    expect(isPaletteId('macaron')).toBe(true);
    expect(isPaletteId('monet')).toBe(true);
    expect(isPaletteId('Macaron')).toBe(false);
    expect(isPaletteId('neon')).toBe(false);
  });
});

describe('applyBackground', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-background');
    document.documentElement.removeAttribute('style');
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
  });

  it('写 dataset 与 theme-color', () => {
    applyBackground('kraft', document);

    expect(document.documentElement.dataset['background']).toBe('kraft');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta?.content).toBe(CANVAS_THEME_COLOR.kraft);
  });

  it('每种材质的 theme-color 都取自同一张表（防两处硬编码漂移）', () => {
    for (const bg of BACKGROUNDS) {
      applyBackground(bg, document);
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      expect(meta?.content).toBe(CANVAS_THEME_COLOR[bg]);
    }
  });

  it('黑板下把 color-scheme 切成 dark，让原生控件跟随', () => {
    applyBackground('blackboard', document);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyBackground('paper', document);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('meta 缺失时不抛错（页面可能被内嵌在无 head 的场景里）', () => {
    document.head.innerHTML = '';
    expect(() => applyBackground('grid', document)).not.toThrow();
    expect(document.documentElement.dataset['background']).toBe('grid');
  });
});

describe('applyPalette', () => {
  it('只写 dataset，不改任何卡片颜色', () => {
    applyPalette('monet', document);
    expect(document.documentElement.dataset['palette']).toBe('monet');
  });
});
