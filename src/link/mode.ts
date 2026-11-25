/**
 * 连线模式（决策 77）。
 *
 * 目的只有一个：**让用户把视角挪到目标便签上，并点中它**。所以这里刻意保留
 * 画布缩放/平移与便签的命中链（否则点不中目标），只做三件事：
 *
 *   1. 拦掉便签原本的全部点击语义（进编辑、双击、右键菜单、拖卡）；
 *   2. 点击目标便签 = 加一条边，连完**留在模式里**继续连；
 *   3. 隐藏所有破坏性入口（删除/复制/新建/废纸篓）。
 *
 * 全部监听都注册一次、内部判断模式 —— 比进出模式时反复 add/remove 少一类"忘了摘"的 bug。
 */

import type { AppShell } from '@/app/shell';
import { store } from '@/app/store';
import { getMountedNoteEl } from '@/canvas/noteLayer';
import { onFrame } from '@/canvas/rAF';
import { get as getViewport } from '@/canvas/viewport';
import { getEditingId, stopEditing } from '@/note/editing';

import { mountSourceCard, type SourceCard } from './sourceCard';
import { addLink } from './state';

/** 与 interactions / lightbox 同一口径：手抖几像素不算"点了空白" */
const CLICK_SLOP = 4;

let doc: Document = document;
let win: Window = window;
let card: SourceCard | null = null;
let down: { x: number; y: number } | null = null;
let lastW = 0;
let lastH = 0;
/** 被藏起来的源便签元素 + 它原来的 visibility，退出时逐字还原 */
let hidden: { el: HTMLElement; prev: string } | null = null;

export function getLinkingFrom(): string | null {
  return store.getState().linkingFrom;
}

/**
 * 把源便签从墙上藏起来。
 *
 * 它就摆在原地、还看得见，就一定有人去点它 —— 而点自己是最没意义的一次连线
 * （`normalizePair` 会丢掉自连，用户看到的就是"点了没反应"）。底部那张预览卡已经
 * 说明"我在连哪张"，墙上那份留着只会制造误触。
 *
 * 每帧兜一次而不是只设一次行内样式：剔除会销毁并重建卡片元素，一次性写法会丢。
 */
function hideSource(id: string): void {
  const el = getMountedNoteEl(id);
  if (!el || hidden?.el === el) return;
  restoreSource();
  hidden = { el, prev: el.style.visibility };
  el.style.visibility = 'hidden';
}

function restoreSource(): void {
  if (!hidden) return;
  hidden.el.style.visibility = hidden.prev;
  hidden = null;
}

export function startLinking(noteId: string): void {
  const note = store.getNote(noteId);
  if (!note) return;
  // 从编辑态的大头针进来时先存稿，源卡显示的就是刚提交的内容
  if (getEditingId()) stopEditing();

  store.setState({ linkingFrom: noteId });
  doc.documentElement.setAttribute('data-linking', 'true');
  lastW = win.innerWidth;
  lastH = win.innerHeight;
  card?.show(note);
  hideSource(noteId);
}

export function exitLinking(): void {
  if (!store.getState().linkingFrom) return;
  store.setState({ linkingFrom: null });
  doc.documentElement.removeAttribute('data-linking');
  card?.hide();
  restoreSource();
}

function onCardClick(event: MouseEvent): void {
  const from = getLinkingFrom();
  if (!from) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  const cardEl = target.closest<HTMLElement>('.note');
  if (!cardEl) return;

  // 拦行为，不是 pointer-events: none —— 后者会让目标便签根本点不中
  event.preventDefault();
  event.stopPropagation();

  const id = cardEl.dataset['noteId'];
  if (!id || id === from) return;
  addLink(from, id);
}

/**
 * 点是否落在源便签原来的位置。
 *
 * 源便签在模式里是 `visibility: hidden` 的，那一片区域没有 DOM 可命中，
 * 点击会直接落到画布上、被当成"点空白退出"。用户的本意是点那张卡（它就在那儿），
 * 所以这一块要当"没点中任何东西"处理，而不是退出。
 */
function insideSource(from: string, sx: number, sy: number): boolean {
  const note = store.getNote(from);
  if (!note) return false;
  const { panX, panY, scale } = getViewport();
  const left = note.x * scale + panX;
  const top = note.y * scale + panY;
  return (
    sx >= left &&
    sx <= left + note.width * scale &&
    sy >= top &&
    sy <= top + note.height * scale
  );
}

function onBlankClick(event: MouseEvent): void {
  const from = getLinkingFrom();
  if (!from) return;

  const start = down;
  down = null;
  // 拖画布找目标不是"点空白"：位移超过容差就只当平移
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;

  const target = event.target;
  if (target instanceof Element && target.closest('.note')) return;
  if (insideSource(from, event.clientX, event.clientY)) return;
  exitLinking();
}

function onPointerDown(event: PointerEvent): void {
  if (!getLinkingFrom()) return;
  if (event.button !== 0) return;
  down = { x: event.clientX, y: event.clientY };
}

function onDblClick(event: MouseEvent): void {
  if (!getLinkingFrom()) return;
  // 连点两下会钻进编辑器，把连线打断
  event.preventDefault();
  event.stopPropagation();
}

function onContextMenu(event: MouseEvent): void {
  if (!getLinkingFrom()) return;
  // 模式里右键什么都不该发生（菜单由 menu.ts 的委托负责，但这里先拦一道）
  event.preventDefault();
  event.stopPropagation();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (!getLinkingFrom()) return;
  // 捕获阶段：先于 shortcuts.ts 的 Esc，避免一次 Esc 既退连线又退编辑
  event.stopPropagation();
  exitLinking();
}

function onResize(): void {
  const w = win.innerWidth;
  const h = win.innerHeight;
  const widthChanged = w !== lastW;
  // 移动端地址栏收起/展开只改高度（60~100px），照字面"任何 resize 都退"会让用户一滚动就掉出模式
  const heightJumped = Math.abs(h - lastH) > Math.max(140, lastH * 0.2);
  lastW = w;
  lastH = h;

  if (!getLinkingFrom()) return;
  if (widthChanged || heightJumped) exitLinking();
}

export function attachLinking(shell: AppShell): () => void {
  doc = shell.root.ownerDocument;
  win = doc.defaultView ?? window;
  card = mountSourceCard(doc, () => exitLinking());

  // capture：必须先于 interactions / noteLayer 的委托，否则卡片已经进了编辑态
  shell.noteLayer.addEventListener('click', onCardClick, true);
  shell.viewport.addEventListener('click', onBlankClick, true);
  shell.viewport.addEventListener('pointerdown', onPointerDown, true);
  shell.noteLayer.addEventListener('dblclick', onDblClick, true);
  shell.noteLayer.addEventListener('contextmenu', onContextMenu, true);
  doc.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('resize', onResize);

  // 剔除会重建卡片元素（行内 visibility 跟着丢），每帧兜一次
  const offFrame = onFrame(() => {
    const id = getLinkingFrom();
    if (id) hideSource(id);
  });

  const offNotes = store.subscribeNotes((_upserts, removed) => {
    const id = getLinkingFrom();
    if (!id) return;
    // 源便签被删（另一个标签页、或快捷键）→ 模式失去意义，直接退
    if (removed.includes(id)) {
      exitLinking();
      return;
    }
    const note = store.getNote(id);
    if (note) card?.update(note);
  });

  return () => {
    offFrame();
    offNotes();
    shell.noteLayer.removeEventListener('click', onCardClick, true);
    shell.viewport.removeEventListener('click', onBlankClick, true);
    shell.viewport.removeEventListener('pointerdown', onPointerDown, true);
    shell.noteLayer.removeEventListener('dblclick', onDblClick, true);
    shell.noteLayer.removeEventListener('contextmenu', onContextMenu, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('resize', onResize);
    exitLinking();
  };
}
