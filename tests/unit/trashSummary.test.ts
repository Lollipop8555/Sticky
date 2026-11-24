import { describe, expect, it } from 'vitest';

import { relativeTime, trashSummary } from '@/trash/summary';

describe('trashSummary', () => {
  it('剥掉 markdown 语法，只留文字', () => {
    expect(trashSummary('**粗** 与 *斜* 与 `code`')).toEqual(['粗 与 斜 与 code']);
  });

  it('列表按段拆行，最多三行', () => {
    const md = '- 第一\n- 第二\n- 第三\n- 第四';
    const lines = trashSummary(md);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('第一');
  });

  it('图片段落给一个可辨认的占位，不是空行', () => {
    expect(trashSummary('![猫](assets/x.webp)')).toEqual(['［图片］']);
    expect(trashSummary('看图\n\n![猫](assets/x.webp)')).toEqual(['看图', '［图片］']);
  });

  it('链接只留文字', () => {
    expect(trashSummary('[官网](https://example.com)')).toEqual(['官网']);
  });

  it('超过 40 字截断并加省略号', () => {
    const long = '字'.repeat(60);
    const [line] = trashSummary(long);
    expect(line).toBe(`${'字'.repeat(40)}…`);
  });

  it('空便签也要有内容，否则面板里是一行空白', () => {
    expect(trashSummary('')).toEqual(['（空便签）']);
    expect(trashSummary('   \n\n  ')).toEqual(['（空便签）']);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-24T12:00:00').getTime();

  it('一分钟内是"刚刚"', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚');
    // 时钟回拨（记录比 now 还新）也当刚刚，不能出现"-3 分钟前"
    expect(relativeTime(now + 5_000, now)).toBe('刚刚');
  });

  it('分钟 / 小时 / 天 逐级切换', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 小时前');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前');
  });

  it('超过 30 天换成日期；跨年时补年份', () => {
    expect(relativeTime(new Date('2026-03-05T00:00:00').getTime(), now)).toBe('3 月 5 日');
    expect(relativeTime(new Date('2025-03-05T00:00:00').getTime(), now)).toBe('2025 年 3 月 5 日');
  });
});
