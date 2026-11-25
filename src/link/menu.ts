/**
 * 连线列表 popover（决策 75）。**右键与大头针共用这一个**，只有锚点不同：
 * 右键贴指针，大头针贴便签中心。
 *
 * 三条实现约束：
 * 1. 挂 `body`，**不要挂 `#viewport`**：滚轮缩放与 pointerdown 手势都监听在 `#viewport` 上，
 *    挂进去以后列表一滚动就会缩放画布、点剪刀会触发画布手势。
 * 2. 列表项不用嵌套按钮：外层 `div`，左栏 `div[role="menuitem"]`（跳转），右栏 `<button>`（断开）。
 *    `<button>` 套 `<button>` 是非法 DOM，浏览器会拆开，点击落点不可控。
 * 3. 目标便签可能在废纸篓里：软删走 `store.detach()`，记录直接从内存摘掉，
 *    `store.getNote()` 返回 undefined —— 这种项不渲染（点过去只会跳到空白）。
 */

import { getMountedNoteEl } from '@/canvas/noteLayer';
import {
  get as getViewport,
  onChange as onViewportChange,
  set as setViewport,
  viewportSize,
} from '@/canvas/viewport';
import { getEditingId, stopEditing } from '@/note/editing';
import { displayColor, textColor } from '@/note/palette';
import { activeBackground } from '@/app/theme';
import type { AppShell } from '@/app/shell';
import { store } from '@/app/store';
import { onLocaleChange, setAria, setText, t } from '@/i18n';
import { trashSummary } from '@/trash/summary';
import type { NoteRecord } from '@/storage/types';
import { lineIcon } from '@/ui/icons';

import { neighborIds, removeLink } from './state';

export interface LinkMenuDeps {
  /**
   * "添加连线"：调用方负责退出编辑态（若在编辑）并进入连线模式。
   * 做成注入而不是直接 import mode：菜单不该知道连线模式怎么实现。
   */
  onAdd(noteId: string): void;
}

export interface LinkMenu {
  /** anchor 是屏幕坐标（右键指针 / 便签中心） */
  open(noteId: string, anchor: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SCISSORS = [
  'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'M20 4 8.12 15.88',
  'M14.47 14.48 20 20',
  'M8.12 8.12 12 12',
];

export function mountLinkMenu(
  shell: AppShell,
  deps: LinkMenuDeps,
  doc: Document = document,
): LinkMenu {
  const pop = el(doc, 'div', 'link-menu');
  pop.hidden = true;
  pop.setAttribute('role', 'menu');
  // shortcuts.ts 靠这个属性让 Esc：有弹层时 Esc 归弹层，不退出编辑态
  pop.setAttribute('data-link-menu', '');
  doc.body.append(pop);

  let currentId: string | null = null;
  /** 打开时的编辑态：关闭后要还焦点，否则格式条状态错乱、继续打字要先点一下正文 */
  let editingAtOpen: string | null = null;
  let abort: AbortController | null = null;
  let offViewport: (() => void) | null = null;

  function items(noteId: string): NoteRecord[] {
    const list: NoteRecord[] = [];
    for (const id of neighborIds(noteId)) {
      const note = store.getNote(id);
      if (note) list.push(note);
    }
    // 边集里是插入序（删了再加会挪位置），这里按创建时间排，打开顺序才稳定
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  function render(noteId: string): void {
    const bg = activeBackground(doc);
    const links = items(noteId);
    const fragment = doc.createDocumentFragment();

    const head = el(doc, 'header', 'link-menu-head');
    const title = el(doc, 'span', 'link-menu-title');
    // 带 {n} 的动态文案：不走 data-i18n 指纹，语言切换时整块重渲染
    title.textContent = t('link.menuTitle', { n: links.length });
    head.append(title);
    fragment.append(head);

    const list = el(doc, 'div', 'link-menu-list');

    if (links.length === 0) {
      const empty = el(doc, 'p', 'link-menu-empty');
      setText(empty, 'link.menuEmpty');
      list.append(empty);
    }

    for (const note of links) {
      const row = el(doc, 'div', 'link-menu-item');
      // 整行是目标便签的底色，左右两栏共用（视觉上像一张小卡被切成两块）
      const display = displayColor(note.bgColor, bg);
      row.style.background = display;
      row.style.color = textColor(display);

      const pick = el(doc, 'div', 'link-menu-pick');
      pick.setAttribute('role', 'menuitem');
      pick.tabIndex = 0;
      const text = el(doc, 'span', 'link-menu-text');
      text.textContent = trashSummary(note.contentMd).join(' ');
      pick.append(text);

      pick.addEventListener('click', () => jump(note));
      pick.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        jump(note);
      });

      const cut = el(doc, 'button', 'link-menu-cut');
      cut.type = 'button';
      cut.append(lineIcon(SCISSORS));
      setAria(cut, 'link.menuDisconnect');
      cut.addEventListener('click', () => {
        removeLink(noteId, note.id);
        // 不关菜单：断完还想继续断，断到 0 条自然显示空态
        render(noteId);
      });

      row.append(pick, cut);
      list.append(row);
    }
    fragment.append(list);

    const add = el(doc, 'button', 'link-menu-add');
    add.type = 'button';
    setText(add, 'link.menuAdd');
    add.addEventListener('click', () => {
      const id = currentId;
      close();
      if (id) deps.onAdd(id);
    });
    fragment.append(add);

    pop.replaceChildren(fragment);
  }

  function place(anchor: { x: number; y: number }): void {
    const margin = 8;
    // 先落到锚点再量：菜单尺寸取决于内容，量完才知道要不要翻到另一侧
    pop.style.left = `${anchor.x}px`;
    pop.style.top = `${anchor.y}px`;

    const rect = pop.getBoundingClientRect();
    const { width: vw, height: vh } = viewportSize();

    let x = anchor.x;
    let y = anchor.y;
    if (x + rect.width + margin > vw) x = anchor.x - rect.width;
    if (y + rect.height + margin > vh) y = anchor.y - rect.height;
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }

  function centerOn(note: NoteRecord): void {
    const { scale } = getViewport();
    const { width, height } = viewportSize();
    const cx = note.x + note.width / 2;
    const cy = note.y + note.height / 2;
    // 只挪 pan 不动 scale：跳转是"带我去看那张"，不是"重新适配视野"
    setViewport({ panX: width / 2 - cx * scale, panY: height / 2 - cy * scale, scale });
  }

  function jump(note: NoteRecord): void {
    // 跳走就是离开这张卡，编辑态跟着退出（与右键菜单同一语义：右键本来就不在编辑态）
    if (getEditingId()) stopEditing();
    close();
    centerOn(note);
  }

  function onPointerDown(event: Event): void {
    const target = event.target as Node | null;
    if (target && pop.contains(target)) return;
    close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    // 捕获阶段拦下：否则 shortcuts.ts 会先把编辑态退掉，一次 Esc 关两样
    event.stopPropagation();
    close();
  }

  function close(): void {
    if (pop.hidden) return;
    pop.hidden = true;
    currentId = null;

    abort?.abort();
    abort = null;
    offViewport?.();
    offViewport = null;

    if (editingAtOpen && getEditingId() === editingAtOpen) {
      getMountedNoteEl(editingAtOpen)
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus();
    }
    editingAtOpen = null;
  }

  function open(noteId: string, anchor: { x: number; y: number }): void {
    const note = store.getNote(noteId);
    if (!note) return;

    // 同一个入口再点一次 = 收起
    if (!pop.hidden && currentId === noteId) {
      close();
      return;
    }

    close();
    currentId = noteId;
    editingAtOpen = getEditingId();
    pop.hidden = false;
    render(noteId);
    place(anchor);

    abort = new AbortController();
    const { signal } = abort;
    doc.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    doc.addEventListener('keydown', onKeyDown, { capture: true, signal });
    // 只监听 #viewport 的滚轮：菜单列表自己也要滚，监听 window 会把自身滚动当成"画布缩放"关掉
    shell.viewport.addEventListener('wheel', close, { passive: true, signal });
    // 缩放/平移后 fixed 坐标就过期了，直接关（不重定位：省一条容易出错的路径）
    offViewport = onViewportChange(close);
  }

  const offContext = (() => {
    const handler = (event: MouseEvent): void => {
      // 编辑态放行原生菜单：输入框要粘贴、拼写检查
      if (getEditingId()) return;
      // 连线模式里右键不弹菜单（决策 77）
      if (store.getState().linkingFrom) return;

      const target = event.target as Element | null;
      const card = target?.closest<HTMLElement>('.note');
      const id = card?.dataset['noteId'];
      if (!id) return;

      event.preventDefault();
      open(id, { x: event.clientX, y: event.clientY });
    };
    shell.noteLayer.addEventListener('contextmenu', handler);
    return () => shell.noteLayer.removeEventListener('contextmenu', handler);
  })();

  const offLocale = onLocaleChange(() => {
    if (!pop.hidden && currentId) render(currentId);
  });

  return {
    open,
    close,
    isOpen: () => !pop.hidden,
    dispose() {
      close();
      offContext();
      offLocale();
      pop.remove();
    },
  };
}
