/**
 * 全局提示条（impl-04 §4）。
 *
 * 三个约束决定了实现方式：
 * 1. **同时最多一条** —— 保存失败可能连发好几次，堆成一列会把画布挡掉；新的直接顶掉旧的；
 * 2. **不参与 Tab 序列**（除非带 action）—— 提示不该打断键盘用户正在做的事；
 * 3. 容器懒创建 —— 绝大多数会话从不弹提示，boot 时不该多一个空节点。
 */

export interface ToastOptions {
  action?: { label: string; run(): void };
  /** 默认：有 action 6s，无 action 3s */
  ms?: number;
}

let host: HTMLElement | null = null;
let current: { el: HTMLElement; timer: number } | null = null;

function findHost(doc: Document): HTMLElement {
  if (host?.isConnected) return host;
  host = doc.createElement('div');
  host.className = 'toast-host';
  // role=status + aria-live：读屏会把它念出来，但不会抢焦点
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  doc.body.append(host);
  return host;
}

/** 关掉当前这条（幂等） */
export function dismissToast(): void {
  if (!current) return;
  window.clearTimeout(current.timer);
  current.el.remove();
  current = null;
}

export function toast(msg: string, opts: ToastOptions = {}): void {
  const doc = document;
  dismissToast();

  const el = doc.createElement('div');
  el.className = 'toast';

  const text = doc.createElement('span');
  text.className = 'toast-msg';
  text.textContent = msg;
  el.append(text);

  if (opts.action) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', () => {
      dismissToast();
      opts.action?.run();
    });
    el.append(btn);
  }

  findHost(doc).append(el);

  const ms = opts.ms ?? (opts.action ? 6000 : 3000);
  current = { el, timer: window.setTimeout(dismissToast, ms) };
}
