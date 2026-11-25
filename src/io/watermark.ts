/**
 * 便签图水印（决策 88）：斜向平铺的文字，**只出现在导出的 PNG 里**，屏幕上不画。
 *
 * 三个取舍：
 * 1. 用 SVG `<pattern>` 而不是 DOM 旋转 + 重复元素：pattern 的 `patternTransform`
 *    在数学上保证平铺无缝，也不依赖快照库对 CSS transform 的支持；
 * 2. 旋转放在 pattern 内部、最外层不转：外层若旋转，四角会露出没有水印的三角形；
 * 3. 墨色不由这里算，由调用方用 `textColor()` 定完后传进来：正文色已经保证
 *    "在这张便签的底色上读得清"，水印沿用它比另算一套 HSL 明度更稳。
 */

/** 与便签正文同一套字体栈：水印跟着卡片的字走，图里不会突然冒出一种陌生字形 */
const FONT_STACK =
  "ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif";

/** 字号 = 输出短边的 3.2%：320 的卡上约 10px，整墙大图上跟着放大，不必按出口分别调 */
const FONT_RATIO = 0.032;
const MIN_FONT = 9;
const MAX_FONT = 64;
/** 低到不抢正文，又足以在深色便签与整墙背景上认得出文字 */
const OPACITY = 0.14;
const ANGLE = -24;

export interface WatermarkSpec {
  text: string;
  /** 覆盖层的 CSS 像素尺寸（即出图尺寸，不含 PIXEL_RATIO） */
  width: number;
  height: number;
  /** 墨色，通常来自 `textColor()` 或卡片的 computed color */
  ink: string;
}

/**
 * 估文字宽度（em）。SVG 里没法"画完再量"，而 `textLength` 会把中英文拉伸变形，
 * 所以按字符类别估：CJK 全角 1em、ASCII 0.55em、空白 0.32em、其余（emoji 等）1.15em。
 * 水印不需要排得精确，宽一点只是间距大一点。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) em += 0.32;
    else if (code >= 0x2e80) em += 1;
    else if (ch >= 'A' && ch <= 'Z') em += 0.62;
    else em += 0.54;
  }
  return em * fontSize;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 单块水印的尺寸：宽度 = 文字 + 一个横向间距，高度 = 一个行距 */
export function tileSize(text: string, fontSize: number): { w: number; h: number } {
  return {
    w: Math.ceil(estimateTextWidth(text, fontSize) + fontSize * 2.4),
    h: Math.ceil(fontSize * 3.2),
  };
}

/** 字号的唯一来源：整墙大图与单卡小图都从这里拿，避免两处各调一个数字 */
export function watermarkFontSize(width: number, height: number): number {
  const short = Math.max(1, Math.min(width, height));
  return Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(short * FONT_RATIO)));
}

/**
 * 生成整层水印的 SVG（纯函数，便于单测转义与尺寸公式）。
 * 外层 `rect` 铺满 viewport，填充取自 pattern —— 边缘不需要特殊处理。
 */
export function buildWatermarkSvg(spec: WatermarkSpec): string {
  const text = escapeXml(spec.text);
  const fontSize = watermarkFontSize(spec.width, spec.height);
  const { w, h } = tileSize(spec.text, fontSize);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(spec.width)}" height="${Math.ceil(spec.height)}">`,
    '<defs>',
    `<pattern id="wm" patternUnits="userSpaceOnUse" width="${w}" height="${h}" patternTransform="rotate(${ANGLE})">`,
    `<text x="${w / 2}" y="${h / 2}" font-family="${escapeXml(FONT_STACK)}" font-size="${fontSize}" ` +
      `fill="${escapeXml(spec.ink)}" fill-opacity="${OPACITY}" text-anchor="middle" dominant-baseline="central">` +
      `${text}</text>`,
    '</pattern>',
    '</defs>',
    '<rect width="100%" height="100%" fill="url(#wm)"/>',
    '</svg>',
  ].join('');
}

/** data URI 用 encodeURIComponent 而不是 btoa：水印文字可能是中文，btoa 会直接抛 */
export function watermarkCssUrl(spec: WatermarkSpec): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildWatermarkSvg(spec))}")`;
}

/**
 * 往一个已定位的容器里盖一层水印。
 *
 * `zIndex` 由调用方给：整墙图里卡片本身带内联 z-index（最大可达几千），
 * 水印必须显式压过它们，不能指望"DOM 顺序靠后就在上面"。
 */
export function appendWatermark(
  host: HTMLElement,
  spec: WatermarkSpec,
  zIndex: number,
): HTMLElement {
  const layer = host.ownerDocument.createElement('div');
  layer.className = 'note-watermark';
  layer.setAttribute('aria-hidden', 'true');
  /*
   * 尺寸必须是显式像素，不能用 `inset: 0`：整墙的 `.export-wall` 里卡片全是绝对定位，
   * 容器自身高度是 0 —— inset 铺出来的水印层也是 0×0，一个像素都不会画（实测踩到）。
   */
  layer.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    `width:${Math.ceil(spec.width)}px`,
    `height:${Math.ceil(spec.height)}px`,
    `z-index:${zIndex}`,
    'pointer-events:none',
    'border-radius:inherit',
    // 圆角必须继承：卡片没有 overflow:hidden，不裁的话四角会露出直角水印
    `background-image:${watermarkCssUrl(spec)}`,
    'background-repeat:repeat',
  ].join(';');
  host.append(layer);
  return layer;
}
