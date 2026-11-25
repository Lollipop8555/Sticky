/**
 * 记录类型 = 库里的真相。UI 层只读这里定义的字段，别处再派生（显示色、文本色都不入库）。
 * 字段取舍的理由见 tech-design §3.1，这里只保留「为什么是这个形状」的注释。
 */

import type { Background, PaletteId } from '@/app/theme';
import type { Locale } from '@/i18n';

export interface NoteRecord {
  id: string;
  /** 世界坐标（左上角）。几何计算一律用记录，不读 DOM 矩形——scale 极小时 rect 会退化 */
  x: number;
  y: number;
  /** 世界单位：所有便签同宽，新建时取偏好（默认 320），不支持单卡 resize（决策 23/64） */
  width: number;
  /** 内容撑开的实测高度；图片便签 = width * 图高 / 图宽。远视角色块要靠它还原比例 */
  height: number;
  /** 空便签的下限；新建文字便签默认等于宽度（1:1），图片便签仍是 160 */
  minHeight: number;
  z: number;
  /** 调色板基色（浅色态）。显示色由主题派生，不存派生值，否则换主题就失同步 */
  bgColor: string;
  /** 唯一真相：正文只存 markdown，不存 PM doc（PM schema 会变，md 不会） */
  contentMd: string;
  createdAt: number;
  updatedAt: number;
  /** null = 在墙上；时间戳 = 在废纸篓。注意 IDB 索引不容纳 null，所以按它查只会查到废纸篓 */
  deletedAt: number | null;
}

/**
 * 连线：全局无向 id 对（决策 73）。约定 `a < b` 排序归一，`a|b` 即唯一键。
 * 不放进 NoteRecord —— 两边各存一份就会有"A 说连着、B 说没连"的裂缝。
 */
export type LinkPair = readonly [string, string];

export interface AssetRecord {
  /** uuid v4 = 文件名主体，contentMd 里以 assets/<id>.<ext> 引用 */
  id: string;
  mime: string;
  ext: string;
  blob: Blob;
  /** 原始像素尺寸，图片便签初始比例要用；免去解 Blob 量尺寸 */
  w: number;
  h: number;
  createdAt: number;
}

/** settings 行：只有用户可改的偏好 */
export interface SettingsRecord {
  background: Background;
  palette: PaletteId;
  defaultNoteWidth: number;
  baseFontSize: number;
  wheelMode: 'pan' | 'zoom';
  createMode: 'dblclick' | 'fab';
  mobileMode: boolean;
  /** 导出的图片是否叠水印（决策 88）。屏幕上的便签墙永远不画它 */
  watermarkOn: boolean;
  /** 水印文字；空串表示"用默认文案"。存**用户原话**，不翻译（语言只翻界面） */
  watermarkText: string;
  mobilePromptSeen: boolean;
  /**
   * 首访的示例便签是否已经放过（决策 65）。
   * 不是可调偏好，也不随库导出：它的唯一职责是"别每次都往空墙上塞一张欢迎卡"。
   */
  onboarded: boolean;
  /**
   * 界面语言（决策 69）。默认中文；英文只翻界面文案，**不动**已存在的便签正文。
   * 它是"这台设备怎么看"的偏好，所以不随 ZIP 导出/导入走。
   */
  lang: Locale;
}

export interface ViewportRecord {
  panX: number;
  panY: number;
  scale: number;
}

/** 内存里的完整偏好：库中拆成 settings / viewport / counters / links 四行，读出来合并成一个对象 */
export interface PrefsRecord extends SettingsRecord {
  lastViewport: ViewportRecord;
  zCounter: number;
  /**
   * 全局边集（决策 73）。**故意不放进 SettingsRecord**：
   * `updatePrefs()` 那种"改偏好"的入口不该顺手改到连接关系，只留专门的读写口。
   */
  links: LinkPair[];
  schemaVersion: number;
}

/** prefs 是 keyPath 'key' 的键值表；value 的形状随 key 变，所以这里用联合类型而不是 any */
export type PrefsRow =
  | { key: 'settings'; value: SettingsRecord }
  | { key: 'viewport'; value: ViewportRecord }
  | { key: 'counters'; value: { zCounter: number } }
  /**
   * 老库没有这一行 —— 不种它、不升 SCHEMA_VERSION：IDB 只有 bump 版本才会走
   * `onupgradeneeded`，为一行键值数据升版本反而要写迁移。读不到就是空边集。
   */
  | { key: 'links'; value: LinkPair[] };

export const DEFAULT_SETTINGS: SettingsRecord = {
  background: 'paper',
  palette: 'macaron',
  // 320：260 宽在 16px 字号下一行只放十来个汉字，写两句就得滚；默认高度与之相等（1:1）
  defaultNoteWidth: 320,
  baseFontSize: 16,
  wheelMode: 'pan',
  createMode: 'dblclick',
  mobileMode: false,
  // 默认关：没跟用户打过招呼就往他的分享图里加字，是替他做决定
  watermarkOn: false,
  watermarkText: '',
  mobilePromptSeen: false,
  // 默认 false：全新库里该由 boot 放进那张示例便签。老库由 migrate / loadPrefs 兜成 true
  onboarded: false,
  lang: 'zh',
};

export const DEFAULT_VIEWPORT: ViewportRecord = { panX: 0, panY: 0, scale: 1 };

export const DEFAULT_PREFS: PrefsRecord = {
  ...DEFAULT_SETTINGS,
  lastViewport: { ...DEFAULT_VIEWPORT },
  zCounter: 0,
  links: [],
  schemaVersion: 1,
};

export const SCHEMA_VERSION = 1;
