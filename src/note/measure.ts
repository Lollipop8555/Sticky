/**
 * 高度测量。**只在这里算**，别处一律读记录里的 `height`。
 *
 * 为什么是 `offsetHeight` 而不是 `getBoundingClientRect().height`：
 * 后者包含祖先的 `scale`，要除回去；浮点误差会让 500 张卡每次测量都差 1px，
 * 于是每次测量都判定"变了"，每次都触发写库 —— 一个自己喂自己的循环。
 *
 * 前提是卡片**不改 height**（内容撑开、`min-height` 兜底）。若把 `--h` 写成固定 height，
 * 测量结果永远是它自己，就成了循环定义。
 */

export const MIN_NOTE_HEIGHT = 160;

export function measureHeight(el: HTMLElement, minHeight: number = MIN_NOTE_HEIGHT): number {
  return Math.max(minHeight, Math.round(el.offsetHeight));
}
