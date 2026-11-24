/**
 * 双语（zh / en）运行时。默认中文，设置面板可切换 —— 选择落在 prefs 里（决策 69）。
 *
 * 为什么不是"渲染前把文案查好塞进 JSX"：这个项目没有框架，UI 是**挂载一次、之后只 patch**
 * 的原生 DOM（卡片尤其如此，重建会丢焦点、丢选区）。所以语言切换必须能做到
 * "已经挂在墙上的节点换个文案"，否则切一次语言就得整墙重建。
 *
 * 两条路径：
 * 1. **静态文案**：`setText` / `setAria` / `setTitle` / `setPlaceholder` 在节点上留一个
 *    `data-i18n*` 指纹，切换语言时 `localize(document)` 按指纹重写一遍。节点还是那个节点，
 *    事件监听、焦点、Tiptap 实例全都不受影响。
 * 2. **动态文案**（带数字的、随状态变的）：调用方在 `onLocaleChange` 里自己重算
 *    —— 这类文本本来就每次状态变化都要重算，多一个订阅不会引入第二套真相。
 *
 * 副作用只有两个：`<html lang>` 与 `data-locale`（e2e 断言用），外加 `document.title`。
 */

import { EN, ZH, type MessageKey } from './messages';

export type { MessageKey } from './messages';

export type Locale = 'zh' | 'en';

export const LOCALES = ['zh', 'en'] as const;

/** 语言名**不翻译**：中文用户找 "English"，英文用户找 "中文"，都是按母语找 */
export const LOCALE_LABELS: Record<Locale, string> = { zh: '中文', en: 'English' };

const DICT: Record<Locale, Record<MessageKey, string>> = { zh: ZH, en: EN };

let locale: Locale = 'zh';
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

export function getLocale(): Locale {
  return locale;
}

/** `<html lang>` 用完整的 BCP 47 标签：`zh` 太笼统，读屏会按"未知中文"处理 */
export function htmlLang(value: Locale = locale): string {
  return value === 'en' ? 'en' : 'zh-CN';
}

/** 取文案。缺键时回中文而不是抛错：文案缺失不该让整个界面崩掉 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const raw = DICT[locale][key] ?? ZH[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/** 语言变了要做副作用的模块（动态文案、只读缓存）订阅这里 */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* -------------------------------------------------------------- DOM 指纹 */

const ATTR_TEXT = 'data-i18n';
const ATTR_ARIA = 'data-i18n-aria';
const ATTR_TITLE = 'data-i18n-title';
const ATTR_PLACEHOLDER = 'data-i18n-ph';

export function setText(node: Element, key: MessageKey): void {
  node.setAttribute(ATTR_TEXT, key);
  node.textContent = t(key);
}

export function setAria(node: Element, key: MessageKey): void {
  node.setAttribute(ATTR_ARIA, key);
  node.setAttribute('aria-label', t(key));
}

export function setTitle(node: Element, key: MessageKey): void {
  node.setAttribute(ATTR_TITLE, key);
  if (node instanceof HTMLElement) node.title = t(key);
}

export function setPlaceholder(node: Element, key: MessageKey): void {
  node.setAttribute(ATTR_PLACEHOLDER, key);
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    node.placeholder = t(key);
  }
}

/**
 * 按指纹重写整棵子树。**只改文案，不碰结构** —— 这也是它能安全地跑在
 * 正在编辑的卡片和打开着的设置面板上的原因。
 */
export function localize(root: ParentNode): void {
  for (const node of root.querySelectorAll(`[${ATTR_TEXT}]`)) {
    const key = node.getAttribute(ATTR_TEXT);
    if (key) node.textContent = t(key as MessageKey);
  }
  for (const node of root.querySelectorAll(`[${ATTR_ARIA}]`)) {
    const key = node.getAttribute(ATTR_ARIA);
    if (key) node.setAttribute('aria-label', t(key as MessageKey));
  }
  for (const node of root.querySelectorAll(`[${ATTR_TITLE}]`)) {
    const key = node.getAttribute(ATTR_TITLE);
    if (key && node instanceof HTMLElement) node.title = t(key as MessageKey);
  }
  for (const node of root.querySelectorAll(`[${ATTR_PLACEHOLDER}]`)) {
    const key = node.getAttribute(ATTR_PLACEHOLDER);
    if (key && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      node.placeholder = t(key as MessageKey);
    }
  }
}

/**
 * 切换到某语言并立刻生效。boot 时由 `initPrefs` 调一次，之后由 `updatePrefs` 调。
 *
 * @param doc 注入点只为单测（jsdom 里也能断言 lang 与 title）
 */
export function applyLocale(next: Locale, doc: Document = document): void {
  locale = next;

  const root = doc.documentElement;
  root.lang = htmlLang(next);
  // 页面自带的静态文案（index.html 里 title / meta）也要跟着走
  root.dataset['locale'] = next;
  doc.title = t('app.title');

  const description = doc.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('app.description'));
  const appleTitle = doc.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', t('app.title'));

  localize(doc);

  for (const fn of [...listeners]) fn();
}

/** 仅供测试：把运行时状态复位（内存态，不碰 prefs） */
export function __resetLocale(): void {
  locale = 'zh';
  listeners.clear();
}
