/**
 * 数据区块的对话框：导出确认、导入偏好询问、导入汇总。
 *
 * 每个对话框**用一次就扔**（close 后 `remove()`）：它们不是常驻 UI，
 * 留着三个空 `<dialog>` 只会让"Esc 到底关了谁"变复杂。
 *
 * 不用 `<form method="dialog">`：CSP 里 `form-action 'none'` 会把表单提交整条掐掉，
 * 这些面板必须能在最严格的策略下工作（同 ui/mobilePrompt.ts）。
 */

import { backgroundLabel, paletteLabel, isBackground, isPaletteId } from '@/app/theme';
import { t } from '@/i18n';
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
function present(doc: Document, title: string, lines: readonly string[], confirmLabel = t('io.gotIt')): void {
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
    t('io.exportTitle'),
    (body) => {
      body.append(el(doc, 'p', 'dialog-line', t('io.exportBodyNotes', { n: counts.notes })));
      body.append(
        el(
          doc,
          'p',
          'dialog-line',
          counts.trashed > 0
            ? t('io.exportSkipTrash', { n: counts.trashed })
            : t('io.exportNoTrash'),
        ),
      );
    },
    [
      { label: t('io.cancel'), value: '' },
      { label: t('io.export'), value: 'yes', primary: true },
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
    t('io.prefsTitle'),
    (body) => {
      // 包里的值来自外部文件，先过一遍类型守卫：坏值不能让界面出现 "背景 undefined"
      const parts: string[] = [];
      const bg = settings.background;
      if (isBackground(bg)) parts.push(t('io.prefsBg', { v: backgroundLabel(bg) }));
      const palette = settings.palette;
      if (isPaletteId(palette)) parts.push(t('io.prefsPalette', { v: paletteLabel(palette) }));
      body.append(
        el(
          doc,
          'p',
          'dialog-line',
          parts.length > 0 ? t('io.prefsBodyList', { list: parts.join(' · ') }) : t('io.prefsBodyAny'),
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
      row.append(check, el(doc, 'span', undefined, t('io.prefsApply')));
      body.append(row);
    },
    [
      { label: t('io.cancel'), value: '' },
      { label: t('io.importNotes'), value: 'yes', primary: true },
    ],
  );
  if (value !== 'yes') return null;
  return checked;
}

/** 汇总：加入多少、改名多少、跳过多少、偏好有没有应用 */
export function showImportSummary(result: ImportResult, doc: Document = document): void {
  if (result.added === 0) {
    present(doc, t('io.summaryEmptyTitle'), [
      t('io.summaryEmptyBody'),
      result.skipped > 0
        ? t('io.summarySkipped', { n: result.skipped })
        : t('io.summaryWrongBundle'),
    ]);
    return;
  }

  const lines = [t('io.summaryAdded', { n: result.added })];
  if (result.renamedNotes > 0) {
    lines.push(t('io.summaryRenamed', { n: result.renamedNotes }));
  }
  if (result.renamedAssets > 0) {
    lines.push(t('io.summaryAssetsRenamed', { n: result.renamedAssets }));
  }
  if (result.skipped > 0) lines.push(t('io.summarySkipped', { n: result.skipped }));
  lines.push(
    !result.hasSettings
      ? t('io.summaryNoSettings')
      : result.preferencesApplied
        ? t('io.summaryApplied')
        : t('io.summaryKept'),
  );

  present(doc, t('io.summaryTitle'), lines);
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
