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
 * 源便签留在原位、灰化并发光（`.note--link-source`），不再藏起来：
 * 既不会出现"便签凭空消失"，也不需要按坐标补一刀"点在源卡上别退出"。
 * 它离屏后由 HUD 的方位指引接手。
 *
 * 全部监听都注册一次、内部判断模式 —— 比进出模式时反复 add/remove 少一类"忘了摘"的 bug。
 */

import type { AppShell } from '@/app/shell';
import { store } from '@/app/store';
import { getMountedNoteEl } from '@/canvas/noteLayer';
import { onFrame } from '@/canvas/rAF';
import { getEditingId, stopEditing } from '@/note/editing';

import { mountLinkHud, type LinkHud } from './hud';
import { addLink } from './state';

/** 与 interactions / lightbox 同一口径：手抖几像素不算"点了空白" */
const CLICK_SLOP = 4;

let doc: Document = document;
let win: Window = window;
let hud: LinkHud | null = null;
let down: { x: number; y: number } | null = null;
let lastW = 0;
let lastH = 0;

export function getLinkingFrom(): string | null {
  return store.getState().linkingFrom;
}

/** 标记/还原源便签。剔除会重建卡片元素，所以每帧补一次 class（一次性写法会丢）。 */
function markSource(id: string): void {
  getMountedNoteEl(id)?.classList.add('note--link-source');
}

function clearSourceMark(): void {
  for (const el of doc.querySelectorAll('.note--link-source')) {
    el.classList.remove('note--link-source');
  }
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
  hud?.show(note);
  markSource(noteId);
}

export function exitLinking(): void {
  if (!store.getState().linkingFrom) return;
  store.setState({ linkingFrom: null });
  doc.documentElement.removeAttribute('data-linking');
  hud?.hide();
  clearSourceMark();
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

function onBlankClick(event: MouseEvent): void {
  const from = getLinkingFrom();
  if (!from) return;

  const start = down;
  down = null;
  // 拖画布找目标不是"点空白"：位移超过容差就只当平移
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;

  const target = event.target;
  if (target instanceof Element && target.closest('.note')) return;
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
  hud = mountLinkHud(shell, () => exitLinking());

  // capture：必须先于 interactions / noteLayer 的委托，否则卡片已经进了编辑态
  shell.noteLayer.addEventListener('click', onCardClick, true);
  shell.viewport.addEventListener('click', onBlankClick, true);
  shell.viewport.addEventListener('pointerdown', onPointerDown, true);
  shell.noteLayer.addEventListener('dblclick', onDblClick, true);
  shell.noteLayer.addEventListener('contextmenu', onContextMenu, true);
  doc.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('resize', onResize);

  // 剔除会重建卡片元素（class 跟着丢），每帧补一次
  const offFrame = onFrame(() => {
    const id = getLinkingFrom();
    if (!id) return;
    markSource(id);
    const note = store.getNote(id);
    if (note) hud?.frame(note);
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
    if (note) hud?.update(note);
  });

  return () => {
    offFrame();
    offNotes();
    hud?.dispose();
    hud = null;
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
