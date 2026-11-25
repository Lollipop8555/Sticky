import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * 双语（决策 69）：默认中文；设置面板切英文立刻生效并持久化。
 *
 * 断言的落点都是**用户看得见的东西**（可见文字、aria-label、`html lang`、`document.title`），
 * 不去读内存里的 locale 变量 —— 那正是"以为改了其实没生效"最容易骗过测试的地方。
 */

async function boot(page: Page, data: Parameters<typeof seedDB>[1] = {}): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  if (Object.keys(data).length > 0) {
    await seedDB(page, data);
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  }
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.ctl[data-act="settings"]').click();
  await expect(page.locator('.sheet-settings')).toBeVisible();
}

async function pick(page: Page, label: string): Promise<void> {
  await page.locator('.sheet-settings label.opt', { hasText: label }).click();
}

/** 偏好走 writeQueue 的 400ms 节流：刷新前先等过窗口（与 storage / ui 两个 spec 同一规矩） */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test('默认中文；设置里切到英文，面板 / 控件 / 卡片当场换语言', async ({ page }) => {
  await boot(page, { notes: [noteRecord('n1', { contentMd: '' })] });

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'zh');
  await expect(page).toHaveTitle('便签墙');
  await expect(page.locator('.note-placeholder')).toHaveText('双击输入…');
  await expect(page.locator('.ctl[data-act="settings"]')).toHaveAttribute('aria-label', '设置');

  await openSettings(page);
  await expect(page.locator('.sheet-settings .sheet-title')).toHaveText('设置');

  await pick(page, 'English');

  // 面板自身不重建，但每个标签都换了词（"静态文案走指纹，切语言就地改字"）
  await expect(page.locator('.sheet-settings .sheet-title')).toHaveText('Settings');
  await expect(page.locator('.field[data-field="lang"] legend')).toHaveText('Interface language');
  await expect(page.locator('.field[data-field="background"] legend')).toHaveText('Background');
  await expect(page.locator('.sheet-settings label.opt', { hasText: 'Pan canvas' })).toHaveCount(1);

  // 面板外的部分同样要跟着走：否则英文用户关掉面板还是一片中文
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'en');
  await expect(page).toHaveTitle('Sticky Wall');
  await expect(page.locator('.ctl[data-act="settings"]')).toHaveAttribute('aria-label', 'Settings');
  await expect(page.locator('.note-placeholder')).toHaveText('Double-click to type…');
});

test('英文选择刷新后保持；再切回中文也立刻生效', async ({ page }) => {
  await boot(page, { notes: [noteRecord('n1', { contentMd: '' })] });

  await openSettings(page);
  await pick(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'en');
  await settle(page);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.note-placeholder')).toHaveText('Double-click to type…');

  await openSettings(page);
  await expect(page.locator('.sheet-settings .sheet-title')).toHaveText('Settings');
  await pick(page, '中文');
  await expect(page.locator('.sheet-settings .sheet-title')).toHaveText('设置');
  await expect(page.locator('.note-placeholder')).toHaveText('双击输入…');

  await settle(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('切语言只翻界面：已有便签正文一个字都不动', async ({ page }) => {
  const contentMd = '这是一张别人写的中文便签';
  await boot(page, { notes: [noteRecord('n1', { contentMd })] });
  await expect(page.locator('.note-body')).toHaveText(contentMd);

  await openSettings(page);
  await pick(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'en');

  // 正文是用户数据，不是界面文案：翻译它就是改用户的字
  await expect(page.locator('.note-body')).toHaveText(contentMd);
});
