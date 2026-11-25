/**
 * 废纸篓面板（interaction-spec §8 / impl-06 S13）。
 *
 * 三个设计点：
 * 1. **行内不显示完整正文**，只给三行概要 + 相对时间。废纸篓不是阅读器，
 *    它的用途是"认出是哪张"然后点恢复；三行足够认出，渲染整篇只是白烧帧。
 * 2. **清空要按住 3 秒**（按钮里的横向充能条，见 ui.css `.trash-purge`），
 *    不用 confirm 弹窗：清空是不可撤销的，但确认框会让"顺手点错"变成"顺手点两下"。
 *    长按把"确认"变成成本，且不打断视线。
 *    降到 motion-reduce 时环形动画没意义，改成"点一下变红 → 再点确认"，
 *    同样要求两次明确输入（决策 57）。
 * 3. 面板**不缓存列表**：每次打开重新读库。缓存就要处理"别处删了/恢复了"的失效，
 *    而这一步的成本只有一次 IndexedDB 查询。
 */

import { onLocaleChange, setAria, setText, t } from '@/i18n';
import type { NoteRecord } from '@/storage/types';
import { relativeTime, trashSummary } from '@/trash/summary';
import { emptyTrash, listTrash, restoreNote } from '@/trash/trash';
import { lineIcon } from '@/ui/icons';
import { toast } from '@/ui/toast';

export interface TrashPanel {
  open(): void;
  close(): void;
  refresh(): Promise<void>;
}

/** 清空需要按住的时长。写死 3000：和"撤销 3 秒"是同一个心理窗口，不引入第二套节拍 */
export const HOLD_MS = 3000;
const CONFIRM_MS = 3000;



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

export function mountTrashPanel(doc: Document = document): TrashPanel {
  const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const dialog = el(doc, 'dialog', 'sheet sheet-trash');
  dialog.setAttribute('aria-labelledby', 'trash-title');
  // 同设置面板：初始焦点给 dialog，避免 showModal() 落在关闭按钮上显出蓝环
  dialog.tabIndex = -1;

  const head = el(doc, 'header', 'sheet-head');
  // 静态文案走指纹：面板关着的时候切语言，再打开也是新语言
  const title = el(doc, 'h2', 'sheet-title');
  setText(title, 'trash.title');
  title.id = 'trash-title';
  const count = el(doc, 'span', 'trash-count');
  count.setAttribute('aria-live', 'polite');
  // 同设置面板：线描叉，不用字形 ×（字形墨迹在行盒里不居中，圆底托不住）
  const close = el(doc, 'button', 'sheet-close');
  close.type = 'button';
  close.append(lineIcon(['M3 3l18 18', 'M21 3 3 21'], 1.7));
  setAria(close, 'trash.close');
  head.append(title, count, close);

  const list = el(doc, 'ul', 'trash-list');
  const blank = el(doc, 'p', 'trash-blank', t('trash.empty'));
  const body = el(doc, 'div', 'sheet-body trash-body');
  body.append(blank, list);

  const foot = el(doc, 'footer', 'sheet-actions');
  const purge = el(doc, 'button', 'btn btn-danger trash-purge');
  purge.type = 'button';
  purge.dataset['act'] = 'purge';
  const purgeLabel = el(doc, 'span', 'trash-purge-label');
  purge.append(purgeLabel);
  foot.append(purge);

  dialog.append(head, body, foot);
  doc.body.append(dialog);

  // 列表刷新是异步的，两次刷新可能交错（打开面板 + 刚清空）。用版本号丢弃过期结果
  let version = 0;

  function row(record: NoteRecord): HTMLLIElement {
    const li = el(doc, 'li', 'trash-row');
    li.dataset['id'] = record.id;

    // 颜色点用原始 bgColor：面板在控件层，不跟随黑板背景做压暗，
    // 这一小块只是"哪张"的线索，不需要承担对比度
    const dot = el(doc, 'span', 'trash-dot');
    dot.style.background = record.bgColor;
    dot.setAttribute('aria-hidden', 'true');

    const lines = trashSummary(record.contentMd);
    const text = el(doc, 'div', 'trash-text');
    for (const line of lines) text.append(el(doc, 'p', 'trash-line', line));
    text.append(el(doc, 'p', 'trash-time', relativeTime(record.deletedAt ?? record.updatedAt)));

    const restore = el(doc, 'button', 'btn trash-restore', t('trash.restore'));
    restore.type = 'button';
    restore.dataset['restore'] = record.id;
    // 概要本身没有语义，读屏只念「恢复」会不知道恢复是哪张
    restore.setAttribute('aria-label', t('trash.restoreAria', { s: lines[0] ?? '' }));

    li.append(dot, text, restore);
    return li;
  }

  async function refresh(): Promise<void> {
    const mine = ++version;
    let rows: NoteRecord[];
    try {
      rows = await listTrash();
    } catch (error) {
      // 无痕模式/库被降级时读不到。面板不能因此变空白（看起来像"废纸篓里的都丢了"）
      console.error('[trash] 读取废纸篓失败', error);
      if (mine === version) {
        list.replaceChildren();
        blank.textContent = t('trash.loadFailed');
        blank.hidden = false;
        purge.disabled = true;
        count.textContent = '';
      }
      return;
    }
    if (mine !== version) return;
    list.replaceChildren(...rows.map(row));
    blank.textContent = t('trash.empty');
    blank.hidden = rows.length > 0;
    purge.disabled = rows.length === 0;
    // 数量塞进标题栏而不是另起一行：面板的可用高度全给列表
    count.textContent = rows.length > 0 ? t('trash.count', { n: rows.length }) : '';
  }

  // ---------- 恢复 ----------

  dialog.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const btn = event.target.closest<HTMLButtonElement>('[data-restore]');
    if (!btn) return;
    const id = btn.dataset['restore'];
    if (!id) return;
    btn.disabled = true;
    void restoreNote(id)
      .then(async (result) => {
        if (result === 'missing') toast(t('trash.gone'));
        // 原坐标不在视野里才会 relocation —— 必须说一声，否则用户以为恢复失败了
        else if (result === 'relocated') toast(t('trash.relocated'));
        await refresh();
      })
      .catch((error: unknown) => {
        console.error('[trash] 恢复失败', error);
        toast(t('trash.restoreFailed'));
        btn.disabled = false;
      });
  });

  // ---------- 清空：长按 3 秒 / 降级两次点击 ----------

  let raf = 0;
  let startedAt = 0;
  let holding = false;
  let inside = true;
  let confirmTimer = 0;
  let armed = false;
  let busy = false;

  // 三种状态共用同一个 label 节点：文案随状态与语言变，所以只能现算，不能挂 data-i18n
  function paintPurgeLabel(): void {
    purgeLabel.textContent = armed
      ? t('trash.purgeConfirm')
      : reduceMotion
        ? t('trash.purgeIdle')
        : t('trash.purgeHold');
  }

  paintPurgeLabel();

  const paint = (p: number): void => {
    purge.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
  };

  function reset(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    holding = false;
    inside = true;
    paint(0);
    purge.classList.remove('is-holding');
  }

  function disarm(): void {
    armed = false;
    window.clearTimeout(confirmTimer);
    paintPurgeLabel();
    purge.classList.remove('is-armed');
  }

  async function purgeAll(): Promise<void> {
    if (busy) return;
    busy = true;
    purge.disabled = true;
    try {
      const { removed, freed } = await emptyTrash();
      toast(
        removed === 0
          ? t('trash.alreadyEmpty')
          : freed > 0
            ? t('trash.emptiedFreed', { n: removed, m: freed })
            : t('trash.emptied', { n: removed }),
      );
      disarm();
    } catch (error) {
      // 清空是"删了就没有"的操作，失败必须说出来；按钮交回给 refresh 重新启用
      console.error('[trash] 清空失败', error);
      toast(t('trash.purgeFailed'));
    } finally {
      busy = false;
    }
    await refresh();
  }

  function frame(now: number): void {
    if (!holding) return;
    const p = (now - startedAt) / HOLD_MS;
    if (p < 1) {
      paint(p);
      raf = requestAnimationFrame(frame);
      return;
    }
    // 指针已经滑出按钮：这一下不算数，从小红点重新开始
    if (!inside) {
      reset();
      return;
    }
    reset();
    void purgeAll();
  }

  const pointerInside = (event: PointerEvent): boolean => {
    const rect = purge.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  };

  purge.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || purge.disabled) return;
    event.preventDefault();
    holding = true;
    inside = true;
    startedAt = performance.now();
    purge.classList.add('is-holding');
    paint(0);
    // 捕获指针：手指按住时划出按钮也要继续收到 move/up，否则进度会卡在某个值上
    purge.setPointerCapture?.(event.pointerId);
    raf = requestAnimationFrame(frame);
  });

  purge.addEventListener('pointermove', (event) => {
    if (!holding) return;
    inside = pointerInside(event);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    purge.addEventListener(type, () => {
      // 进度没走满就松手：按钮外观收回，什么也不发生
      if (holding) reset();
    });
  }

  purge.addEventListener('contextmenu', (event) => {
    if (!holding) return;
    event.preventDefault();
  });

  if (reduceMotion) {
    purge.addEventListener('click', () => {
      if (purge.disabled || busy) return;
      if (!armed) {
        armed = true;
        purge.classList.add('is-armed');
        paintPurgeLabel();
        confirmTimer = window.setTimeout(disarm, CONFIRM_MS);
        return;
      }
      void purgeAll();
    });
  }

  // 键盘等价物：按住 Enter/Space 同样累计 3 秒（不能只给指针用户）
  purge.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat || holding || purge.disabled) return;
    holding = true;
    startedAt = performance.now();
    purge.classList.add('is-holding');
    paint(0);
    raf = requestAnimationFrame(frame);
  });
  purge.addEventListener('keyup', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (holding) reset();
  });
  purge.addEventListener('blur', () => {
    if (holding) reset();
  });

  // ---------- 开关 ----------

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    reset();
    if (armed) disarm();
  });

  /*
   * 切语言：面板是单例，标题靠指纹已换好；剩下的都是"按状态现算"的文案
   * （清空按钮、空态、行内相对时间），关着就先只修空态，打开时 refresh 会重画全表。
   */
  onLocaleChange(() => {
    paintPurgeLabel();
    if (dialog.open) void refresh();
    else blank.textContent = t('trash.empty');
  });

  return {
    open() {
      if (!dialog.open) {
        dialog.showModal();
        dialog.focus();
      }
      void refresh();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    refresh,
  };
}
