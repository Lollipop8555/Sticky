/**
 * 背景材质与调色池的 id 定义 + 主题应用。
 * 这里只管「把状态写到 documentElement 与 meta 上」，不持有状态：
 * 状态在 prefs（storage 层），渲染侧只调 applyXxx。
 */

export const BACKGROUNDS = ['paper', 'kraft', 'grid', 'blackboard'] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const PALETTE_IDS = ['macaron', 'monet'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/**
 * 展示名集中在这里：设置面板与导入时的"包里是什么外观"必须说同一套话，
 * 否则同一份 settings 在两处叫法不同，用户会以为是两回事。
 */
export const BACKGROUND_LABELS: Record<Background, string> = {
  paper: '纸白',
  kraft: '牛皮纸',
  grid: '网格纸',
  blackboard: '黑板',
};

export const PALETTE_LABELS: Record<PaletteId, string> = {
  macaron: '马卡龙',
  monet: '莫奈',
};

/**
 * 与 tokens.css 里的 --canvas 必须一致；改色时两边一起改。
 * 黑板是 `#000` 而不是"近黑"：绝大多数像素压在纯黑附近才拿得到 OLED 的省电收益（决策 18），
 * 层次感交给纹理与卡片，不靠底色抬亮。
 */
export const CANVAS_THEME_COLOR: Record<Background, string> = {
  paper: '#F5F2EC',
  kraft: '#E7DCC9',
  grid: '#F7F5F0',
  blackboard: '#000000',
};

export function isBackground(value: unknown): value is Background {
  return typeof value === 'string' && (BACKGROUNDS as readonly string[]).includes(value);
}

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value);
}

/**
 * 当前**生效**的背景 = DOM 上那个 dataset。
 *
 * 渲染侧一律读它、不读 prefs：`?bg=blackboard` 这种预览口只改 dataset 不改 prefs，
 * 若卡片色去读 prefs，就会出现"底色是黑板、卡片还是浅色态"的错配（实测踩到）。
 * dataset 由 `applyVisuals` / `applyBackground` 统一写，boot 里早于任何卡片挂载。
 */
export function activeBackground(doc: Document = document): Background {
  const value = doc.documentElement.dataset['background'];
  return isBackground(value) ? value : 'paper';
}

/**
 * 应用背景材质。
 * 只写 dataset 与 theme-color —— 便签颜色由 displayColor() 按需派生，不在这里遍历卡片。
 */
export function applyBackground(
  bg: Background,
  doc: Document = document,
): void {
  const root = doc.documentElement;
  root.dataset['background'] = bg;
  root.style.colorScheme = bg === 'blackboard' ? 'dark' : 'light';

  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = CANVAS_THEME_COLOR[bg];
}

export function applyPalette(palette: PaletteId, doc: Document = document): void {
  doc.documentElement.dataset['palette'] = palette;
}

/**
 * 可辨认下限 7px（tech-design §2.4）：LOD 的阈值全部由它推导，所以只有一个来源。
 * 写在 CSS 变量上而不是硬编码进样式表 —— 改字号时 LOD 阈值必须跟着走，
 * 否则用户把字号调大后，卡在"文字已消失"和"文字已出现"之间会看到一段空白区。
 */
export const MIN_READABLE_PX = 7;

export function applyTypography(baseFontSize: number, doc: Document = document): void {
  const root = doc.documentElement;
  root.style.setProperty('--base-font-size', `${baseFontSize}px`);
  root.style.setProperty('--s-text-min', String(MIN_READABLE_PX / baseFontSize));
}
