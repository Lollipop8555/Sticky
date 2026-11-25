/**
 * 编辑态：**全局唯一一张**（决策：同时只能编辑一张卡）。
 *
 * 唯一性不是审美要求：两张卡同时编辑意味着两个 Tiptap 实例、两套 History、
 * 两个写入源，而"点空白保存"到底该保存哪一张没有正确答案。
 * 所以进入另一张卡的编辑 = 先保存并退出前一张（README §4）。
 */

import { commands } from '@/app/commands';
import { getMountedNoteEl } from '@/canvas/noteLayer';
import { store } from '@/app/store';

import { clearNoteBody, renderNoteBody } from './NoteCard';
import { mountEditor, type EditorHandle, type FormatState } from './editor';
import { mountFormatBar, type FormatBar } from './formatBar';
import { measureHeight } from './measure';

interface Session {
  id: string;
  el: HTMLElement;
  handle: EditorHandle;
  bar: FormatBar;
}

let session: Session | null = null;

/**
 * 格式条上的大头针要打开连线列表（决策 75）。由 main 注入，editing 不直接依赖 link 层：
 * 否则 note/ 反拖 link/ 进依赖图，编辑器的单测要连 DOM 菜单一起跑。
 */
let linkOpener: ((noteId: string, card: HTMLElement) => void) | null = null;

export function setLinkOpener(fn: (noteId: string, card: HTMLElement) => void): void {
  linkOpener = fn;
}

export function getEditingId(): string | null {
  return session?.id ?? null;
}

export function startEditing(id: string, point?: { clientX: number; clientY: number }): void {
  if (session?.id === id) {
    session.handle.focusAt(point?.clientX, point?.clientY);
    return;
  }

  // 先落前一张：否则前一张的内容还躺在内存里的 Tiptap 实例里，随 destroy 一起消失
  stopEditing();

  const note = store.getNote(id);
  const el = getMountedNoteEl(id);
  if (!note || !el) return;

  // 编辑中的卡必须在最上面：否则输入时光标会被旁边的卡压住
  commands.bringToFront(id);

  const body = clearNoteBody(el);
  if (!body) return;

  el.classList.add('is-editing');
  el.dataset['empty'] = 'false'; // 占位符必须让位，否则会盖在光标上

  // 先声明再赋值：mountEditor 的 onSelection 会在编辑器构造期间（拿到 bar 之前）触发一次
  let bar: FormatBar | null = null;

  const handle = mountEditor(body, note.contentMd, {
    // 输入即落内存：真正的合并与节流在写队列里，编辑层不需要再叠一层防抖
    onChange: (md) => commands.updateContent(id, md),
    onSelection: (state: FormatState) => bar?.sync(state),
  });

  bar = mountFormatBar(el, handle, (noteId, card) => linkOpener?.(noteId, card));

  session = { id, el, handle, bar };
  store.setState({ editingId: id });

  handle.focusAt(point?.clientX, point?.clientY);
}

export function stopEditing(): void {
  if (!session) return;
  const { id, el, handle, bar } = session;
  // 先解引用：下面的 commit 会同步回调 patch，那时必须已经是「非编辑态」，
  // 否则 patch 会因为 is-editing 跳过正文重绘，卡片就停在空白上
  session = null;

  const md = handle.getMd();
  bar.dispose();
  handle.destroy();
  el.classList.remove('is-editing');

  commands.updateContent(id, md);

  // md 没变（用户只是点开又点走）时上面的 commit 是空操作，正文还停在 destroy 留下的空白
  if (!el.querySelector('.note-body')?.hasChildNodes()) renderNoteBody(el, md);

  const note = store.getNote(id);
  // 内容可能已撑高/缩回：保存前量一次，远视角色块才能还原真实比例
  if (note) commands.setHeight(id, measureHeight(el, note.minHeight));

  store.setState({ editingId: null });
}
