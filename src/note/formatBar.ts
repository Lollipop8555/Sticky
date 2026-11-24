/**
 * 卡内格式条。挂在卡片元素里（世界层），所以跟着画布缩放一起缩放 —— 与"工具条在卡上"的直觉一致。
 *
 * 为什么不是 BubbleMenu：bubble 需要 tippy 定位，而我们已经有"卡在世界里的位置"这个更准的锚点；
 * 一个固定在卡上方的工具条既能覆盖触摸设备（没有 hover、更不会有悬浮菜单），
 * 也省掉一个依赖与一套定位/翻转逻辑。
 *
 * 关键交互细节：按钮的 `pointerdown` 必须 `preventDefault`。
 * 一旦默认行为发生，焦点从 PM 移走 → 选区塌陷 → 点"粗体"变成"选中当前词再取消选中"。
 */

import { setAria, setText, setTitle, type MessageKey } from '@/i18n';
import { ICONS, materialIcon } from '@/ui/icons';

import type { EditorHandle, FormatAction, FormatState } from './editor';

interface BtnSpec {
  action: FormatAction | 'link';
  icon: readonly string[];
  /** 文案键而不是字符串：工具条随编辑会话即时构建，切语言不会留着旧词 */
  title: MessageKey;
}

/**
 * 一律用图标，不混排文字（决策 64）：`• 列表` / `1. 列表` 这种标签只要卡一窄就会换行；
 * 而且文字按钮的粗细/斜体是"用样式假装图标"，和真图标放一起比例永远对不齐。
 * 图标按钮的语义交给 `title` + `aria-label`，鼠标/读屏都能拿到。
 */
const BUTTONS: BtnSpec[] = [
  { action: 'bold', icon: ICONS.bold, title: 'fmt.bold' },
  { action: 'italic', icon: ICONS.italic, title: 'fmt.italic' },
  { action: 'strike', icon: ICONS.strike, title: 'fmt.strike' },
  { action: 'code', icon: ICONS.code, title: 'fmt.code' },
  { action: 'link', icon: ICONS.link, title: 'fmt.link' },
  { action: 'bulletList', icon: ICONS.bulletList, title: 'fmt.bullet' },
  { action: 'orderedList', icon: ICONS.orderedList, title: 'fmt.ordered' },
];

const isButton = (action: FormatAction | 'link'): action is FormatAction => action !== 'link';

export interface FormatBar {
  /** 选区/格式变化时由编辑层转发过来 */
  sync(state: FormatState): void;
  dispose(): void;
}

export function mountFormatBar(card: HTMLElement, handle: EditorHandle): FormatBar {
  const bar = document.createElement('div');
  bar.className = 'note-format';
  // 画布手势看到它就什么都不做（见 gestures.ts：data-no-pan 早于长按/平移判断）
  bar.setAttribute('data-no-pan', '');
  bar.setAttribute('role', 'toolbar');
  setAria(bar, 'fmt.toolbar');

  const buttons = new Map<FormatAction | 'link', HTMLButtonElement>();

  for (const spec of BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-format-btn';
    button.dataset['fmt'] = spec.action;
    button.append(materialIcon(spec.icon));
    setTitle(button, spec.title);
    setAria(button, spec.title);
    buttons.set(spec.action, button);
    bar.append(button);
  }

  // 链接输入：不弹 window.prompt（会被浏览器拦、也没法在缩放后的世界里定位）
  const linkForm = document.createElement('form');
  linkForm.className = 'note-format-link';
  linkForm.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'url';
  input.autocomplete = 'off';
  input.placeholder = 'https://…';
  setAria(input, 'fmt.linkInput');

  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'note-format-btn note-format-apply';
  setText(apply, 'fmt.apply');

  linkForm.append(input, apply);
  bar.append(linkForm);

  const hideLinkForm = (): void => {
    linkForm.hidden = true;
  };

  const submitLink = (): void => {
    const href = input.value.trim();
    // 已有链接时留空 = 去掉链接；没有链接时留空 = 取消
    if (href === '' && !handle.formatState().active.link) {
      hideLinkForm();
      return;
    }
    handle.setLink(href === '' ? null : href);
    hideLinkForm();
  };

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitLink();
  });

  // Esc 只关输入框，不该继续冒泡成"退出编辑"（shortcuts.ts 在 document 上兜 Esc）
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    hideLinkForm();
  });

  /** 按钮上的 pointerdown 一律挡掉默认行为：焦点与选区必须留在 PM 里 */
  bar.addEventListener('pointerdown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  });

  bar.addEventListener('click', (event) => {
    const target = event.target;
    // 按钮里现在是内联 SVG：点到的 target 会变成 SVGPathElement，
    // 用 HTMLElement 判断会把"点图标"整条丢掉（点图标边缘才有效，非常难复现）
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLButtonElement>('[data-fmt]')?.dataset['fmt'] as
      | FormatAction
      | 'link'
      | undefined;
    if (!action) return;

    if (action === 'link') {
      // 已有链接：点一下就是取消（比"打开输入框再清空"少一步）
      if (handle.formatState().active.link) {
        handle.setLink(null);
        hideLinkForm();
        return;
      }
      linkForm.hidden = false;
      input.value = '';
      input.focus();
      return;
    }

    if (isButton(action)) {
      hideLinkForm();
      handle.toggle(action);
    }
  });

  const sync = (state: FormatState): void => {
    for (const [action, button] of buttons) {
      const on = state.active[action];
      // 只有真的变了才写，否则每次按键都要重排一遍工具条
      if (button.getAttribute('aria-pressed') !== String(on)) {
        button.setAttribute('aria-pressed', String(on));
      }
    }
  };

  sync(handle.formatState());
  card.append(bar);

  return {
    sync,
    dispose: () => bar.remove(),
  };
}
