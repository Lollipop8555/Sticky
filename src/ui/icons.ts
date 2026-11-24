/**
 * 图标：全部内联 SVG。
 *
 * 为什么不引 Material Icons 的 webfont / CDN：
 * 1. 决策 16「不引入任何 webfont」—— 图标字体也是 webfont，首屏多一次字体请求还会 FOUT；
 * 2. 这是个断网可用的 PWA：CDN 上的字体一断就是一片豆腐块，而内联路径永远在包里；
 * 3. 字体图标只能用字号调大小、不能改笔画粗细，SVG 跟着 `currentColor` 走，主题切换零成本。
 *
 * 路径取自 Google Material Symbols（Outlined），24px 网格是 `0 -960 960 960`，
 * 直接沿用这个 viewBox，省掉一次坐标换算（也避免手抄出错）。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Material Symbols 的官方网格 */
const MATERIAL_VIEW_BOX = '0 -960 960 960';

function svg(viewBox: string): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function path(svgNode: SVGSVGElement, d: string): void {
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', d);
  svgNode.append(el);
}

/** 实心图标（Material Symbols 那种：填充当前色，没有描边） */
export function materialIcon(paths: readonly string[]): SVGSVGElement {
  const node = svg(MATERIAL_VIEW_BOX);
  node.setAttribute('fill', 'currentColor');
  for (const d of paths) path(node, d);
  return node;
}

/** 线描图标（自绘的那些：统一 1.7 描边、圆头，和实心图标并排也不打架） */
export function lineIcon(paths: readonly string[], strokeWidth = 1.7): SVGSVGElement {
  const node = svg('0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', String(strokeWidth));
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) path(node, d);
  return node;
}

export const ICONS = {
  add: ['M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z'],
  gridView: [
    'M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Zm400-400Zm0 240Zm-240 0Zm0-240Z',
  ],
  settings: [
    'm370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z',
  ],
  bold: [
    'M272-200v-560h221q65 0 120 40t55 111q0 51-23 78.5T602-491q25 11 55.5 41t30.5 90q0 89-65 124.5T501-200H272Zm121-112h104q48 0 58.5-24.5T566-372q0-11-10.5-35.5T494-432H393v120Zm0-228h93q33 0 48-17t15-38q0-24-17-39t-44-15h-95v109Z',
  ],
  italic: ['M200-200v-100h160l120-360H320v-100h400v100H580L460-300h140v100H200Z'],
  strike: [
    'M80-400v-80h800v80H80Zm340-160v-120H200v-120h560v120H540v120H420Zm0 400v-160h120v160H420Z',
  ],
  code: [
    'M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z',
  ],
  link: [
    'M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z',
  ],
  bulletList: [
    'M360-200v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm-56.5-263.5Q120-687 120-720t23.5-56.5Q167-800 200-800t56.5 23.5Q280-753 280-720t-23.5 56.5Q233-640 200-640t-56.5-23.5Z',
  ],
  orderedList: [
    'M120-80v-60h100v-30h-60v-60h60v-30H120v-60h120q17 0 28.5 11.5T280-280v40q0 17-11.5 28.5T240-200q17 0 28.5 11.5T280-160v40q0 17-11.5 28.5T240-80H120Zm0-280v-110q0-17 11.5-28.5T160-510h60v-30H120v-60h120q17 0 28.5 11.5T280-560v70q0 17-11.5 28.5T240-450h-60v30h100v60H120Zm60-280v-180h-60v-60h120v240h-60Zm180 440v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360Z',
  ],
} as const;
