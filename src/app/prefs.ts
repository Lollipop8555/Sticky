/**
 * 偏好：内存态 + 落库 + 主题联动。
 *
 * 读一次（boot），之后所有读写都在内存里，写库走 writeQueue —— UI 永远不需要 await 改设置。
 * 这里不 import storage（除了类型与默认值），落库动作由 main.ts 注入的 saver 完成。
 */

import { markPrefsDirty } from '@/storage/writeQueue';
import {
  DEFAULT_PREFS,
  DEFAULT_VIEWPORT,
  type PrefsRecord,
  type SettingsRecord,
  type ViewportRecord,
} from '@/storage/types';

import { applyLocale, isLocale } from '@/i18n';
import { applyBackground, applyPalette, applyTypography } from './theme';

let current: PrefsRecord = { ...DEFAULT_PREFS, lastViewport: { ...DEFAULT_VIEWPORT } };

/** 视觉相关的字段变了才需要重刷主题，纯行为字段（wheelMode 等）改动不该触发全量重绘 */
const VISUAL_KEYS = ['background', 'palette', 'baseFontSize'] as const;

export function getPrefs(): Readonly<PrefsRecord> {
  return current;
}

/** 把主题/排版写到 DOM 上。boot 与 updatePrefs 共用，避免两条路径各写一套 */
export function applyVisuals(prefs: PrefsRecord = current, doc: Document = document): void {
  applyBackground(prefs.background, doc);
  applyPalette(prefs.palette, doc);
  applyTypography(prefs.baseFontSize, doc);
}

/** boot 用：接管读到的偏好并点亮主题。不落库（刚读出来，没必要写回去） */
export function initPrefs(stored: PrefsRecord, doc: Document = document): void {
  current = {
    ...DEFAULT_PREFS,
    ...stored,
    // 老库没有 lang / 库里被写坏了都兜回中文：语言错了整个界面都是天书，不能靠"缺省解构"碰运气
    lang: isLocale(stored.lang) ? stored.lang : DEFAULT_PREFS.lang,
    lastViewport: { ...stored.lastViewport },
  };
  applyVisuals(current, doc);
  // 语言先于任何 UI 挂载：boot 后面的 buildControls / 卡片都用 t() 取文案
  applyLocale(current.lang, doc);
}

/** 改偏好：同步生效 + 标脏。返回是否有视觉字段变化（调用方可据此决定是否重绘卡片） */
export function updatePrefs(patch: Partial<SettingsRecord>, doc: Document = document): boolean {
  const langChanged = isLocale(patch.lang) && patch.lang !== current.lang;
  current = { ...current, ...patch };

  const visualChanged = VISUAL_KEYS.some((key) => key in patch);
  if (visualChanged) applyVisuals(current, doc);
  // 换语言不重绘卡片：卡片上的文案是 data-i18n 指纹，applyLocale 会就地改字（决策 69）
  if (langChanged) applyLocale(current.lang, doc);

  markPrefsDirty();
  return visualChanged;
}

export function setZCounter(value: number): void {
  if (value <= current.zCounter) return; // z 必须单调递增，回退会让卡片沉到别的卡下面
  current = { ...current, zCounter: value };
  markPrefsDirty();
}

export function nextZ(): number {
  setZCounter(current.zCounter + 1);
  return current.zCounter;
}

/**
 * 记忆视野。拖动时每帧都会调一次，但真正落库由 writeQueue 的 400ms 节流兜住：
 * 一秒钟几十次调用最多写 2~3 次库，且写的是"最后一次"的值。
 */
export function rememberViewport(viewport: ViewportRecord): void {
  const last = current.lastViewport;
  if (last.panX === viewport.panX && last.panY === viewport.panY && last.scale === viewport.scale) {
    return;
  }
  current = { ...current, lastViewport: { ...viewport } };
  markPrefsDirty();
}

export function rememberSettings(): SettingsRecord {
  const {
    background,
    palette,
    defaultNoteWidth,
    baseFontSize,
    wheelMode,
    createMode,
    mobileMode,
    mobilePromptSeen,
    onboarded,
    lang,
  } = current;
  return {
    background,
    palette,
    defaultNoteWidth,
    baseFontSize,
    wheelMode,
    createMode,
    mobileMode,
    mobilePromptSeen,
    onboarded,
    lang,
  };
}

/** 仅供测试：把内存态复位 */
export function __resetPrefs(): void {
  current = { ...DEFAULT_PREFS, lastViewport: { ...DEFAULT_VIEWPORT } };
}
