/**
 * 悬浮控件（impl-04 §1）：新建 FAB + 概览 / 设置 / 简数。
 *
 * 两个容易踩的点：
 * 1. **FAB 的显隐只认 state**：`createMode` 一改就得立刻反映，不能等下一次渲染；
 *    所以 `sync()` 由设置面板直接调用，而不是靠监听器凑。
 * 2. 按钮全部带 `data-no-pan`，且自己 `stopPropagation` —— 点设置不该顺便拖画布。
 *    （手势层挂在 `#viewport` 上，本来也收不到，但按钮将来可能移到画布内部。）
 *
 * 分组（决策 64）：
 * - **功能按钮**（`.fab`）：新建，主动作，实心强调色、带投影；
 * - **常驻按钮**（`.controls-dock` 里）：概览与设置，中性胶囊、无投影。
 * 两组右下角纵向排，右缘对齐 —— FAB 正好落在"设置"按钮上方，不会出现
 * "56px 圆钮和 40px 圆钮各自居中、看起来错开半个像素"的观感问题。
 */

import { getPrefs } from '@/app/prefs';
import { store } from '@/app/store';
import { ICONS, lineIcon, materialIcon } from '@/ui/icons';

export interface ControlsOptions {
  onCreate(): void;
  onOverview(): void;
  onSettings(): void;
  onTrash(): void;
}

export interface Controls {
  /** 读取最新 prefs + 便签数，刷新 FAB 显隐与计数 */
  sync(): void;
  detach(): void;
}

/**
 * 废纸篓入口（左下）。M2 不做"拖进去删除"：卡片拖动已经被长按占用，
 * 再叠一个投放区会让"想挪一下位置"变成"删掉了"。删除走卡片上的 ×，
 * 这里只负责打开面板（恢复 / 清空）。
 */
function mountTrashAnchor(doc: Document): HTMLElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'trash-anchor';
  el.setAttribute('data-no-pan', '');
  el.setAttribute('aria-label', '废纸篓');
  el.title = '废纸篓（恢复或清空已删除的便签）';
  el.append(lineIcon(['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5']));
  return el;
}

export function mountControls(
  root: HTMLElement,
  options: ControlsOptions,
  doc: Document = document,
): Controls {
  const wrap = doc.createElement('div');
  wrap.className = 'controls';
  wrap.setAttribute('data-no-pan', '');

  const fab = doc.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.dataset['act'] = 'create';
  fab.setAttribute('aria-label', '新建便签');
  fab.title = '新建便签（双击空白也可以）';
  fab.append(materialIcon(ICONS.add));

  // 常驻区：概览（图标 + 数量胶囊）与设置，横排一行
  const dock = doc.createElement('div');
  dock.className = 'controls-dock';

  // 只放数字的话"这是个按钮"完全是靠位置猜的：给个四宫格图标，数量退成右侧的胶囊标签
  const overview = doc.createElement('button');
  overview.type = 'button';
  overview.className = 'ctl ctl-overview';
  overview.dataset['act'] = 'overview';
  overview.append(materialIcon(ICONS.gridView));

  const count = doc.createElement('span');
  count.className = 'ctl-count';
  count.setAttribute('aria-hidden', 'true');
  overview.append(count);

  const settingsBtn = doc.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'ctl';
  settingsBtn.dataset['act'] = 'settings';
  settingsBtn.setAttribute('aria-label', '设置');
  settingsBtn.title = '设置';
  settingsBtn.append(materialIcon(ICONS.settings));

  dock.append(overview, settingsBtn);
  wrap.append(fab, dock);

  // 按钮不是画布的一部分，但它们在 body 上：点击必须自己止住冒泡到底层手势
  wrap.addEventListener('pointerdown', (event) => event.stopPropagation());
  fab.addEventListener('click', () => options.onCreate());
  overview.addEventListener('click', () => options.onOverview());
  settingsBtn.addEventListener('click', () => options.onSettings());

  const trash = mountTrashAnchor(doc);
  trash.addEventListener('click', () => options.onTrash());
  root.append(wrap, trash);

  function sync(): void {
    const prefs = getPrefs();
    // 移动模式里 FAB 常驻：没有双击，它就是唯一的新建入口
    fab.hidden = !(prefs.mobileMode || prefs.createMode === 'fab');
    const n = store.count();
    count.textContent = String(n);
    overview.setAttribute('aria-label', `查看全部（${n} 张便签）`);
    overview.title = `查看全部（${n} 张）`;
  }

  sync();
  const offNotes = store.subscribeNotes(sync);

  return {
    sync,
    detach() {
      offNotes();
      wrap.remove();
      trash.remove();
    },
  };
}
