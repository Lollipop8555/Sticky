import { describe, expect, it } from 'vitest';

import { buildSign } from '@/note/sign';

/**
 * 尾签文字（决策 90）。只测这个纯函数：两条线怎么画、有没有真的居中，
 * 归 e2e（见 `tests/e2e/sign.spec.ts` 里的几何断言）。
 *
 * 这里特意**没有**"两侧各六个短横线"之类的用例：那正是当初做错的方向
 * —— 线是 CSS 画的，一旦变成字符串拼接，长文字就再也对不齐了。
 */
describe('尾签文字', () => {
  it('关着时没有尾签', () => {
    expect(buildSign(false, '阿洛', 'Sticky Wall')).toBeNull();
  });

  it('开着时就是用户那句话，不含任何装饰字符', () => {
    expect(buildSign(true, '阿洛', 'Sticky Wall')).toBe('阿洛');
    expect(buildSign(true, '阿洛', 'Sticky Wall')).not.toContain('-');
  });

  it('内容为空回落到默认文案，不是一行光秃秃的线', () => {
    expect(buildSign(true, '', 'Sticky Wall')).toBe('Sticky Wall');
    expect(buildSign(true, '   ', 'Sticky Wall')).toBe('Sticky Wall');
  });

  it('两端的空白被裁掉，用户多敲的空格不该变成尾签的一部分', () => {
    expect(buildSign(true, '  阿洛  ', 'Sticky Wall')).toBe('阿洛');
  });

  it('长文字原样保留，换行交给 CSS（这里不做任何截断）', () => {
    const long = '这是一句相当长的尾签，长到一行放不下，应该折行而不是被砍掉';
    expect(buildSign(true, long, 'Sticky Wall')).toBe(long);
  });
});
