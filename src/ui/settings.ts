/**
 * 设置面板（impl-04 §2）。原生 `<dialog>`：焦点陷阱、Esc、::backdrop 都是白送的。
 *
 * **没有"保存"按钮**：每个控件 change 就写回 prefs，由 main 注入的 `onPrefs`
 * 负责落库与副作用。面板自己不持有状态 —— 它只是 prefs 的一个视图，
 * 这样"设置里改的"和"别处改的"永远是同一个真相。
 *
 * 文案（决策 69）：静态标签挂 `data-i18n` 指纹，切语言时 `applyLocale` 全局重写一遍，
 * 面板**不重建**（重建会丢展开状态、滚动位置和焦点）；带数字的两处（用量、版本号）
 * 订阅 `onLocaleChange` 自己重算。
 */

import {
  LOCALES,
  LOCALE_LABELS,
  onLocaleChange,
  setAria,
  setText,
  setTitle,
  t,
  type Locale,
  type MessageKey,
} from '@/i18n';
import { BACKGROUND_LABEL_KEYS, BACKGROUNDS, PALETTE_IDS, PALETTE_LABEL_KEYS } from '@/app/theme';
import type { PrefsRecord, SettingsRecord } from '@/storage/types';

export interface SettingsOptions {
  getPrefs(): Readonly<PrefsRecord>;
  /** 改偏好：同步生效 + 落库 + 副作用（由 main 提供） */
  onPrefs(patch: Partial<SettingsRecord>): void;
  /** 数据区块的三个入口：流程与文案都在 main / ioDialogs 里，面板只负责触发 */
  onExportBundle(): void;
  onImportBundle(): void;
  onExportWall(): void;
}

export interface SettingsPanel {
  open(): void;
  close(): void;
  /** 从 prefs 重新回填控件（外部改了偏好时用；正常路径不需要） */
  refresh(): void;
}

/** 只读展示用：navigator.storage.estimate() 在 Safari 上可能缺席 */
function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[i] ?? 'B'}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 带文案键的元素：建的时候就写值，切语言由 localize 按指纹重写 */
function txt<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  key: MessageKey,
): HTMLElementTagNameMap[K] {
  const node = el(doc, tag, className);
  setText(node, key);
  return node;
}

function section(doc: Document, titleKey: MessageKey): HTMLElement {
  const sec = el(doc, 'section', 'sheet-section');
  sec.append(txt(doc, 'h3', 'sheet-subtitle', titleKey));
  return sec;
}

/**
 * 选项标签：多数是文案键（切语言要变），语言名是字面量（"中文"/"English" 不翻译）。
 * 用联合类型而不是 "空 key 就原样输出"，免得哪天漏了键把 `settings.foo` 显示到界面上。
 */
type LabelRef = MessageKey | { literal: string };

function paintLabel(node: Element, ref: LabelRef): void {
  if (typeof ref === 'string') setText(node, ref);
  else node.textContent = ref.literal;
}

/** 单选组：语义上是 fieldset + radio，视觉上是分段控件 */
function segmented<T extends string>(
  doc: Document,
  field: keyof SettingsRecord,
  legendKey: MessageKey,
  values: readonly T[],
  label: (v: T) => LabelRef,
): HTMLFieldSetElement {
  const fs = el(doc, 'fieldset', 'field');
  fs.dataset['field'] = field;
  fs.append(txt(doc, 'legend', 'field-legend', legendKey));

  const opts = el(doc, 'div', 'opts');
  for (const v of values) {
    const labelEl = el(doc, 'label', 'opt');
    const input = el(doc, 'input');
    input.type = 'radio';
    input.name = field;
    input.value = v;
    input.dataset['field'] = field;
    const text = el(doc, 'span');
    paintLabel(text, label(v));
    labelEl.append(input, text);
    opts.append(labelEl);
  }
  fs.append(opts);
  return fs;
}

/** 用量文案是异步来的 + 带数字，只能自己维护状态再重绘，不能靠指纹 */
type UsageState =
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'used'; used: number; quota?: number };

export function mountSettings(options: SettingsOptions, doc: Document = document): SettingsPanel {
  const dialog = el(doc, 'dialog', 'sheet sheet-settings');
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const head = el(doc, 'header', 'sheet-head');
  const title = txt(doc, 'h2', 'sheet-title', 'settings.title');
  title.id = 'settings-title';
  const close = el(doc, 'button', 'sheet-close', '×');
  close.type = 'button';
  setAria(close, 'settings.close');
  setTitle(close, 'settings.close');
  head.append(title, close);

  const body = el(doc, 'div', 'sheet-body');

  // ---- 语言 ----
  // 放最前：英文用户第一次进设置时，得先看得懂"Language"才能改别的（语言名本身不翻译）
  const language = section(doc, 'settings.language');
  language.append(
    segmented<Locale>(doc, 'lang', 'settings.languageField', LOCALES, (v) => ({
      literal: LOCALE_LABELS[v],
    })),
  );

  // ---- 外观 ----
  const look = section(doc, 'settings.appearance');
  look.append(
    segmented(doc, 'background', 'settings.background', BACKGROUNDS, (v) => BACKGROUND_LABEL_KEYS[v]),
    segmented(doc, 'palette', 'settings.palette', PALETTE_IDS, (v) => PALETTE_LABEL_KEYS[v]),
  );

  // ---- 交互 ----
  const feel = section(doc, 'settings.feel');
  feel.append(
    segmented(doc, 'wheelMode', 'settings.wheel', ['pan', 'zoom'] as const, (v) =>
      v === 'pan' ? 'settings.wheelPan' : 'settings.wheelZoom',
    ),
    segmented(doc, 'createMode', 'settings.createMode', ['dblclick', 'fab'] as const, (v) =>
      v === 'dblclick' ? 'settings.createDbl' : 'settings.createFab',
    ),
  );

  const mobileRow = el(doc, 'label', 'opt opt-row');
  const mobileInput = el(doc, 'input');
  mobileInput.type = 'checkbox';
  mobileInput.dataset['field'] = 'mobileMode';
  const mobileText = txt(doc, 'span', '', 'settings.mobile');
  const mobileHint = txt(doc, 'small', 'opt-hint', 'settings.mobileHint');
  mobileRow.append(mobileInput, mobileText, mobileHint);
  feel.append(mobileRow);

  // ---- 数据 ----
  const data = section(doc, 'settings.data');
  const usage = el(doc, 'p', 'usage');
  usage.setAttribute('data-act', 'usage');
  let usageState: UsageState = { kind: 'pending' };

  const row = el(doc, 'div', 'sheet-row');
  const exportBtn = txt(doc, 'button', 'btn data-export', 'settings.exportZip');
  exportBtn.type = 'button';
  setTitle(exportBtn, 'settings.exportZipTitle');
  const importBtn = txt(doc, 'button', 'btn data-import', 'settings.importZip');
  importBtn.type = 'button';
  setTitle(importBtn, 'settings.importZipTitle');
  const wallBtn = txt(doc, 'button', 'btn data-wall', 'settings.exportWall');
  wallBtn.type = 'button';
  setTitle(wallBtn, 'settings.exportWallTitle');
  const row2 = el(doc, 'div', 'sheet-row');
  row.append(exportBtn, importBtn);
  row2.append(wallBtn);
  data.append(usage, row, row2);

  exportBtn.addEventListener('click', () => options.onExportBundle());
  importBtn.addEventListener('click', () => options.onImportBundle());
  wallBtn.addEventListener('click', () => options.onExportWall());

  // ---- 帮助 ----
  const details = el(doc, 'details', 'sheet-help');
  details.append(txt(doc, 'summary', '', 'settings.help'));
  const help = el(doc, 'ul', 'help-list');
  const tips: readonly MessageKey[] = [
    'settings.helpTip1',
    'settings.helpTip2',
    'settings.helpTip3',
    'settings.helpTip4',
    'settings.helpTip5',
    'settings.helpTip6',
    'settings.helpTip7',
    'settings.helpTip8',
  ];
  for (const key of tips) help.append(txt(doc, 'li', '', key));
  const version = el(doc, 'p', 'help-version');
  details.append(help, version);

  body.append(language, look, feel, data, details);
  dialog.append(head, body);
  doc.body.append(dialog);

  function paintUsage(): void {
    usage.textContent =
      usageState.kind === 'pending'
        ? t('settings.usagePending')
        : usageState.kind === 'unavailable'
          ? t('settings.usageUnavailable')
          : usageState.quota !== undefined
            ? t('settings.usageOf', {
                used: formatBytes(usageState.used),
                quota: formatBytes(usageState.quota),
              })
            : t('settings.usageUsed', { used: formatBytes(usageState.used) });
  }

  function paintVersion(): void {
    version.textContent = t('settings.version', { v: __APP_VERSION__ });
  }

  paintUsage();
  paintVersion();

  function refresh(): void {
    const prefs = options.getPrefs();
    for (const input of dialog.querySelectorAll<HTMLInputElement>('input[data-field]')) {
      const field = input.dataset['field'] as keyof SettingsRecord | undefined;
      if (!field) continue;
      const value = prefs[field];
      input.checked = input.type === 'checkbox' ? value === true : value === input.value;
    }
  }

  async function refreshUsage(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      const used = est?.usage;
      const quota = est?.quota;
      if (typeof used !== 'number') {
        usageState = { kind: 'unavailable' };
      } else {
        usageState = {
          kind: 'used',
          used,
          quota: typeof quota === 'number' && quota > 0 ? quota : undefined,
        };
      }
    } catch {
      usageState = { kind: 'unavailable' };
    }
    paintUsage();
  }

  // 事件委托：面板里的控件会变，逐个挂监听器就是给自己找漏挂的机会
  dialog.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement | null;
    const field = input?.dataset['field'] as keyof SettingsRecord | undefined;
    if (!input || !field) return;
    const patch: Partial<SettingsRecord> =
      input.type === 'checkbox'
        ? ({ [field]: input.checked } as Partial<SettingsRecord>)
        : ({ [field]: input.value } as Partial<SettingsRecord>);
    options.onPrefs(patch);
  });

  // 点遮罩关闭：命中 dialog 本体（而不是 body 里任何子元素）才算点到外面
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  close.addEventListener('click', () => dialog.close());

  // 面板是单例、活到页面结束，所以不需要解绑；解了反而会让"切语言后面板还是旧文案"
  onLocaleChange(() => {
    paintUsage();
    paintVersion();
  });

  return {
    open() {
      refresh();
      usageState = { kind: 'pending' };
      paintUsage();
      void refreshUsage();
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    refresh,
  };
}
