/**
 * 渲染：把视口状态画到 DOM 上。**每帧只写一个 transform。**
 *
 * 为什么 transform 走内联 style 而不是 CSS 变量：
 * 变量写在 .viewport 上会被整棵子树继承，改一次变量就要给所有已挂载的卡片重算样式；
 * 内联 transform 只影响 .world 自己，卡片完全不参与。500 张卡时这是数量级差距。
 *
 * 例外是网格层（`.viewport::after`）：它在世界坐标系里，必须读 pan/scale 才能对齐。
 * 所以只在 grid 材质下写那三个变量 —— 其它材质下它们是死值，没必要每帧让浏览器重算。
 */

import type { AppShell } from '@/app/shell';

import { applyLevel, levelFor } from './lod';
import { onFrame, scheduleFrame } from './rAF';
import { get, onChange } from './viewport';

/** 低于这个比例，一格网格不到 48px，密到只会糊成一层灰面（impl-00 §A 的收口项） */
const GRID_MIN_SCALE = 0.5;

function isGrid(doc: Document): boolean {
  return doc.documentElement.dataset['background'] === 'grid';
}

/**
 * 远景关网格。先比对再写：每帧无条件写 dataset 会触发一次属性变更，
 * 而 scale 跨过阈值只发生一次，没有理由让静止的墙也跟着抖。
 */
function setGridVisible(doc: Document, visible: boolean): void {
  const want = visible ? 'on' : 'off';
  if (doc.documentElement.dataset['grid'] === want) return;
  doc.documentElement.dataset['grid'] = want;
}

/** 立即重画一次。切换材质后要手动调一次，否则网格变量还是上一个材质的旧值 */
export function paint(shell: AppShell, doc: Document = document): void {
  const { panX, panY, scale } = get();

  shell.world.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;

  // LOD 紧跟 transform：两者读的是同一份 scale，写在同一个帧回调里就不会出现
  // "transform 已经是 0.3、dataset 还是 0" 的那一帧。剔除在 noteLayer 的帧回调里随后跑。
  applyLevel(shell.world, levelFor(scale));

  if (!isGrid(doc)) return;

  const style = shell.viewport.style;
  style.setProperty('--pan-x', String(panX));
  style.setProperty('--pan-y', String(panY));
  style.setProperty('--scale', String(scale));
  setGridVisible(doc, scale >= GRID_MIN_SCALE);
}

export function attachRender(shell: AppShell, doc: Document = document): () => void {
  const offViewport = onChange(() => scheduleFrame());
  const offFrame = onFrame(() => paint(shell, doc));

  paint(shell, doc); // 首屏必须有一帧，否则初始 pan/scale 不落地

  return () => {
    offViewport();
    offFrame();
  };
}
