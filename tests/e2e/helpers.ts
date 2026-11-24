import { expect, type Page } from '@playwright/test';

export interface Transform {
  scale: number;
  panX: number;
  panY: number;
}

/**
 * 黑盒断言：只读 `#world` 的计算样式，不依赖任何 window 上的调试钩子。
 * 算出来的矩阵就是用户真正看到的东西 —— 调试接口可以撒谎，渲染结果不会。
 */
export async function readTransform(page: Page): Promise<Transform> {
  const raw = await page.evaluate(
    () => getComputedStyle(document.querySelector('#world') as HTMLElement).transform,
  );

  const m3 = /matrix3d\(([^)]+)\)/.exec(raw);
  if (m3) {
    const v = (m3[1] ?? '').split(',').map(Number);
    return { scale: v[0] ?? 1, panX: v[12] ?? 0, panY: v[13] ?? 0 };
  }
  const m2 = /matrix\(([^)]+)\)/.exec(raw);
  if (m2) {
    const v = (m2[1] ?? '').split(',').map(Number);
    return { scale: v[0] ?? 1, panX: v[4] ?? 0, panY: v[5] ?? 0 };
  }
  return { scale: 1, panX: 0, panY: 0 }; // 'none'
}

/** 屏幕点换算到世界坐标，与 viewport.ts 的公式必须一致 */
export function worldAt(t: Transform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - t.panX) / t.scale, y: (sy - t.panY) / t.scale };
}

export interface SeedData {
  /** prefs 表：key = settings | viewport | counters */
  prefs?: Record<string, unknown>;
  notes?: Record<string, unknown>[];
}

/**
 * 直接往库里塞数据，然后由页面自己去读 —— 这是唯一能验证「boot 真的读了库」的办法。
 * 不导出任何测试专用 API：seed 走的是 DevTools 里能敲的同一套 IndexedDB 接口。
 */
export async function seedDB(page: Page, data: SeedData): Promise<void> {
  await page.evaluate(async ({ prefs, notes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sticky-wall');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['prefs', 'notes'], 'readwrite');
      const prefsStore = tx.objectStore('prefs');
      for (const [key, value] of Object.entries(prefs ?? {})) prefsStore.put({ key, value });
      const notesStore = tx.objectStore('notes');
      for (const record of notes ?? []) notesStore.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  }, data);
}

/**
 * 等写队列真的把 N 条便签冲进库。
 * 写队列有节流，"drop 之后等 300ms 再 reload"是在赌时序；这里等的是可观测的事实。
 */
export async function waitForPersistedNotes(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sticky-wall');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const total = await new Promise<number>((resolve, reject) => {
            const req = db.transaction('notes', 'readonly').objectStore('notes').count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          db.close();
          return total;
        }),
      { timeout: 15_000 },
    )
    .toBe(count);
}

/** 一条字段齐全的便签记录（库里真正需要的形状） */
export function noteRecord(
  id: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    x: 0,
    y: 0,
    width: 260,
    height: 184,
    minHeight: 160,
    z: 1,
    bgColor: '#FCE7F3',
    contentMd: '',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...patch,
  };
}
