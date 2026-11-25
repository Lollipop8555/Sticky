import { expect, test } from '@playwright/test';

import { DEPLOY_BASE } from '../../deploy-base';

/**
 * S9 的验收线是"断网刷新还能打开"，这条只能对着**构建产物**验：
 * SW 是 vite build 生成的，dev server 下根本没有（也没必要有）。
 * 所以这里全部跑在 playwright.config 的 preview 服务器上。
 */

/** 等 SW 装好并**接管**页面。首次访问只 install，要靠一次 reload 才 claim 到 controller */
async function waitForControlled(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null, null, {
    timeout: 20_000,
  });
  if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) return;
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
}

test('构建产物带 manifest：字段与图标都能真的取到', async ({ page, request }) => {
  await page.goto('./');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const res = await request.get(href!);
  expect(res.ok()).toBe(true);

  const manifest = (await res.json()) as {
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  // 部署在子路径：start_url/scope 必须跟着 base 走（决策 72）。
  // 写成 '/' 时从主屏图标打开会跳到域名根，而根下没有 app —— 白页
  expect(manifest.start_url).toBe(DEPLOY_BASE);
  expect(manifest.scope).toBe(DEPLOY_BASE);
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#F5F2EC');

  expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);

  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok(), `图标缺失：${icon.src}`).toBe(true);
  }

  // iOS 加主屏用的是这个，跟 manifest 无关
  expect((await request.get(`${DEPLOY_BASE}icons/apple-touch-icon.png`)).ok()).toBe(true);

  // 首屏资源必须落在 base 下：`/assets/*.js` 会 404，症状是整页空白（本次线上事故）
  const script = await page.locator('script[type="module"]').first().getAttribute('src');
  expect(script?.startsWith(DEPLOY_BASE)).toBe(true);
  expect((await request.get(script!)).ok()).toBe(true);
});

test('Service Worker 接管后断网刷新仍能打开（应用壳生效）', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await waitForControlled(page);

  // 断网：所有请求都会失败，只有 SW 的 precache 能应答
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-background', 'paper');

  await context.setOffline(false);
});

test('断网时本地库照常读写（离线不是只读模式）', async ({ page, context }) => {
  await page.goto('./');
  await waitForControlled(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await page.mouse.dblclick(640, 400);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);
  await page.keyboard.type('断电也能写');
  await page.keyboard.press('Escape');
  await expect(page.locator('.note.is-editing')).toHaveCount(0);

  await page.waitForTimeout(600); // 等过 400ms 写库节流窗口，判的是"存住了"而不是"可能存住了"

  // 重新联网后再刷一次：内容必须还在（IDB 不受网络状态影响）
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note')).toContainText('断电也能写');
});
