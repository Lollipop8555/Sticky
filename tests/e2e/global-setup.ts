/**
 * e2e 的公共起点：**一个已经用过的库**（决策 65）。
 *
 * 为什么需要它：全新 profile 和"新用户"在浏览器眼里一模一样，boot 会给空墙塞一张
 * 写着操作说明的示例便签。存量用例断言的是"墙上有 N 张"，多出这一张就全错位。
 *
 * 做法是走一遍真实的 boot（库结构由应用自己建），然后把示例便签清掉、`onboarded` 置真，
 * 再把整个 IndexedDB 存成 storageState 交给所有 context。
 * 想测"首访"的用例自己 `browser.newContext()` 就能绕开它（见 `onboarding.spec.ts`）。
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { BASE_URL } from './server';

/** 相对路径按 cwd 解析（playwright 从仓库根启动） */
export const RETURNING_STATE = 'tests/e2e/.state/returning.json';

export default async function globalSetup(): Promise<void> {
  const statePath = path.resolve(RETURNING_STATE);
  await mkdir(path.dirname(statePath), { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForSelector('#app[data-booted="true"]');

    await page.evaluate(async () => {
      const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('sticky-wall');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

      const countNotes = async (): Promise<number> => {
        const db = await open();
        const total = await new Promise<number>((resolve, reject) => {
          const request = db.transaction('notes', 'readonly').objectStore('notes').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return total;
      };

      // 1) 等示例便签真的落库：写队列有 400ms 节流，立刻去清会扑空
      for (let i = 0; i < 50; i += 1) {
        if ((await countNotes()) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 2) 清空墙与资产，并把 onboarded 置真：墙是空的，但不是新用户
      const purge = async (): Promise<void> => {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['notes', 'assets', 'prefs'], 'readwrite');
          tx.objectStore('notes').clear();
          tx.objectStore('assets').clear();
          const prefs = tx.objectStore('prefs');
          const get = prefs.get('settings');
          // 在 get 的成功回调里再 put：同一个事务还开着，允许继续排队请求
          get.onsuccess = () => {
            const row = get.result as { key: string; value: Record<string, unknown> } | undefined;
            prefs.put({ key: 'settings', value: { ...(row?.value ?? {}), onboarded: true } });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      };

      await purge();
      // 3) 兜底再看一眼：万一最后一拍写队列把卡写了回来，再清一次
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if ((await countNotes()) === 0) break;
        await purge();
      }
    });

    await context.storageState({ path: statePath, indexedDB: true });
    await context.close();
  } finally {
    await browser.close();
  }
}
