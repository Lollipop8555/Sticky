/**
 * 首次在触屏设备上访问时问一次"要不要开启移动兼容模式"（impl-04 §3）。
 *
 * 必须在**挂载画布之前**问完：先渲染一版 40px 的桌面控件再跳成 48px，
 * 用户看到的是闪一下；而且 `data-mobile` 一变，长按阈值、手柄常驻都要跟着重算。
 *
 * 只问一次：`mobilePromptSeen` 落库。用户选"不用了"也记住了 —— 反复询问
 * 比"猜错了"更烦人，随时可以在设置里改。
 */

import { updatePrefs } from '@/app/prefs';
import type { PrefsRecord } from '@/storage/types';
import { flush } from '@/storage/writeQueue';

export function isTouchDevice(win: Window = window): boolean {
  try {
    if (win.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    // 极老的浏览器没有 matchMedia：退化到下面的 touchPoints 判断
  }
  return win.navigator.maxTouchPoints > 0;
}

async function ask(doc: Document): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const dialog = doc.createElement('dialog');
    dialog.className = 'sheet sheet-prompt';

    const title = doc.createElement('h2');
    title.className = 'sheet-title';
    title.id = 'mobile-prompt-title';
    title.textContent = '开启移动兼容模式？';
    dialog.setAttribute('aria-labelledby', title.id);

    const body = doc.createElement('p');
    body.className = 'sheet-text';
    body.textContent = '图标会变大，并在每张便签顶部常驻拖拽手柄。之后可以在设置里随时改。';

    // 不用 <form method="dialog">：CSP 里 form-action 'none' 会把表单提交整条掐掉，
    // 而这个面板必须能在最严格的策略下工作。两个按钮直接 close(value) 更直白。
    const actions = doc.createElement('div');
    actions.className = 'sheet-actions';

    const no = doc.createElement('button');
    no.type = 'button';
    no.className = 'btn';
    no.textContent = '不用了';
    no.addEventListener('click', () => dialog.close('no'));

    const yes = doc.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn-primary';
    yes.textContent = '开启';
    yes.addEventListener('click', () => dialog.close('yes'));

    actions.append(no, yes);
    dialog.append(title, body, actions);

    let settled = false;
    dialog.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      const choice = dialog.returnValue === 'yes';
      dialog.remove();
      resolve(choice);
    });

    doc.body.append(dialog);
    try {
      dialog.showModal();
    } catch {
      // jsdom / 无 top-layer 支持的环境：当作"不问"，不要让 boot 挂掉
      settled = true;
      dialog.remove();
      resolve(false);
    }
  });
}

/**
 * 返回最终的移动模式。桌面设备或已经问过时直接返回现状，不动 DOM。
 */
export async function maybeAskMobileMode(
  prefs: Readonly<PrefsRecord>,
  isTouch: boolean,
  doc: Document = document,
): Promise<boolean> {
  if (prefs.mobilePromptSeen || !isTouch) return prefs.mobileMode;

  const choice = await ask(doc);
  updatePrefs({ mobilePromptSeen: true, mobileMode: choice });
  // 这是一次性的决定，必须当场落库：用户点完"不用了"立刻关页面，
  // 若只靠 400ms 节流，下次访问还得再被问一遍。一次 await 换掉一个反复出现的弹窗。
  await flush();
  return choice;
}
