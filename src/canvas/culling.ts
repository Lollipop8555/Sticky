/**
 * 视口剔除（tech-design §2.5）：只挂载看得见的卡。
 *
 * 这里只有几何，不碰 DOM —— "要不要挂"和"怎么挂"分开，
 * 前者能单测，后者留在 noteLayer（它才持有 `Map<id, el>`）。
 *
 * 三条纪律：
 * 1. **少于 200 张不剔除**。全量挂载更简单更稳，300 张卡的 DOM 对现代浏览器不是负担，
 *    而剔除的边界 bug（贴边一闪、拖到一半被卸载）排查成本极高。
 * 2. **可见矩形外扩**。不预挂载的话，卡片会在贴边时"先出现再被挂载"，能看见一帧空洞；
 *    外扩只是缓冲，不影响正确性。
 * 3. **正在编辑的卡永远不卸载**。卸载 = 销毁 DOM = 丢焦点、丢选区，
 *    用户平移一下画布就丢半句话，这是最不能忍的一类 bug。
 */

import { get, viewportSize, type Bounds } from './viewport';

/** 少于这个数量就全量挂载 */
export const FULL_MOUNT_LIMIT = 200;

/**
 * 可见矩形放大倍数（按尺寸算，1.5 = 四周各多出 25%）。
 * 不是"每边扩 1.5 倍视口"——那等于把 16 个视口的东西全挂上，剔除就白做了。
 */
export const CULL_FACTOR = 1.5;

/** 当前可见的世界矩形（外扩 `factor` 倍） */
export function visibleRect(factor: number = CULL_FACTOR): Bounds {
  const { panX, panY, scale } = get();
  const { width, height } = viewportSize();

  const worldW = width / scale;
  const worldH = height / scale;
  const w = worldW * factor;
  const h = worldH * factor;
  const cx = (width / 2 - panX) / scale;
  const cy = (height / 2 - panY) / scale;

  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/**
 * AABB 求交。用严格小于：边贴边不算相交。
 * 世界坐标是浮点，贴边一两像素的差别肉眼不可见，但"卡在边界上永远不挂载"是可见的，
 * 所以调用方都留了外扩缓冲，这里保持数学上的干净定义。
 */
export function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** 数量够多才值得算：便宜的全量路径优先 */
export function needsCulling(count: number): boolean {
  return count >= FULL_MOUNT_LIMIT;
}
