import { expect, test } from '@playwright/test';

import { BASE_URL } from './server';

/**
 * 新用户首访（决策 A6/65）：空画布上先给一张写着操作说明的便签。
 *
 * 全局 storageState 是"已经用过"的库，所以这里必须自己开一个**干净 context** ——
 * 否则测到的是"老用户看不到欢迎卡"，正好相反。
 */
test('新用户第一次打开：墙上一张示例便签，只放一次', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    // `browser.newContext()` 会继承 `use` 里的 options，全局 storageState 是"已经用过"的库；
    // 这里要的正好相反，所以显式给一份空的
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');

  // 内容是操作说明，而不是一句占位的"示例便签"
  const body = page.locator('.note-body');
  await expect(body).toContainText('双击空白处');
  await expect(body).toContainText('双击便签');
  await expect(body).toContainText('长按便签再拖');
  await expect(body).toContainText('缩放');

  // 必须在视野正中：丢在世界原点外面等于"新用户打开是空的"
  const box = await page.locator('.note').boundingBox();
  const size = page.viewportSize();
  expect(box).not.toBeNull();
  expect(size).not.toBeNull();
  if (box && size) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  }

  // 只放一次：刷新后还是同一张，不会变成两张
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');
  await expect(page.locator('.note')).toHaveCount(1);

  // 删掉（并落库）之后不再冒出来：用户把它清干净了就该是空的
  await page.locator('.note').hover();
  await page.locator('.note-delete').click();
  await expect(page.locator('.note')).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '0');
  await expect(page.locator('.note')).toHaveCount(0);

  await context.close();
});

/**
 * `?reset=1`（决策 66）：手动清数据的可靠替代。
 * DevTools 里删库会被应用"写回"，所以这里要保证：带参数打开 → 库没了 → 参数被抹掉 → 又是新用户。
 */
test('?reset=1 删掉本地库，回到首访状态', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');

  await page.goto('/?reset=1');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  // 参数被抹掉，否则刷新一次清一次
  expect(page.url()).toBe(BASE_URL + '/');
  // 库被真正删掉 → 又走了一遍首访，示例便签回来了
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note-body')).toContainText('双击空白处');

  await context.close();
});
