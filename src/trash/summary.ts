/**
 * 废纸篓行的两段展示文本（interaction-spec §8）。
 *
 * 概要为什么要走 PM doc 而不是正则剥 markdown：
 * 列表符号、`**`、`[文字](链接)`、`![alt](assets/…)` 的剥法各是一套规则，
 * 手写正则迟早会把 `**` 当成正文显示出来。解析成 doc 再取 textBetween 只有一条规则：
 * "文本节点就是文字，图片节点给一个占位"。解析失败时 mdToDoc 自己会退化成纯文本。
 */

import { mdToDoc } from '@/note/markdown';

/** 面板每行最多三行概要、每行最多 40 字（超出加省略号） */
export const SUMMARY_LINES = 3;
export const SUMMARY_CHARS = 40;

export function trashSummary(md: string): string[] {
  if (md.trim() === '') return ['（空便签）'];

  const lines: string[] = [];
  // 按段落下钻，而不是只看顶层块：一个 bulletList 顶层只有一块，
  // 直接 textBetween 会得到"第一 第二 第三"糊成一行，列表的三行概要就没了。
  mdToDoc(md).descendants((node) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
    const text = node
      .textBetween(0, node.content.size, ' ', (leaf) => (leaf.type.name === 'image' ? '［图片］' : ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') lines.push(text);
    // 段落里只有行内节点，textBetween 已经取全了，不必再往下钻
    return false;
  });

  if (lines.length === 0) return ['（空便签）'];
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
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;

  const date = new Date(at);
  const month = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  // 跨年时补上年份：只有"3 月 5 日"看不出是今年的还是三年前的
  return new Date(now).getFullYear() === date.getFullYear()
    ? month
    : `${date.getFullYear()} 年 ${month}`;
}
