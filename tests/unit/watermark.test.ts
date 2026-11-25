import { describe, expect, it } from 'vitest';

import {
  buildWatermarkSvg,
  estimateTextWidth,
  tileSize,
  watermarkCssUrl,
  watermarkFontSize,
} from '@/io/watermark';

/**
 * 水印是"用户输入的文本拼进 SVG"—— 转义与尺寸公式是这里唯一能离线验证的两件事，
 * 至于"图上到底有没有字"，只有 e2e 解码像素说得清（见 `tests/e2e/watermark.spec.ts`）。
 */

const spec = { text: 'Sticky Wall', width: 320, height: 320, ink: '#1F2937' };

describe('文字宽度估算', () => {
  it('中文按全角 1em 计，ASCII 窄一档', () => {
    const fs = 10;
    // 两个汉字 = 2em；"ab" = 2 × 0.54em
    expect(estimateTextWidth('中文', fs)).toBeCloseTo(20, 5);
    expect(estimateTextWidth('ab', fs)).toBeCloseTo(10.8, 5);
  });

  it('空白比字母更窄', () => {
    expect(estimateTextWidth(' ', 10)).toBeLessThan(estimateTextWidth('a', 10));
  });
});

describe('尺寸与字号', () => {
  it('字号跟短边走，且被上下限钳住', () => {
    expect(watermarkFontSize(320, 320)).toBe(10);
    expect(watermarkFontSize(4096, 4096)).toBe(64);
    // 极小的图（比如 60px 的空卡）不该缩到看不见，也不该大到只剩一个字
    expect(watermarkFontSize(60, 60)).toBe(9);
  });

  it('tile 的高度就是行距，宽度至少容得下文字加间距', () => {
    const { w, h } = tileSize('Sticky Wall', 10);
    expect(h).toBe(32);
    expect(w).toBeGreaterThan(estimateTextWidth('Sticky Wall', 10));
  });
});

describe('SVG 生成', () => {
  it('铺满整层，旋转与透明度写在 pattern 里', () => {
    const svg = buildWatermarkSvg(spec);
    expect(svg).toContain('patternTransform="rotate(-24)"');
    expect(svg).toContain('fill-opacity="0.14"');
    expect(svg).toContain('<rect width="100%" height="100%"');
    expect(svg).toContain('>Sticky Wall<');
  });

  it('用户文字一律转义，不能把 SVG 结构写坏', () => {
    const svg = buildWatermarkSvg({ ...spec, text: '<b>&"你好\'' });
    expect(svg).toContain('&lt;b&gt;&amp;&quot;你好&apos;');
    expect(svg).not.toContain('<b>');
  });

  it('墨色进 fill，且不会带出未转义的引号', () => {
    const svg = buildWatermarkSvg({ ...spec, ink: 'rgb(31, 41, 55)' });
    expect(svg).toContain('fill="rgb(31, 41, 55)"');
  });

  it('data URI 里的中文被百分号编码，URL 才不会在部分浏览器里截断', () => {
    const url = watermarkCssUrl({ ...spec, text: '水印' });
    expect(url.startsWith('url("data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('水印');
    expect(url).toContain('%E6%B0%B4%E5%8D%B0');
  });
});
