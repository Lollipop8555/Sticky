/**
 * 尾签（决策 90）：便签末尾的一行签名，视觉上是 `------ 阿洛 ------` 那种
 * "两条线夹一句话"，但**线不是字符**，是 CSS 画的两条 flex 边。
 *
 * 字符方案（把 `-` 敲进 textContent）有三个硬伤：
 * 1. 两条线只能靠数对字符数来"对齐"，字体一变、字数一多就歪；
 * 2. 文字一长，超出的那半截线不会自己缩短，`------ 很长很长的签名 ------` 直接顶出卡片；
 * 3. 线会被算进可复制/可搜索的文本里 —— 而尾签本来就不该是文本。
 *
 * 所以结构是三段：`线 | 文字 | 线`。两条线 `flex: 1 1 0` 平分剩余空间 → 等长 → 文字天然居中；
 * 文字变长时线先被压到 `min-width`（"基本长度"），再长就文字自己换行，线保持不动。
 *
 * 位置的边界仍然由"节点放在哪儿"决定，见下面的注释。
 */

import { getPrefs } from '@/app/prefs';
import { t } from '@/i18n';

/** 元素标记：属性名只该有一个来源，`applyNoteSign` 靠它找回自己那一行 */
const SIGN_ATTR = 'data-note-sign';

const TEXT_CLASS = 'note-sign-text';
const RULE_CLASS = 'note-sign-rule';

/**
 * 尾签文字（纯函数，便于单测）。
 * 关着 → `null`，调用方据此隐藏；开着但文字空着 → 回落到应用名，
 * 与"开了水印却什么都没出现"是同一类困惑，宁可给个默认值。
 */
export function buildSign(on: boolean, text: string, fallback: string): string | null {
  if (!on) return null;
  return text.trim() || fallback;
}

/** 建空的尾签节点：两条线夹一个文字槽。内容由 `applyNoteSign` 填，卡片只建一次 */
export function createNoteSign(): HTMLElement {
  const sign = document.createElement('div');
  sign.className = 'note-sign';
  sign.setAttribute(SIGN_ATTR, '');
  sign.hidden = true;

  const text = document.createElement('span');
  text.className = TEXT_CLASS;

  const left = document.createElement('span');
  left.className = RULE_CLASS;
  const right = document.createElement('span');
  right.className = RULE_CLASS;

  sign.append(left, text, right);

  return sign;
}

/**
 * 按当前偏好刷新一张卡上的尾签。
 * 只读 prefs，不需要 record —— 墨色走 CSS 的 `--note-fg`（由 `applyNoteColors` 写在卡上），
 * 所以便签换颜色时尾签自己就跟着变了，不用在这里再算一遍。
 */
export function applyNoteSign(el: HTMLElement): void {
  const node = el.querySelector<HTMLElement>(`[${SIGN_ATTR}]`);
  if (!node) return;

  const text = node.querySelector<HTMLElement>(`.${TEXT_CLASS}`);
  const prefs = getPrefs();
  const label = buildSign(prefs.signOn, prefs.signText, t('sign.fallback'));

  if (label === null) {
    if (!node.hidden) {
      node.hidden = true;
      if (text) text.textContent = '';
    }
    return;
  }

  node.hidden = false;
  // 拖动时同一张卡每帧都会 patch，值没变就别写 textContent（会触发布局）
  if (text && text.textContent !== label) text.textContent = label;
}
