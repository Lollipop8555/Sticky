/**
 * 数据区块的对话框：导出确认、导入偏好询问、导入汇总。
 *
 * 每个对话框**用一次就扔**（close 后 `remove()`）：它们不是常驻 UI，
 * 留着三个空 `<dialog>` 只会让"Esc 到底关了谁"变复杂。
 *
 * 不用 `<form method="dialog">`：CSP 里 `form-action 'none'` 会把表单提交整条掐掉，
 * 这些面板必须能在最严格的策略下工作（同 ui/mobilePrompt.ts）。
 */

import { BACKGROUND_LABELS, PALETTE_LABELS } from '@/app/theme';
import type { ImportResult, LibraryCounts } from '@/io/importFlow';
import type { SettingsRecord } from '@/storage/types';

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

/** 无按钮的展示型对话框（汇总）：弹出来即可，不产生返回值 */
function present(doc: Document, title: string, lines: readonly string[], confirmLabel = '知道了'): void {
  const dialog = el(doc, 'dialog', 'sheet sheet-prompt');
  const titleEl = el(doc, 'h2', 'sheet-title', title);
  titleEl.id = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', titleEl.id);

  const body = el(doc, 'div', 'sheet-text dialog-text');
  for (const line of lines) body.append(el(doc, 'p', 'dialog-line', line));

  const actions = el(doc, 'div', 'sheet-actions');
  const ok = el(doc, 'button', 'btn btn-primary', confirmLabel);
  ok.type = 'button';
  ok.addEventListener('click', () => dialog.close('ok'));
  actions.append(ok);

  dialog.append(titleEl, body, actions);
  dialog.addEventListener('close', () => dialog.remove());
  doc.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    // 无 top-layer 支持（jsdom / 老 WebView）：至少让调用方不挂——直接移除
    dialog.remove();
  }
}

function openWithActions(
  doc: Document,
  title: string,
  buildBody: (body: HTMLElement) => void,
  actions: ReadonlyArray<{ label: string; value: string; primary?: boolean }>,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const dialog = el(doc, 'dialog', 'sheet sheet-prompt');
    const titleEl = el(doc, 'h2', 'sheet-title', title);
    titleEl.id = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    dialog.setAttribute('aria-labelledby', titleEl.id);

    const body = el(doc, 'div', 'sheet-text dialog-text');
    buildBody(body);

    const foot = el(doc, 'div', 'sheet-actions');
    for (const action of actions) {
      const btn = el(doc, 'button', action.primary ? 'btn btn-primary' : 'btn', action.label);
      btn.type = 'button';
      btn.dataset['value'] = action.value;
      btn.addEventListener('click', () => dialog.close(action.value));
      foot.append(btn);
    }

    dialog.append(titleEl, body, foot);

    let settled = false;
    dialog.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      const value = dialog.returnValue;
      dialog.remove();
      resolve(value);
    });

    doc.body.append(dialog);
    try {
      dialog.showModal();
    } catch {
      // 弹不出来就当"取消"：不能因为对话框不可用就默默把库导出去/写进来
      settled = true;
      dialog.remove();
      resolve('');
    }
  });
}

/** 导出前确认：必须把"废纸篓不导出"说清楚（决策 15） */
export async function confirmExport(counts: LibraryCounts, doc: Document = document): Promise<boolean> {
  const value = await openWithActions(
    doc,
    '导出整库备份',
    (body) => {
      body.append(el(doc, 'p', 'dialog-line', `导出内容包含墙上全部 ${counts.notes} 张便签及其图片。`));
      body.append(
        el(
          doc,
          'p',
          'dialog-line',
          counts.trashed > 0
            ? `废纸篓中的 ${counts.trashed} 张便签不会被导出。`
            : '废纸篓为空，没有额外内容会被跳过。',
        ),
      );
    },
    [
      { label: '取消', value: '' },
      { label: '导出', value: 'yes', primary: true },
    ],
  );
  return value === 'yes';
}

/**
 * 导入时问"要不要应用包内的外观设置"（决策 23：默认不勾）。
 *
 * @returns `true` 应用 / `false` 保持当前 / `null` 用户放弃这次导入
 */
export async function askApplyPrefs(
  settings: Partial<SettingsRecord>,
  doc: Document = document,
): Promise<boolean | null> {
  let checked = false;
  const value = await openWithActions(
    doc,
    '导入设置',
    (body) => {
      const parts: string[] = [];
      if (settings.background) parts.push(`背景 ${BACKGROUND_LABELS[settings.background] ?? settings.background}`);
      if (settings.palette) parts.push(`配色 ${PALETTE_LABELS[settings.palette] ?? settings.palette}`);
      body.append(
        el(
          doc,
          'p',
          'dialog-line',
          parts.length > 0 ? `包里附带的外观设置：${parts.join(' · ')}` : '包里附带了一份外观设置。',
        ),
      );

      const row = el(doc, 'label', 'opt opt-row');
      const check = el(doc, 'input');
      check.type = 'checkbox';
      check.checked = false; // 默认不勾：先问，再改用户的界面
      check.dataset['field'] = 'importPrefs';
      check.addEventListener('change', () => {
        checked = check.checked;
      });
      row.append(check, el(doc, 'span', undefined, '应用包内的背景与配色'));
      body.append(row);
    },
    [
      { label: '取消', value: '' },
      { label: '导入便签', value: 'yes', primary: true },
    ],
  );
  if (value !== 'yes') return null;
  return checked;
}

/** 汇总：加入多少、改名多少、跳过多少、偏好有没有应用 */
export function showImportSummary(result: ImportResult, doc: Document = document): void {
  if (result.added === 0) {
    present(doc, '没有导入任何便签', [
      '这个包里没有可识别的便签文件。',
      result.skipped > 0 ? `跳过 ${result.skipped} 个无法解析的文件。` : '请确认选择的是本站导出的 ZIP 备份。',
    ]);
    return;
  }

  const lines = [`新增 ${result.added} 张便签。`];
  if (result.renamedNotes > 0) {
    lines.push(`其中 ${result.renamedNotes} 张因 id 重复，已改名 -1 保存。`);
  }
  if (result.renamedAssets > 0) lines.push(`图片同步改名 ${result.renamedAssets} 张，正文引用已重写。`);
  if (result.skipped > 0) lines.push(`跳过 ${result.skipped} 个无法解析的文件。`);
  lines.push(
    !result.hasSettings
      ? '包里没有外观设置，当前主题保持不变。'
      : result.preferencesApplied
        ? '偏好：已应用包内的背景与配色。'
        : '偏好：保持当前外观。',
  );

  present(doc, '导入完成', lines);
}

/** 选一个 ZIP：`<input type=file>` 是唯一在所有浏览器都能唤起文件选择器的方式 */
export function pickZipFile(doc: Document = document): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    const input = el(doc, 'input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.hidden = true;

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    // 部分浏览器（Safari）取消会触发 cancel；不触发的就让它挂着，不产生副作用
    input.addEventListener('cancel', () => finish(null));

    doc.body.append(input);
    input.click();
  });
}
