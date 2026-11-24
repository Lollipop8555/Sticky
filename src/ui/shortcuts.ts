/**
 * 全局快捷键（impl-04 §6）。**一个** `keydown`，不往每个按钮上挂。
 *
 * Esc 有三层含义，优先级必须固定：dialog → 拖拽 → 编辑。
 * 前两层不由这里处理（dialog 是原生行为，拖拽的闭包在 gestures 里），
 * 这里只在"前两层都没接住"时兜编辑态 —— 这正是优先级本身。
 *
 * 为什么不在 interactions 里继续处理 Esc：同一个节点上的两个监听器用
 * `stopPropagation` 互相挡不住（它只挡父节点），留着就是两条各按各的逻辑，
 * 以后再加一层就会变成"按一次 Esc 关两样东西"。
 *
 * 也**不看 `defaultPrevented`**：ProseMirror 在光标处对 Esc 会先 `preventDefault`
 * （想自己收起补全菜单之类），照这个标志退出编辑就等于"编辑态按 Esc 没反应"。
 */

import { store } from '@/app/store';
import { getEditingId, stopEditing } from '@/note/editing';

export function attachShortcuts(doc: Document = document): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;

    // 1. dialog 在自己手里：浏览器会派发 cancel 并关闭它，这里再动编辑态就是"一次 Esc 关两样"
    if (doc.querySelector('dialog[open]')) return;

    // 2. 拖拽：手势层持有 endDrag 闭包，由它负责把坐标退回原位
    if (store.getState().draggingId !== null) return;

    // 3. 编辑：保存并退出
    if (getEditingId() !== null) stopEditing();
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}
