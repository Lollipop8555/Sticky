/**
 * 废纸篓行的两段展示文本（interaction-spec §8）。
 *
 * 概要为什么要走 PM doc 而不是正则剥 markdown：
 * 列表符号、`**`、`[文字](链接)`、`![alt](assets/…)` 的剥法各是一套规则，
 * 手写正则迟早会把 `**` 当成正文显示出来。解析成 doc 再取 textBetween 只有一条规则：
 * "文本节点就是文字，图片节点给一个占位"。解析失败时 mdToDoc 自己会退化成纯文本。
 *
 * 文案（决策 69）：这里的两个函数都是**调用时**取文案而不是模块加载时定死，
 * 面板每次 refresh 重建行，所以切完语言再打开就是新语言。
 */

import { t } from '@/i18n';
import { mdToDoc } from '@/note/markdown';

/** 面板每行最多三行概要、每行最多 40 字（超出加省略号） */
export const SUMMARY_LINES = 3;
export const SUMMARY_CHARS = 40;

export function trashSummary(md: string): string[] {
  if (md.trim() === '') return [t('trash.summaryEmpty')];

  const lines: string[] = [];
  // 按段落下钻，而不是只看顶层块：一个 bulletList 顶层只有一块，
  // 直接 textBetween 会得到"第一 第二 第三"糊成一行，列表的三行概要就没了。
  mdToDoc(md).descendants((node) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
    const text = node
      .textBetween(0, node.content.size, ' ', (leaf) =>
        leaf.type.name === 'image' ? t('trash.summaryImage') : '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') lines.push(text);
    // 段落里只有行内节点，textBetween 已经取全了，不必再往下钻
    return false;
  });

  if (lines.length === 0) return [t('trash.summaryEmpty')];
  return lines.slice(0, SUMMARY_LINES).map((line) =>
    line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS)}…` : line,
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 相对时间。`now` 可注入：单测不该依赖真实时钟 */
export function relativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return t('trash.justNow');
  if (diff < HOUR) return t('trash.minutesAgo', { n: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('trash.hoursAgo', { n: Math.floor(diff / HOUR) });
  if (diff < 30 * DAY) return t('trash.daysAgo', { n: Math.floor(diff / DAY) });

  const date = new Date(at);
  const monthDay = t('trash.monthDay', { m: date.getMonth() + 1, d: date.getDate() });
  // 跨年时补上年份：只有"3 月 5 日"看不出是今年的还是三年前的
  return new Date(now).getFullYear() === date.getFullYear()
    ? monthDay
    : t('trash.yearMonthDay', { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
}
