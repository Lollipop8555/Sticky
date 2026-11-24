/**
 * `?reset=1`：把本地库整个删掉再重载（决策 66）。
 *
 * 为什么需要它：DevTools 里删库这条路人人都踩坑 —— 应用把连接关了让删除完成（`blocking()`），
 * 但**内存里的卡还在**，下一次写队列/偏好写入会重新建库并把数据写回去，
 * 看起来就是"删了又回来，怎么都删不掉"。要回到新用户状态，删除必须发生在 boot 之前，
 * 而此时 store 还是空的，没有东西能写回。
 *
 * 只在显式带参数时触发：正常访问一律不动数据。
 */

import { t } from '@/i18n';
import { DB_NAME, closeDB } from '@/storage/db';

export type ResetOutcome = 'none' | 'reloading' | 'blocked';

export async function resetLocalDataIfRequested(): Promise<ResetOutcome> {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('reset')) return 'none';

  await closeDB();
  const removed = await deleteDatabase(DB_NAME);

  if (!removed) {
    // 别的标签页 / 已安装的 PWA 窗口还握着连接：这时删不掉，硬重载只会把数据写回来
    // 这一刻 prefs 还没读，所以只能按默认语言说 —— 这条提示是开发/维护路径，不值得为它先把库打开
    document.body.textContent = t('reset.blocked');
    return 'blocked';
  }

  // 抹掉参数再跳：否则刷新一次清一次，历史里也会留下这一步
  url.searchParams.delete('reset');
  window.location.replace(url.toString());
  return 'reloading';
}

function deleteDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // 被其它连接挡住时不会自动失败，超时兜底，避免页面一直白着
    request.onblocked = () => resolve(false);
    window.setTimeout(() => resolve(false), 3000);
  });
}
