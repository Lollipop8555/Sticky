/**
 * 卡片 DOM。**只建一次，之后只 patch**（03-note §1）。
 *
 * 重建元素的代价不是"慢一点"：会丢焦点、丢选区、丢 IME 组字状态，
 * 而且在拖动时表现为闪烁。所以位置、尺寸、颜色走 CSS 变量，
 * 只有 `contentMd` 变化且**不在编辑态**时才重画正文。
 */

import { activeBackground } from '@/app/theme';
import { hydrateImages } from '@/assets/urls';
import { lineIcon } from '@/ui/icons';
import type { NoteRecord } from '@/storage/types';

import { docToFragment, mdToDoc } from './markdown';
import { displayColor, textColor } from './palette';

const BODY_ATTR = 'data-note-body';

export function getNoteBody(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[${BODY_ATTR}]`);
}

export function createNoteEl(n: NoteRecord): HTMLElement {
  const el = document.createElement('article');
  el.className = 'note';
  el.dataset['noteId'] = n.id;

  const body = document.createElement('div');
  body.className = 'note-body';
  body.setAttribute(BODY_ATTR, '');

  const placeholder = document.createElement('div');
  placeholder.className = 'note-placeholder';
  placeholder.textContent = '双击输入…';
  // 占位符不该抢点击，否则双击落在它上面会"点不到卡"
  placeholder.setAttribute('aria-hidden', 'true');

  // 拖动手柄。手势层靠 [data-grip] 认出它并跳过 400ms 长按；
  // 刻意放在 data-no-pan 之外（它自己就是"立即浮起"的入口）。
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'note-grip';
  grip.setAttribute('data-grip', '');
  grip.setAttribute('aria-label', '拖动便签');
  // 拖拽还没有键盘等价物，先别让它占一个按下去也没反应的 tab 位
  grip.tabIndex = -1;

  /*
   * 删除（移入废纸篓）。`data-no-pan` 让手势层在它身上直接返回，
   * 否则在按钮上按下会当成"拖画布"的起点；点击本身由 interactions 委托处理
   * （卡片 DOM 会被剔除反复重建，逐个挂监听器就是给自己找漏挂的机会）。
   */
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'note-delete';
  del.dataset['act'] = 'trash';
  del.setAttribute('data-no-pan', '');
  del.setAttribute('aria-label', '移入废纸篓');
  del.title = '移入废纸篓';
  /*
   * 曾经是字形的 `×`（16px 字号）。和旁边的分享图标并排后才发现：字形墨迹只有
   * 7.4px、描边约 1.7px，而 14px 的分享 SVG 墨迹 10.5px、描边 0.93px —— 一个又粗又小、
   * 一个又细又大，凑在一起像两个不同尺寸的图标。
   *
   * 现在两者都是 14px 盒子里的线描：实测墨迹 10.5×10.5 与 10.5×11.7、描边 0.99px 与
   * 0.93px。叉刻意画成 3→21 而不是 Lucide 那套 6→18：在小到 14px 的盒子里，
   * 内缩太多的叉会显得比分享图标小一号。
   */
  del.append(lineIcon(['M3 3l18 18', 'M21 3 3 21'], 1.7));

  /*
   * 复制为图片。同样 `data-no-pan`：在它上面按下不该开始拖画布。
   * 图标是线描的"分享"（share-2）：和删除按钮一样走 `currentColor`，
   * 三个节点 + 两条连线，14px 下仍认得出是"分享"而不是"叠放两份"。
   */
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'note-copy';
  copy.dataset['act'] = 'copy';
  copy.setAttribute('data-no-pan', '');
  copy.setAttribute('aria-label', '复制为图片');
  copy.title = '复制为图片';
  copy.append(
    lineIcon(
      [
        // 右上节点
        'M21 5a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
        // 左中节点
        'M9 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
        // 右下节点
        'M21 19a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
        // 两条连线：避开圆的内侧，留出一点呼吸
        'M8.59 13.51l6.83 3.98',
        'M15.41 6.51l-6.82 3.98',
      ],
      1.6,
    ),
  );

  el.append(body, placeholder, grip, del, copy);
  patchNoteEl(el, n);
  return el;
}

/** 把 md 渲染进卡片正文。只在非编辑态调用（编辑态下 DOM 归 Tiptap 所有） */
export function renderNoteBody(el: HTMLElement, md: string): void {
  const body = getNoteBody(el);
  if (!body) return;

  body.textContent = '';
  if (md.trim() !== '') {
    body.append(docToFragment(mdToDoc(md)));
    // 图片节点渲染出来是 <img data-asset="assets/…">；blob URL 懒加载，渲染完再补
    hydrateImages(body);
  }

  setEmpty(el, md.trim() === '');
}

function setEmpty(el: HTMLElement, empty: boolean): void {
  el.dataset['empty'] = empty ? 'true' : 'false';
}

/**
 * 按当前背景把记录里的基色派生成显示色。
 *
 * 单独抽出来是因为**换背景**时需要重刷所有已挂载的卡：记录没变、`prev` 也相同，
 * `patchNoteEl` 的逐字段比对会（正确地）跳过颜色，这里才需要一条显式入口。
 * 代价是 O(挂载数)，只在切换背景时发生一次。
 */
export function applyNoteColors(el: HTMLElement, n: NoteRecord): void {
  // 背景读 DOM 上的 dataset 而不是 prefs：预览口（?bg=）只改 dataset，读 prefs 会错配
  const shown = displayColor(n.bgColor, activeBackground(el.ownerDocument));
  el.style.setProperty('--note-bg', shown);
  el.style.setProperty('--note-fg', textColor(shown));
}

/**
 * 逐字段比对 `prev`。**不比对就不写**：拖动时每帧都会调用，
 * 无谓的 `setProperty` 也会触发样式重算，500 张卡时每帧多出的开销足够掉帧。
 */
export function patchNoteEl(el: HTMLElement, n: NoteRecord, prev?: NoteRecord): void {
  // 坐标取整：亚像素位置会让文字在拖动时抖动（浏览器对不同亚像素位置用不同 hinting）
  if (!prev || prev.x !== n.x) el.style.setProperty('--x', String(Math.round(n.x)));
  if (!prev || prev.y !== n.y) el.style.setProperty('--y', String(Math.round(n.y)));

  if (!prev || prev.width !== n.width) el.style.setProperty('--w', String(n.width));
  if (!prev || prev.height !== n.height) el.style.setProperty('--h', String(n.height));
  if (!prev || prev.minHeight !== n.minHeight) el.style.setProperty('--min-h', String(n.minHeight));

  if (!prev || prev.bgColor !== n.bgColor) applyNoteColors(el, n);

  if (!prev || prev.z !== n.z) el.style.zIndex = String(n.z);

  const contentChanged = !prev || prev.contentMd !== n.contentMd;
  // 编辑态下正文 DOM 归 Tiptap 所有，patch 只能碰几何与颜色，否则会把光标冲掉
  if (contentChanged && !el.classList.contains('is-editing')) {
    renderNoteBody(el, n.contentMd);
  }
}

/**
 * 进编辑：清空静息渲染的 DOM，让出位置给 Tiptap。
 * 不清的话编辑器会在旧内容旁边再插一份，用户看到"两段一样的字"。
 */
export function clearNoteBody(el: HTMLElement): HTMLElement | null {
  const body = getNoteBody(el);
  if (!body) return null;
  body.textContent = '';
  return body;
}

export function destroyNoteEl(el: HTMLElement): void {
  el.remove();
}
