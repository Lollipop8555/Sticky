/**
 * 设置面板（impl-04 §2）。原生 `<dialog>`：焦点陷阱、Esc、::backdrop 都是白送的。
 *
 * **没有"保存"按钮**：每个控件 change 就写回 prefs，由 main 注入的 `onPrefs`
 * 负责落库与副作用。面板自己不持有状态 —— 它只是 prefs 的一个视图，
 * 这样"设置里改的"和"别处改的"永远是同一个真相。
 */

import { BACKGROUND_LABELS, BACKGROUNDS, PALETTE_IDS, PALETTE_LABELS } from '@/app/theme';
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

function section(doc: Document, title: string): HTMLElement {
  const sec = el(doc, 'section', 'sheet-section');
  sec.append(el(doc, 'h3', 'sheet-subtitle', title));
  return sec;
}

/** 单选组：语义上是 fieldset + radio，视觉上是分段控件 */
function segmented<T extends string>(
  doc: Document,
  field: keyof SettingsRecord,
  legend: string,
  values: readonly T[],
  label: (v: T) => string,
): HTMLFieldSetElement {
  const fs = el(doc, 'fieldset', 'field');
  fs.dataset['field'] = field;
  fs.append(el(doc, 'legend', 'field-legend', legend));

  const opts = el(doc, 'div', 'opts');
  for (const v of values) {
    const labelEl = el(doc, 'label', 'opt');
    const input = el(doc, 'input');
    input.type = 'radio';
    input.name = field;
    input.value = v;
    input.dataset['field'] = field;
    labelEl.append(input, el(doc, 'span', undefined, label(v)));
    opts.append(labelEl);
  }
  fs.append(opts);
  return fs;
}

export function mountSettings(options: SettingsOptions, doc: Document = document): SettingsPanel {
  const dialog = el(doc, 'dialog', 'sheet sheet-settings');
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const head = el(doc, 'header', 'sheet-head');
  const title = el(doc, 'h2', 'sheet-title', '设置');
  title.id = 'settings-title';
  const close = el(doc, 'button', 'sheet-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭设置');
  head.append(title, close);

  const body = el(doc, 'div', 'sheet-body');

  // ---- 外观 ----
  const look = section(doc, '外观');
  look.append(
    segmented(doc, 'background', '背景', BACKGROUNDS, (v) => BACKGROUND_LABELS[v]),
    segmented(doc, 'palette', '新便签配色', PALETTE_IDS, (v) => PALETTE_LABELS[v]),
  );

  // ---- 交互 ----
  const feel = section(doc, '交互');
  feel.append(
    segmented(doc, 'wheelMode', '滚轮', ['pan', 'zoom'] as const, (v) =>
      v === 'pan' ? '平移画布' : '缩放画布',
    ),
    segmented(doc, 'createMode', '新建方式', ['dblclick', 'fab'] as const, (v) =>
      v === 'dblclick' ? '双击空白' : '右下角 ＋',
    ),
  );

  const mobileRow = el(doc, 'label', 'opt opt-row');
  const mobileInput = el(doc, 'input');
  mobileInput.type = 'checkbox';
  mobileInput.dataset['field'] = 'mobileMode';
  const mobileText = el(doc, 'span', undefined, '移动兼容模式');
  const mobileHint = el(doc, 'small', 'opt-hint', '图标放大，手柄常驻');
  mobileRow.append(mobileInput, mobileText, mobileHint);
  feel.append(mobileRow);

  // ---- 数据 ----
  const data = section(doc, '数据');
  const usage = el(doc, 'p', 'usage', '正在统计…');
  usage.setAttribute('data-act', 'usage');
  const row = el(doc, 'div', 'sheet-row');
  const exportBtn = el(doc, 'button', 'btn data-export', '导出 ZIP');
  exportBtn.type = 'button';
  exportBtn.title = '把墙上全部便签与图片打包下载（不含废纸篓）';
  const importBtn = el(doc, 'button', 'btn data-import', '导入 ZIP');
  importBtn.type = 'button';
  importBtn.title = '从备份包追加便签，不会覆盖现有内容';
  const wallBtn = el(doc, 'button', 'btn data-wall', '导出整墙图片');
  wallBtn.type = 'button';
  wallBtn.title = '按当前便签布局导出一张大图';
  const row2 = el(doc, 'div', 'sheet-row');
  row.append(exportBtn, importBtn);
  row2.append(wallBtn);
  data.append(usage, row, row2);

  exportBtn.addEventListener('click', () => options.onExportBundle());
  importBtn.addEventListener('click', () => options.onImportBundle());
  wallBtn.addEventListener('click', () => options.onExportWall());

  // ---- 帮助 ----
  const details = el(doc, 'details', 'sheet-help');
  details.append(el(doc, 'summary', undefined, '帮助'));
  const help = el(doc, 'ul', 'help-list');
  const tips = [
    '双击空白：新建便签；双击便签：编辑',
    '长按便签（桌面 0.4s / 触摸 0.3s）或按住顶部手柄：拖动',
    '滚轮：按设置平移或缩放；Ctrl/⌘ + 滚轮：始终缩放',
    'Esc：关闭窗口 / 取消拖动 / 退出编辑',
    '删除：卡片右上角 × 移入废纸篓，3 秒内可撤销',
    '废纸篓（左下）：恢复便签；按住「清空」3 秒才真的清空',
    '拖入或粘贴图片：建一张图片便签；单击图片看大图',
    '复制：卡片右上角复制按钮把便签变成图片放进剪贴板',
  ];
  for (const t of tips) help.append(el(doc, 'li', undefined, t));
  const version = el(doc, 'p', 'help-version', `版本 ${__APP_VERSION__}`);
  details.append(help, version);

  body.append(look, feel, data, details);
  dialog.append(head, body);
  doc.body.append(dialog);

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
        usage.textContent = '存储用量不可用';
        return;
      }
      usage.textContent =
        typeof quota === 'number' && quota > 0
          ? `已用 ${formatBytes(used)} / 配额 ${formatBytes(quota)}`
          : `已用 ${formatBytes(used)}`;
    } catch {
      usage.textContent = '存储用量不可用';
    }
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
  // 每次打开都回填一次：设置可能在别处被改过，面板不能显示上一个会话的选中项
  dialog.addEventListener('close', () => {
    // 焦点回到触发它的按钮由浏览器管；这里只清临时状态
  });

  return {
    open() {
      refresh();
      void refreshUsage();
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    refresh,
  };
}
