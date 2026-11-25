import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * S8 的验收线：**材质只改"看见的"，不改"记下的"**。
 * 所以每条断言都成对出现 —— DOM 上的 `--note-bg`（用户看到的）与库里的 `bgColor`（真相）。
 *
 * 对比度那一半在 `tests/unit/palette.test.ts`（96 组合），e2e 只验它能跑到屏幕上。
 */

const BASE = '#F9D5E5'; // 马卡龙池里的粉色，已入库的"基色"

async function boot(page: Page, url = './'): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
}

/** 读第一张卡真正渲染出来的底色（inline style 上的 --note-bg，由 displayColor 派生） */
async function shownColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.note');
    return el ? getComputedStyle(el).getPropertyValue('--note-bg').trim() : '';
  });
}

/** 库里所有便签的基色，按 z 升序（z 越大越新） */
async function storedNotes(page: Page): Promise<{ bgColor: string; z: number }[]> {
  const rows = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sticky-wall');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise<{ bgColor: string; z: number }[]>((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const req = tx.objectStore('notes').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all;
  });
  return rows.sort((a, b) => a.z - b.z);
}

/** 只用来比较"谁更暗"，不追求与 WCAG 一致（那一份在 palette.ts 里有单测） */
function luma(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2) || '0', 16));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

test('四种材质：卡色跟着背景走，库里的基色一个字都不改', async ({ page }) => {
  await boot(page);
  await seedDB(page, { notes: [noteRecord('n1', { x: 200, y: 160, bgColor: BASE })] });

  const shown: Record<string, string> = {};

  for (const bg of ['paper', 'kraft', 'grid', 'blackboard'] as const) {
    // 预览口只改视觉、不写 prefs —— 所以四次访问读到的都是同一份记录
    await page.goto(`./?bg=${bg}`);
    await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-background', bg);
    await expect(page.locator('.note')).toHaveCount(1);
    shown[bg] = await shownColor(page);
  }

  // 不带预览口回来：背景必须还是库里那个（说明 ?bg= 没写进 prefs）
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('data-background', 'paper');

  // 浅色两档：paper / grid 不压明度，显示色就是基色
  expect(shown['paper']).toBe(BASE);
  expect(shown['grid']).toBe(BASE);
  // 牛皮纸略压，黑板大幅压暗 —— 但都是"同一张粉卡"
  expect(luma(shown['kraft'] ?? '')).toBeLessThan(luma(BASE));
  expect(luma(shown['blackboard'] ?? '')).toBeLessThan(luma(BASE) / 3);

  // 记录侧：从头到尾只有一条，且仍是基色
  expect(await storedNotes(page)).toMatchObject([{ bgColor: BASE, z: 1 }]);
});

test('新建便签自动取色：12 张互不撞色，换色池后新卡换池取色', async ({ page }) => {
  await boot(page);
  // 走 FAB 建卡：12 张都会落在视口中心附近，全部处在彼此的 400 统计半径内
  await seedDB(page, { prefs: { settings: { createMode: 'fab' } } });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  const fab = page.locator('.fab');
  await expect(fab).toBeVisible();

  for (let i = 0; i < 12; i++) {
    await fab.click();
    await expect(page.locator('.note.is-editing')).toHaveCount(1);
    await page.keyboard.press('Escape'); // 退出编辑，避免下一张卡被"点空白保存"顺手合并
    await expect(page.locator('.note.is-editing')).toHaveCount(0);
  }

  await page.waitForTimeout(600); // 等写队列的节流窗口，再读真相
  const macaron = await storedNotes(page);
  expect(macaron).toHaveLength(12);
  expect(new Set(macaron.map((n) => n.bgColor)).size).toBe(12);

  // 换池：已存在的卡不动（基色是记录的一部分），只有新卡按新池取色
  await page.locator('.controls [data-act="settings"]').click();
  await page.locator('.sheet-settings label.opt', { hasText: '莫奈' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'monet');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-settings')).toBeHidden();

  await fab.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  const all = await storedNotes(page);
  expect(all).toHaveLength(13);

  const before = all.slice(0, 12).map((n) => n.bgColor);
  const newest = all[12]?.bgColor ?? '';
  // 莫奈池与马卡龙池没有交集：新卡不可能拿到旧的 12 色之一
  expect(before).not.toContain(newest);
  expect(new Set(before).size).toBe(12); // 老卡一张都没被换色
});

test('方格纸：缩到 0.5 以下收起网格线，放大回来再出现', async ({ page }) => {
  await boot(page, '/?bg=grid');
  await expect(page.locator('html')).toHaveAttribute('data-grid', 'on');

  const gridDisplay = (): Promise<string> =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector<HTMLElement>('.viewport')!, '::after').display,
    );

  expect(await gridDisplay()).toBe('block');

  await page.mouse.move(640, 360);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 400); // 缩小
  await page.keyboard.up('Control');

  await page.waitForTimeout(100); // 等一帧 paint 写完 dataset
  await expect(page.locator('html')).toHaveAttribute('data-grid', 'off');
  expect(await gridDisplay()).toBe('none');

  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -400); // 放大回去
  await page.keyboard.up('Control');

  await page.waitForTimeout(100);
  await expect(page.locator('html')).toHaveAttribute('data-grid', 'on');
  expect(await gridDisplay()).toBe('block');
});
