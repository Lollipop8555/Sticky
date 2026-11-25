/**
 * 连线模式下的"源便签"悬浮卡（决策 77）。
 *
 * 为什么不直接把源便签高亮、让用户自己记住是它：
 * 连线模式里用户要缩放/平移去找目标，源便签很容易被移出视口。屏幕底部这张卡是
 * **固定**的，不随视野动，保证"我连的是哪张"始终可见。
 *
 * 它必须长得就**像一张便签**（同底色、同字号、同圆角、同阴影、正文原样渲染）：
 * 一个长方形色块只能告诉你"这里有张卡"，认不出是哪张；用户要靠正文认出自己。
 *
 * 取消按钮是卡片旁边一枚**独立**的按钮，不做角标：角标压在卡上会挡住正文，
 * 而且在便签预览这种"看起来可以点"的东西上挂一个 X，反而让人以为那是关闭预览。
 */

import { setAria, setText, setTitle, t } from '@/i18n';
import { applyNoteColors, createNoteBody, renderNoteBody } from '@/note/NoteCard';
import type { NoteRecord } from '@/storage/types';
import { lineIcon } from '@/ui/icons';

export interface SourceCard {
  show(note: NoteRecord): void;
  /** 源便签内容/颜色变了（正在被别的入口改）时同步 */
  update(note: NoteRecord): void;
  hide(): void;
}

export function mountSourceCard(doc: Document, onExit: () => void): SourceCard {
  const root = doc.createElement('div');
  root.className = 'link-source';
  root.hidden = true;

  const row = doc.createElement('div');
  row.className = 'link-source-row';

  // 便签预览：几何/配色/正文渲染全部复用卡片那一套，只是尺寸小一号、内容超了淡出
  const card = doc.createElement('article');
  card.className = 'link-source-card';
  const body = createNoteBody();
  card.append(body);

  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'link-source-cancel';
  cancel.append(lineIcon(['M6 6l12 12', 'M18 6 6 18']));
  const label = doc.createElement('span');
  setText(label, 'io.cancel');
  cancel.append(label);
  setAria(cancel, 'link.modeExit');
  setTitle(cancel, 'link.modeExit');
  cancel.addEventListener('click', onExit);

  const hint = doc.createElement('p');
  hint.className = 'link-source-hint';
  hint.textContent = t('link.modeHint');

  row.append(card, cancel);
  root.append(row, hint);

  function fill(note: NoteRecord): void {
    // 与墙上的卡片走同一条派生路径（基色 → 按当前背景算显示色/文本色）
    applyNoteColors(card, note);
    renderNoteBody(card, note.contentMd);
  }

  return {
    show(note) {
      // 只在连线模式期间挂进 DOM：预览里也有一个 `.note-body`，
      // 常驻会让"墙上有几个正文容器"这类查询多出一个假的
      if (!root.isConnected) doc.body.append(root);
      // 先显示再渲染：图片是懒加载（IntersectionObserver），`hidden` 时不会被观察到
      root.hidden = false;
      fill(note);
    },
    update(note) {
      if (!root.hidden) fill(note);
    },
    hide() {
      root.hidden = true;
      root.remove();
    },
  };
}
