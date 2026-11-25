/**
 * 便签配色：色池、邻域自动取色、按背景的明度变换、按对比度选文本色（决策 28/30）。
 *
 * 只有**基色**入库（浅色态的池内 hex）；显示色与文本色都是派生值，渲染时现算。
 * 存派生值会在换背景时与主题失同步，而这正是本文件存在的理由。
 *
 * 没有取色 UI：新建便签自动从池里挑一个邻域用得最少的颜色。
 */

import type { Background, PaletteId } from '@/app/theme';
import type { NoteRecord } from '@/storage/types';

export interface ColorPool {
  id: PaletteId;
  name: string;
  /** 组内色相均分；扩池 = 加一个角度 */
  hues: readonly number[];
  s: number;
  l: number;
}

/**
 * 12 色而不是 8：取色是"半径 400 内用得最少者优先"，池子小了很快就全用过一遍，
 * 只能重复最近的色，墙看起来就成了条纹。12 色在这个半径内几乎不会撞。
 */
export const POOLS: readonly ColorPool[] = [
  { id: 'macaron', name: '马卡龙', hues: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], s: 62, l: 90 },
  { id: 'monet', name: '莫奈', hues: [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345], s: 26, l: 86 },
];

/* ---------------------------------------------------------------- 颜色数学 */

export interface Hsl {
  /** 0..360 */
  h: number;
  /** 0..100 */
  s: number;
  /** 0..100 */
  l: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [0, 0, 0];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function hexToHsl(hex: string): Hsl {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  const rgb: [number, number, number] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/** WCAG 相对亮度（0..1）。文本色的选择全靠它，不要用 HSL 的 L 近似 —— 两者差距很大 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两个相对亮度之间的对比度（1..21）。参数是先算好的亮度，批量比对时不重复解析 hex */
export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ 色池 */

const poolCache = new Map<string, readonly string[]>();

/**
 * 池内所有基色（hex），带缓存：池是静态的，没必要每次新建卡都算 12 次 HSL→hex。
 * 未知池 id 回落到第一个池 —— 坏数据不该让"建卡"这条主路径抛错。
 */
export function poolColors(poolId: string): readonly string[] {
  const hit = poolCache.get(poolId);
  if (hit) return hit;

  const pool = POOLS.find((p) => p.id === poolId) ?? POOLS[0];
  const colors = pool ? pool.hues.map((h) => hslToHex(h, pool.s, pool.l)) : [];
  poolCache.set(poolId, colors);
  return colors;
}

/* -------------------------------------------------------- 显示色与文本色 */

/**
 * 背景对明度的压缩系数。
 *
 * blackboard 取 0.28 而不是设计稿的 0.38：绿色/黄色档在 l≈34% 时相对亮度落在
 * 0.167–0.279 这个"死区"——深色文本（#1F2937）不够 4.5，浅色文本（#F8FAFC）也不够，
 * 两种文本都读不清（实测最差 3.88，出在 hue 75 的黄绿）。压到 0.28 后最差 5.96。
 * `tests/unit/palette.test.ts` 里那条 96 组合断言就是这条系数的守门人。
 */
const L_FACTOR: Record<Background, number> = { paper: 1, kraft: 0.94, grid: 1, blackboard: 0.28 };

const displayCache = new Map<string, string>();

/** 显示色：只改 HSL 的 L，色相与饱和度不动 —— 同一张卡在任何背景下都是同一个颜色身份 */
export function displayColor(base: string, bg: Background = 'paper'): string {
  const key = `${bg}:${base}`;
  const hit = displayCache.get(key);
  if (hit) return hit;

  const { h, s, l } = hexToHsl(base);
  const shown = hslToHex(h, s, clamp(l * L_FACTOR[bg], 12, 96));
  displayCache.set(key, shown);
  return shown;
}

const LIGHT_TEXT = '#F8FAFC';
const DARK_TEXT = '#1F2937';
const textCache = new Map<string, string>();

/**
 * 文本色：在深浅两种里挑与显示色对比度更高的那个。
 * 按显示色缓存，全局最多 24×4 = 96 条，换主题时不用重算。
 */
export function textColor(display: string): string {
  const hit = textCache.get(display);
  if (hit) return hit;

  const y = relativeLuminance(display);
  const onDark = contrastRatio(y, relativeLuminance(DARK_TEXT));
  const onLight = contrastRatio(y, relativeLuminance(LIGHT_TEXT));
  const chosen = onLight >= onDark ? LIGHT_TEXT : DARK_TEXT;

  textCache.set(display, chosen);
  return chosen;
}

/* ---------------------------------------------------------------- 毛线色 */

/** 深色背景（目前只有黑板）：线的色要往上提，往下压就糊进底色里了 */
const DARK_BACKGROUNDS: ReadonlySet<Background> = new Set<Background>(['blackboard']);

const threadCache = new Map<string, string>();

/**
 * 连线的端点色 = 卡片显示色"深一档（浅底）/ 亮一档（深底）"。
 *
 * 不能复用 `textColor()`：那是"能不能读清"的两档墨色，无论卡片什么颜色都只会回
 * `#1F2937` 或 `#F8FAFC`，一条线的两端必然同色 —— 渐变还在，但看不出渐变。
 * 这里保留卡片自己的色相、把饱和度抬一点、明度往"在底色上看得见"的方向推一档：
 * 两端色相不同线才有渐变，且任何材质下都不会糊掉。
 */
export function threadColor(display: string, bg: Background = 'paper'): string {
  const key = `${bg}:${display}`;
  const hit = threadCache.get(key);
  if (hit) return hit;

  const { h, s, l } = hexToHsl(display);
  const sat = clamp(s + 10, 0, 96);
  // 浅底上压到中途（l≈26–50 才够对比又不发黑），深底上抬到 50 以上
  const value = DARK_BACKGROUNDS.has(bg)
    ? hslToHex(h, sat, clamp(l + 34, 50, 78))
    : hslToHex(h, sat, clamp(l * 0.5, 26, 50));

  threadCache.set(key, value);
  return value;
}

/* -------------------------------------------------------------- 自动取色 */

/** 统计半径（世界单位）。400 大约是一屏 1 倍缩放时看得见的范围 */
const PICK_RADIUS = 400;

/** FNV-1a：并列时的确定性破并列 —— 用 Math.random 会让同一张卡每次重建都换颜色 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface PickColorOpts {
  poolId: string;
  notes: Iterable<NoteRecord>;
  /** 新卡中心的世界坐标 */
  cx: number;
  cy: number;
  /** 新卡 id：并列时的破并列种子 */
  id: string;
}

/**
 * 邻域内用得最少的池内色。
 *
 * 池外色（老数据、导入包）**计入统计但不作为候选**：它能影响"哪个色用得少"，
 * 但不会让新卡继承一个已被淘汰的颜色。
 */
export function pickColor({ poolId, notes, cx, cy, id }: PickColorOpts): string {
  const pool = poolColors(poolId);
  if (pool.length === 0) return '#FFFFFF';

  const counts = new Map<string, number>(pool.map((color) => [color, 0]));
  const r2 = PICK_RADIUS * PICK_RADIUS;

  for (const note of notes) {
    // 按卡片中心算距离：记录里存的是左上角，直接用 x/y 会让"大卡"的统计偏向左上
    const dx = note.x + note.width / 2 - cx;
    const dy = note.y + note.height / 2 - cy;
    if (dx * dx + dy * dy > r2) continue;
    counts.set(note.bgColor, (counts.get(note.bgColor) ?? 0) + 1);
  }

  let min = Number.POSITIVE_INFINITY;
  for (const count of counts.values()) min = Math.min(min, count);

  const candidates = pool.filter((color) => counts.get(color) === min);
  const picked = candidates[hash(id) % candidates.length];
  return picked ?? pool[0] ?? '#FFFFFF';
}

/** 仅供测试：清空派生色缓存（断言"换背景真的重算了"时用） */
export function __resetPaletteCache(): void {
  displayCache.clear();
  textCache.clear();
  threadCache.clear();
}
