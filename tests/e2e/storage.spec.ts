import { expect, test, type Page } from '@playwright/test';

import { noteRecord, readTransform, seedDB } from './helpers';

/**
 * 存储链路：**seed 库 → 刷新 → 看页面有没有照着库变**。
 *
 * 这一层以前只能靠人肉开 DevTools 验证，但"手写一条记录 → 刷新 → 还在"只是第一半；
 * 真正会坏的是后半：读到了但没生效（字段名拼错、默认值盖掉真值、视野没恢复）。
 * 那半个 bug 在 DevTools 里看起来一切正常，只有页面知道。
 */

async function booted(page: Page, path = './'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
}

test('首次打开：库里建好三行偏好与两个表', async ({ page }) => {
  await booted(page);

  const shape = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sticky-wall');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const stores = [...db.objectStoreNames].sort();
    const rows = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction('prefs', 'readonly');
      const req = tx.objectStore('prefs').getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error);
    });
    db.close();
    return { stores, rows: rows.sort() };
  });

  expect(shape.stores).toEqual(['assets', 'notes', 'prefs']);
  // 空行也补齐：以后排查"设置没生效"时，能直接在 DevTools 看到真实存了什么
  expect(shape.rows).toEqual(['counters', 'settings', 'viewport']);
});

test('库里的背景与字号在刷新后生效（读 → 应用主题）', async ({ page }) => {
  await booted(page);

  await seedDB(page, {
    prefs: { settings: { background: 'blackboard', palette: 'monet', baseFontSize: 18 } },
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await expect(page.locator('html')).toHaveAttribute('data-background', 'blackboard');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');

  // --s-text-min = 7 / 18：LOD 阈值必须跟着字号走，否则调大字号会露出一段空白区
  const sTextMin = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--s-text-min'),
  );
  expect(Number(sTextMin)).toBeCloseTo(7 / 18, 4);
});

test('库里的 lastViewport 精确恢复（刷新后视野不跳）', async ({ page }) => {
  await booted(page);

  const viewport = { panX: 120, panY: -60, scale: 0.5 };
  await seedDB(page, {
    prefs: { viewport },
    notes: [noteRecord('n1', { x: 0, y: 0 })],
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  const t = await readTransform(page);
  expect(t.scale).toBeCloseTo(viewport.scale, 3);
  expect(t.panX).toBeCloseTo(viewport.panX, 0);
  expect(t.panY).toBeCloseTo(viewport.panY, 0);
});

test('上次视野与所有便签都不相交 → 退回概览而不是白屏', async ({ page }) => {
  await booted(page);

  await seedDB(page, {
    prefs: { viewport: { panX: 90000, panY: 90000, scale: 1 } },
    notes: [noteRecord('n1', { x: 0, y: 0 }), noteRecord('n2', { x: 1200, y: 900 })],
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '2');

  const t = await readTransform(page);
  expect(t.scale).toBeLessThan(1);

  // 两张卡都要落在视口内：fitAll 的意义就是"立刻看见全部"
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  for (const note of [
    { x: 0, y: 0 },
    { x: 1200, y: 900 },
  ]) {
    const screen = { x: note.x * t.scale + t.panX, y: note.y * t.scale + t.panY };
    expect(screen.x).toBeGreaterThanOrEqual(0);
    expect(screen.y).toBeGreaterThanOrEqual(0);
    expect(screen.x).toBeLessThan(size.width);
    expect(screen.y).toBeLessThan(size.height);
  }
});

test('废纸篓里的便签不参与首屏（deletedAt 过滤）', async ({ page }) => {
  await booted(page);

  await seedDB(page, {
    notes: [
      noteRecord('live-1'),
      noteRecord('live-2', { x: 400 }),
      noteRecord('trashed', { x: -400, deletedAt: Date.now() }),
    ],
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '2');
});

test('拖动后视野真的写进了库（刷新能还原，不是只存在内存里）', async ({ page }) => {
  await booted(page);

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 360, { steps: 5 });
  await page.mouse.up();

  const dragged = await readTransform(page);
  expect(dragged.panX).toBeCloseTo(120, 0);

  // 400ms 节流 + 一次 pagehide flush：等过这个窗口，验证的是"定时落库"这条路径
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  const restored = await readTransform(page);
  expect(restored.panX).toBeCloseTo(dragged.panX, 0);
  expect(restored.panY).toBeCloseTo(dragged.panY, 0);
  expect(restored.scale).toBeCloseTo(dragged.scale, 3);
});

test('存储不可用时降级为内存模式，不白屏', async ({ page }) => {
  await page.addInitScript(() => {
    // 模拟 Safari 无痕模式 / 库被用户禁用：open 直接抛
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('IndexedDB 被禁用');
      },
    });
  });

  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#viewport')).toBeVisible();
  // 视口与手势照常可用：存储挂了不该把画布一起带下水
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(460, 300, { steps: 3 });
  await page.mouse.up();
  expect((await readTransform(page)).panX).toBeCloseTo(60, 0);
});
