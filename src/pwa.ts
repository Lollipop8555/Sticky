/**
 * PWA 壳（决策 17 / tech-design §5）。
 *
 * 两个"不打扰"原则：
 * 1. **注册不注入内联脚本**：CSP 是 `script-src 'self'`，`virtual:pwa-register` 走打包产物才放行。
 * 2. **静默**：首次装好不说"可以离线使用"（用户并不关心），只在真有新版本时弹一条可点的提示。
 *    更新提示的完整交互（进度、稍后再说）留给 M3。
 */

import { registerSW } from 'virtual:pwa-register';

import { t } from '@/i18n';
import { getEditingId, stopEditing } from '@/note/editing';
import { flush } from '@/storage/writeQueue';
import { toast } from '@/ui/toast';

export function registerServiceWorker(): void {
  // 不支持 SW 的浏览器（老 Safari、部分内置 WebView）照常在线用，这里不该抛错
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // 绝不静默强刷：用户可能正在写一张卡，刷新等于把他的输入吞掉
      toast(t('toast.updateReady'), {
        action: {
          label: t('toast.refresh'),
          run: () => {
            // 提示随时可能弹在用户正编辑时：先收笔（会把内容与高度写回 store）、
            // 再冲一次写队列，最后才 reload。少任何一步，最后几百毫秒的输入就没了。
            if (getEditingId() !== null) stopEditing();
            void flush()
              .catch((error: unknown) => console.error('[pwa] 刷新前落库失败', error))
              .finally(() => void updateSW(true));
          },
        },
        ms: 8000,
      });
    },
    onOfflineReady() {
      // 故意不提示：见文件头
    },
  });
}

let asked = false;

/**
 * 申请持久化存储（tech-design §5）：只有显式申请过的源，浏览器在磁盘紧张时才不会
 * 悄悄清掉 IndexedDB。失败无所谓（Safari 直接拒绝、Firefox 弹授权），所以静默忽略。
 *
 * 由写队列在**首次成功写入之后**调用 —— 一次都没写过就申请，等于向用户要一个还没用上的权限。
 */
export function requestPersistentStorage(): void {
  if (asked) return;
  asked = true;
  void navigator.storage?.persist?.().catch(() => {
    // 拒绝不是错误：下次打开还能用，只是被清理的概率高一点
  });
}
