import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * S12/S13 的验收：删除 → 撤销 / 废纸篓面板 / 3 秒长按清空 / 视口外恢复。
 *
 * 废纸篓这条链路横跨"内存 → 写队列 → IndexedDB → 面板 → 恢复回墙上"，
 * 单测只能验到前两段；"刷新之后还在不在"只有真浏览器说得清。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
}

/** 双击空白建一张卡并写一个字，然后退出编辑 */
async function createNote(page: Page, text: string, at = { x: 640, y: 400 }): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('.note.is-editing')).toHaveCount(0);
}

/** 删除按钮 hover 才显形（触摸端常显），所以先 hover 卡再点右上角的 × */
async function trashHoveredNote(page: Page): Promise<void> {
  await page.locator('.note').hover();
  await page.locator('.note-delete').click();
}

async function dbNotes(page: Page, table: 'notes' | 'assets'): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sticky-wall');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const all = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
      all.onerror = () => reject(all.error);
    });
    db.close();
    return rows;
  }, table);
}

test('删除后 3 秒内撤销：卡原地回来，库里也不再是删除态', async ({ page }) => {
  await boot(page);
  await createNote(page, '删错了');
  await trashHoveredNote(page);

  await expect(page.locator('.note')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('废纸篓');

  await page.locator('.toast-action').click();
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note-body')).toHaveText('删错了');

  await page.waitForTimeout(600);
  const rows = await dbNotes(page, 'notes');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['deletedAt']).toBeNull();
});

test('删掉的卡在废纸篓里：三行概要 + 相对时间，恢复后回到墙上', async ({ page }) => {
  await boot(page);
  await createNote(page, '废纸篓里的第一张');
  await trashHoveredNote(page);
  await expect(page.locator('.note')).toHaveCount(0);

  // 等写队列落库，否则刷新后记录可能还没写进去
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note')).toHaveCount(0);

  await page.locator('.trash-anchor').click();
  const dialog = page.locator('dialog.sheet-trash');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.trash-row')).toHaveCount(1);
  await expect(page.locator('.trash-line').first()).toHaveText('废纸篓里的第一张');
  await expect(page.locator('.trash-time')).toHaveText(/刚刚|分钟前/);
  await expect(page.locator('.trash-count')).toHaveText('1 张');

  // 面板必须贴着左下角那个入口长出来（`.sheet` 的默认锚点是右下角那排控件的位置）：
  // 左沿对齐、整体在按钮上方。只剩"点左边弹右边"的时候，用户得满屏找面板。
  // 容差 2px：面板入场动画带着 translateY(8px) scale(0.99)，刚可见时包围盒还没落定。
  const box = await page.locator('.trash-anchor').boundingBox();
  const panel = await dialog.boundingBox();
  expect(Math.abs(panel!.x - box!.x)).toBeLessThan(2);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(box!.y);

  await page.locator('.trash-restore').click();
  await expect(page.locator('.trash-row')).toHaveCount(0);
  await expect(page.locator('.trash-blank')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note-body')).toHaveText('废纸篓里的第一张');
});

test('恢复时原坐标不在视野里：摆到当前视野并提示（否则点了像没反应）', async ({ page }) => {
  await boot(page);
  await seedDB(page, {
    notes: [
      noteRecord('n-far', {
        x: 50_000,
        y: 50_000,
        contentMd: '很远的地方',
        deletedAt: Date.now(),
      }),
    ],
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note')).toHaveCount(0);

  await page.locator('.trash-anchor').click();
  await page.locator('.trash-restore').click();

  await expect(page.locator('.toast')).toContainText('已放到当前视野');
  await expect(page.locator('.note')).toHaveCount(1);
  // 真的在视野里：卡的盒子与视口有交集
  const box = await page.locator('.note').boundingBox();
  const size = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThan(size?.width ?? 0);
  expect(box!.y).toBeLessThan(size?.height ?? 0);
});

test('清空要按住 3 秒：2.9 秒松手不清空，按住够 3 秒才清空', async ({ page }) => {
  await boot(page);
  await createNote(page, '留着的', { x: 420, y: 380 });
  await createNote(page, '要清掉的', { x: 900, y: 380 });
  // 删掉第二张（hover 到它上面再点 ×）
  await page.locator('.note', { hasText: '要清掉的' }).hover();
  await page.locator('.note', { hasText: '要清掉的' }).locator('.note-delete').click();
  await expect(page.locator('.note')).toHaveCount(1);

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await page.locator('.trash-anchor').click();
  await expect(page.locator('.trash-row')).toHaveCount(1);

  const purge = page.locator('.trash-purge');
  const box = await purge.boundingBox();
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  // 充能条真的在长：量伪元素算出来的宽度占按钮宽度的比例，而不是只看 inline 的 --p。
  // 以前那条环形进度是纯 CSS 画的、没有任何断言，mask 算错到只剩两条月牙也没人发现。
  const fill = await purge.evaluate((el) => {
    const painted = Number.parseFloat(getComputedStyle(el, '::before').width);
    return painted / el.getBoundingClientRect().width;
  });
  expect(fill).toBeGreaterThan(0.2);
  expect(fill).toBeLessThan(0.7);
  await page.waitForTimeout(1700); // 累计 2.9s
  await page.mouse.up();
  await expect(page.locator('.trash-row')).toHaveCount(1);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(3200);
  await page.mouse.up();

  await expect(page.locator('.trash-row')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('已清空 1 张便签');
  await expect(page.locator('.trash-blank')).toBeVisible();

  // 墙上的那张不受影响
  await page.keyboard.press('Escape');
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note-body')).toHaveText('留着的');
});
