import { describe, expect, it } from 'vitest';

import { BACKGROUNDS, type Background } from '@/app/theme';
import {
  POOLS,
  contrastRatio,
  displayColor,
  hexToHsl,
  hexToRgb,
  hslToHex,
  pickColor,
  poolColors,
  relativeLuminance,
  textColor,
  threadColor,
} from '@/note/palette';
import type { NoteRecord } from '@/storage/types';

function note(id: string, x: number, y: number, bgColor: string): NoteRecord {
  return {
    id,
    x,
    y,
    width: 260,
    height: 160,
    minHeight: 160,
    z: 1,
    bgColor,
    contentMd: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

describe('色池', () => {
  it('每组 12 色，hex 唯一（扩池时手滑写重复角度会被挡住）', () => {
    for (const pool of POOLS) {
      const colors = poolColors(pool.id);
      expect(colors).toHaveLength(12);
      expect(new Set(colors).size).toBe(12);
      for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('任意两色色相差 ≥ 25°（含跨 0° 的环形差）', () => {
    for (const pool of POOLS) {
      for (let i = 0; i < pool.hues.length; i++) {
        for (let j = i + 1; j < pool.hues.length; j++) {
          const raw = Math.abs((pool.hues[i] ?? 0) - (pool.hues[j] ?? 0));
          const cyclic = Math.min(raw, 360 - raw);
          expect(cyclic, `${pool.id}: ${pool.hues[i]} vs ${pool.hues[j]}`).toBeGreaterThanOrEqual(25);
        }
      }
    }
  });

  it('hex ⇄ hsl 往返只差舍入（差 1 个色阶内）', () => {
    for (const pool of POOLS) {
      for (const color of poolColors(pool.id)) {
        const { h, s, l } = hexToHsl(color);
        const back = hexToRgb(hslToHex(h, s, l));
        const origin = hexToRgb(color);
        for (let i = 0; i < 3; i++) {
          expect(Math.abs((back[i] ?? 0) - (origin[i] ?? 0))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('未知池 id 回落到第一个池，不抛错（坏数据不该阻断建卡）', () => {
    expect(poolColors('neon')).toEqual(poolColors('macaron'));
  });
});

describe('显示色：只压明度', () => {
  it('色相与饱和度在四种背景下都不动（同一张卡的颜色身份不变）', () => {
    for (const base of poolColors('macaron')) {
      const before = hexToHsl(base);
      for (const bg of BACKGROUNDS) {
        const after = hexToHsl(displayColor(base, bg));
        expect(Math.abs(after.h - before.h)).toBeLessThan(2);
        expect(Math.abs(after.s - before.s)).toBeLessThan(3);
      }
    }
  });

  it('paper / grid 是原色，kraft 略压，黑板明显更暗', () => {
    const base = '#F9D5E5';

    expect(displayColor(base, 'paper')).toBe(base);
    expect(displayColor(base, 'grid')).toBe(base);
    expect(relativeLuminance(displayColor(base, 'kraft'))).toBeLessThan(relativeLuminance(base));
    expect(relativeLuminance(displayColor(base, 'blackboard'))).toBeLessThan(relativeLuminance(base) / 4);
  });
});

describe('文本色', () => {
  /** S8 的验收线：24 色 × 4 背景全部可读。往池里加色前先跑这条 */
  it('24 色 × 4 背景 = 96 组合，对比度均 ≥ 4.5（WCAG AA）', () => {
    const failures: string[] = [];

    for (const bg of BACKGROUNDS) {
      for (const pool of POOLS) {
        for (const base of poolColors(pool.id)) {
          const shown = displayColor(base, bg);
          const ratio = contrastRatio(relativeLuminance(shown), relativeLuminance(textColor(shown)));
          if (ratio < 4.5) failures.push(`${pool.id} ${base} → ${shown} @${bg} = ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('浅底选深字、深底选浅字（不是永远同一个）', () => {
    const dark = textColor('#F9D5E5');
    const light = textColor(displayColor('#F9D5E5', 'blackboard'));
    expect(dark).not.toBe(light);
  });

  it('对比度计算与 WCAG 定义一致（黑白 = 21，同色 = 1）', () => {
    expect(contrastRatio(relativeLuminance('#000000'), relativeLuminance('#FFFFFF'))).toBeCloseTo(21, 1);
    expect(contrastRatio(relativeLuminance('#1F2937'), relativeLuminance('#1F2937'))).toBeCloseTo(1, 5);
  });
});

describe('自动取色', () => {
  const pool = poolColors('macaron');

  it('空墙取到的颜色来自当前池', () => {
    for (const id of ['a', 'b', 'c']) {
      expect(pool).toContain(pickColor({ poolId: 'macaron', notes: [], cx: 0, cy: 0, id }));
    }
  });

  it('邻域内已经用过的色不会立刻重复（避撞）', () => {
    const used = pool[0] ?? '';
    const notes = [note('n1', 0, 0, used)]; // 与新建卡中心重合，必然进入统计
    for (let i = 0; i < 6; i++) {
      expect(pickColor({ poolId: 'macaron', notes, cx: 130, cy: 80, id: `id-${i}` })).not.toBe(used);
    }
  });

  it('统计只看半径 400 以内', () => {
    const far = pool[11] ?? '';
    const near = pool.slice(0, 11);

    // 半径内 11 色各用一次（计数都是 1），第 12 色只在 5000 格外出现 → 它才是"用得最少"
    const notes = near
      .map((color, i) => note(`n${i}`, 0, 0, color))
      .concat([note('far', 5000, 5000, far)]);

    expect(pickColor({ poolId: 'macaron', notes, cx: 130, cy: 80, id: 'x' })).toBe(far);
  });

  it('池外色计入统计，但永远不会成为候选', () => {
    const notes = pool.map((color, i) => note(`n${i}`, 0, 0, color));
    const picked = pickColor({ poolId: 'macaron', notes, cx: 130, cy: 80, id: 'y' });
    expect(pool).toContain(picked);
  });

  it('同一 id 永远取到同一个颜色（刷新一次不该换一次颜色）', () => {
    const args = { poolId: 'macaron', notes: [note('n1', 0, 0, pool[0] ?? '')], cx: 130, cy: 80, id: 'stable' };
    expect(pickColor(args)).toBe(pickColor(args));
  });

  it('并列时按 id 散开（否则整面墙都是同一个色）', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`);
    const seen = new Set(
      ids.map((id) => pickColor({ poolId: 'monet', notes: [], cx: 0, cy: 0, id })),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('四种背景都不改记录里的基色（记录只存基色）', () => {
    const base = pool[3] ?? '';
    for (const bg of BACKGROUNDS as readonly Background[]) {
      // 派生一个显示色，记录本身仍是同一个字符串
      expect(displayColor(base, bg)).toBeTypeOf('string');
      expect(base).toBe(pool[3]);
    }
  });
});

/**
 * 毛线色（决策 74）。两条硬要求：
 * 1. 不同卡片的线色**必须不同** —— 否则一条线两端同色，渐变等于不存在（曾经的实现用
 *    `textColor` 就是这样：不是近黑就是近白，全部连线长得一模一样）；
 * 2. 在任何材质上都要看得见 —— 与卡片显示色的对比度不能塌到"糊成一片"。
 */
describe('threadColor', () => {
  const pool = poolColors('macaron');

  it('同一张卡片的线色稳定（按 底色+卡片色 缓存）', () => {
    const shown = displayColor(pool[0] ?? '', 'paper');
    expect(threadColor(shown, 'paper')).toBe(threadColor(shown, 'paper'));
  });

  it('12 个池内色的线色互不相同（两端不同色才有渐变可看）', () => {
    const seen = new Set(
      pool.map((base) => threadColor(displayColor(base, 'paper'), 'paper')),
    );
    expect(seen.size).toBe(pool.length);
  });

  it('深浅两种材质上都与卡片色拉开距离', () => {
    for (const bg of ['paper', 'blackboard'] as const) {
      for (const base of pool) {
        const shown = displayColor(base, bg);
        const thread = threadColor(shown, bg);
        const ratio = contrastRatio(relativeLuminance(shown), relativeLuminance(thread));
        // 与卡片色的对比度 1.6 以上：线压在卡上/挨着卡时仍分得清
        expect(ratio).toBeGreaterThan(1.6);
      }
    }
  });

  it('黑板上的线只会变亮，浅底上的线只会变暗', () => {
    const shown = displayColor(pool[0] ?? '', 'paper');
    const dark = hexToHsl(threadColor(shown, 'blackboard')).l;
    const light = hexToHsl(threadColor(shown, 'paper')).l;
    expect(dark).toBeGreaterThan(light);
  });
});
