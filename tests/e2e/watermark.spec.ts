import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * 水印（决策 88）的验收。
 *
 * 只断言 DOM 里"有没有那层 div"是不够的 —— 那一层完全可能被快照库忽略，
 * 用户拿到的图还是干净的。这里导出两次（开 / 关），把两张 PNG 解码后逐像素比：
 * 差异必须存在（水印真进了图），又不能大到把整张图染色。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await seedDB(page, { notes: [noteRecord('n1', { x: 40, y: 40, contentMd: '一张便签' })] });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note')).toHaveCount(1);
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.ctl[data-act="settings"]').click();
  await expect(page.locator('.sheet-settings')).toBeVisible();
}

async function exportWall(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('.sheet-settings .data-wall').click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('整墙导出没有产生可读文件');
  return (await readFile(path)).toString('base64');
}

/** 等写队列把偏好冲进库：改完立刻 reload 是在赌 400ms 节流，会偶发读到旧值 */
async function waitForWatermarkSaved(page: Page, on: boolean): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (expected) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sticky-wall');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const row = await new Promise<{ key: string; value: unknown } | undefined>(
            (resolve, reject) => {
              const req = db.transaction('prefs', 'readonly').objectStore('prefs').get('settings');
              req.onsuccess = () => resolve(req.result as { key: string; value: unknown } | undefined);
              req.onerror = () => reject(req.error);
            },
          );
          db.close();
          const settings = row?.value as { watermarkOn?: boolean } | undefined;
          return settings?.watermarkOn === expected;
        }, on),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** 在页面里解码两张 PNG 并逐像素比（PNG 无损，非水印区域应当完全相同） */
async function diffPixels(page: Page, a: string, b: string) {
  return page.evaluate(
    async ({ withMark, without }) => {
      async function load(b64: string): Promise<ImageData> {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }

      const [x, y] = await Promise.all([load(withMark), load(without)]);
      if (x.width !== y.width || x.height !== y.height) {
        return { sameSize: false, diff: 0, total: 0, opaque: 0, opaqueClean: 0 };
      }
      let diff = 0;
      let opaque = 0;
      let opaqueClean = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const dr = Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0));
        const dg = Math.abs((x.data[i + 1] ?? 0) - (y.data[i + 1] ?? 0));
        const db = Math.abs((x.data[i + 2] ?? 0) - (y.data[i + 2] ?? 0));
        if (dr > 2 || dg > 2 || db > 2) diff += 1;
        if ((x.data[i + 3] ?? 0) > 8) opaque += 1;
        if ((y.data[i + 3] ?? 0) > 8) opaqueClean += 1;
      }
      return { sameSize: true, diff, total: x.width * x.height, opaque, opaqueClean };
    },
    { withMark: a, without: b },
  );
}

test('整墙图：开水印后像素真的变了，且只变了一部分', async ({ page }) => {
  await boot(page);
  await openSettings(page);

  await page.locator('.sheet-settings input[data-field="watermarkOn"]').check();
  await page.locator('.sheet-settings input[data-field="watermarkText"]').fill('测试水印');
  const withMark = await exportWall(page);

  // 导出整墙会先关面板（main.ts 里 close 之后才出图），改开关要重新打开
  await openSettings(page);
  await page.locator('.sheet-settings input[data-field="watermarkOn"]').uncheck();
  const without = await exportWall(page);

  const result = await diffPixels(page, withMark, without);
  expect(result.sameSize).toBe(true);
  // 一张 712×560 的图，水印铺满也该有几万个像素被改动
  expect(result.diff).toBeGreaterThan(2_000);
  // 但不能把整张图染色：水印是"一层淡字"，不是滤镜
  expect(result.diff).toBeLessThan(result.total * 0.5);
});

test('设置项：开关与文字落库，刷新后回填；屏幕上不画水印', async ({ page }) => {
  await boot(page);
  await openSettings(page);

  await page.locator('.sheet-settings input[data-field="watermarkOn"]').check();
  await page.locator('.sheet-settings input[data-field="watermarkText"]').fill('阿洛的便签');
  await page.locator('.sheet-settings .sheet-close').click();

  // 墙上永远看不到水印层：它只在导出时临时存在
  await expect(page.locator('.note-watermark')).toHaveCount(0);

  await waitForWatermarkSaved(page, true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await openSettings(page);

  await expect(page.locator('.sheet-settings input[data-field="watermarkOn"]')).toBeChecked();
  await expect(page.locator('.sheet-settings input[data-field="watermarkText"]')).toHaveValue(
    '阿洛的便签',
  );
});

/** 读剪贴板里的 PNG；没有就返回 null */
async function readClipboardPng(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((one) => one.types.includes('image/png'));
    if (!item) return null;
    const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
    return btoa(binary);
  });
}

/**
 * 复制单卡图并读回来。
 * 先把剪贴板清成文本：只有这次写入完成，read 才会又看到 image/png ——
 * 否则第二次读取很可能拿到上一张图，两次"相同"就永远测不出差异。
 */
async function copyCardImage(page: Page): Promise<string | null> {
  await page.evaluate(() => navigator.clipboard.writeText('stale'));
  await page.locator('.note').hover();
  await page.locator('.note-copy').click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText(/已复制|已下载/, { timeout: 20_000 });
  // 走了下载分支（浏览器不给写剪贴板），这张卡的图读不回来
  if ((await toast.innerText()).includes('已下载')) return null;

  await expect
    .poll(async () => (await readClipboardPng(page)) !== null, { timeout: 20_000 })
    .toBe(true);
  return readClipboardPng(page);
}

test('单卡图：水印画在卡内，不会把圆角外的透明区涂上色', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await openSettings(page);
  await page.locator('.sheet-settings input[data-field="watermarkOn"]').check();
  await page.locator('.sheet-settings input[data-field="watermarkText"]').fill('圆角测试水印');
  await page.locator('.sheet-settings .sheet-close').click();
  const withMark = await copyCardImage(page);
  test.skip(withMark === null, '剪贴板不可用，单卡走了下载分支');

  await openSettings(page);
  await page.locator('.sheet-settings input[data-field="watermarkOn"]').uncheck();
  await page.locator('.sheet-settings .sheet-close').click();
  const clean = await copyCardImage(page);
  expect(clean).not.toBeNull();

  const result = await diffPixels(page, withMark!, clean!);
  expect(result.sameSize).toBe(true);
  // 字确实画上去了
  expect(result.diff).toBeGreaterThan(500);

  /*
   * 关键的一条：不透明像素的数量必须一模一样。
   * 水印层是矩形、卡片是圆角，`.note` 又没有 overflow:hidden ——
   * 少了 `border-radius: inherit`，四角会多出一圈半透明墨迹，这个计数就会变大。
   */
  expect(result.opaque).toBe(result.opaqueClean);
});

test('文本框留空时回落到默认文案，占位符跟着语言走', async ({ page }) => {
  await boot(page);
  await openSettings(page);

  const input = page.locator('.sheet-settings input[data-field="watermarkText"]');
  await expect(input).toHaveAttribute('placeholder', '留空则显示「Sticky Wall」');

  await page.locator('.sheet-settings .field[data-field="lang"] .opt', { hasText: 'English' }).click();
  await expect(input).toHaveAttribute('placeholder', 'Defaults to “Sticky Wall”');
  // 用户输入是数据，不进 i18n 指纹：切语言不该清空它
  await input.fill('my notes');
  await expect(input).toHaveValue('my notes');
});
