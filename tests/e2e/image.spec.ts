import { expect, test, type Page } from '@playwright/test';

/**
 * S11 的验收：粘贴图片 → 压缩入库 → 卡片里真的显示 → 刷新后还在。
 *
 * 压缩这条只能端到端验：`createImageBitmap` / `canvas.toBlob` 在 jsdom 里都没有，
 * 用 mock 验等于验 mock 自己。
 */

async function createNote(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await page.mouse.dblclick(640, 400);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);
  await expect(page.locator('.note-editor')).toBeFocused();
}

/** 造一张随机噪声 PNG（几乎不可压缩，保证 > 800KB），派发 paste 事件 */
async function pasteNoiseImage(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const size = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');

    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.random() * 255;
      image.data[i + 1] = Math.random() * 255;
      image.data[i + 2] = Math.random() * 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });

    const file = new File([blob], 'noise.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);

    const editor = document.querySelector('.note-editor');
    if (!editor) throw new Error('编辑器不在');
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );

    return blob.size;
  });
}

test('粘贴大图：压缩入库、卡内显示、刷新后仍在', async ({ page }) => {
  await createNote(page);

  const originalSize = await pasteNoiseImage(page);
  expect(originalSize).toBeGreaterThan(800 * 1024); // 前置条件：确实是"大图"

  // NodeView 的 img 在 blob 解析完成后才有 src
  const img = page.locator('.note-editor img.note-img');
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });

  // 库里存的是压缩后的 WebP，不是原始 PNG
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sticky-wall');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ mime: string; size: number; w: number; h: number }[]>(
      (resolve, reject) => {
        const all = db.transaction('assets', 'readonly').objectStore('assets').getAll();
        all.onsuccess = () =>
          resolve(
            (all.result as { mime: string; blob: Blob; w: number; h: number }[]).map((a) => ({
              mime: a.mime,
              size: a.blob.size,
              w: a.w,
              h: a.h,
            })),
          );
        all.onerror = () => reject(all.error);
      },
    );
    db.close();
    return rows;
  });

  expect(stored).toHaveLength(1);
  expect(stored[0]?.mime).toBe('image/webp');
  expect(stored[0]?.size).toBeLessThan(800 * 1024);
  expect(stored[0]?.w).toBe(1200);

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });
});

test('md 里手写的外链图片不加载，只显示占位（CSP 不放行 https，也不该悄悄发请求）', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sticky-wall');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put({
        id: 'n-ext',
        contentMd: '![猫](https://example.com/cat.png)',
        x: 100,
        y: 100,
        width: 260,
        height: 160,
        minHeight: 80,
        bgColor: '#f9d5e5',
        z: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await expect(page.locator('.note-img-ext')).toHaveText('外链图片（未加载）');
  await expect(page.locator('.note-body img.note-img')).toHaveCount(0);
});
