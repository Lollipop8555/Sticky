import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * impl-04 §7 的验收：控件、设置面板的三个"即时生效"，以及 Esc 的三层优先级。
 *
 * 全部走真实交互（点按钮、点分段控件），不直接改 prefs —— 
 * "改 prefs 后 UI 会不会跟着变"才是要测的东西，绕过 prefs 就什么都没测到。
 */

async function boot(page: Page, data: Parameters<typeof seedDB>[1] = {}): Promise<void> {
  await page.goto('/');
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

/** 分段控件按可见文字点，而不是点那个透明的 radio（更贴近用户） */
async function pick(page: Page, label: string): Promise<void> {
  await page.locator('.sheet-settings label.opt', { hasText: label }).click();
}

/**
 * 偏好走 writeQueue 的 400ms 节流（不是防抖，也不保证 pagehide 一定写完），
 * 改完立刻 reload 会落在窗口内 —— 与 storage.spec.ts 沿用同一条"等过窗口再刷新"的规矩。
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test('设置里切新建方式：FAB 立刻出现；FAB 在视口中心建卡并直接进编辑', async ({ page }) => {
  await boot(page);

  // 默认双击建卡：FAB 不该占着位置
  await expect(page.locator('.fab')).toBeHidden();

  await openSettings(page);
  await pick(page, '右下角 ＋');
  await expect(page.locator('.fab')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-settings')).toBeHidden();

  await page.locator('.fab').click();
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  // 落点是**视口中心**：用户点右下角的 +，新卡却出现在角落里会很意外
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const box = await page.locator('.note').boundingBox();
  if (!box) throw new Error('新卡没有布局盒');
  expect(Math.abs(box.x + box.width / 2 - size.w / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - size.h / 2)).toBeLessThan(2);

  await page.keyboard.press('Escape');
  await expect(page.locator('.note.is-editing')).toHaveCount(0);
  await expect(page.locator('.ctl-count')).toHaveText('1');
});

test('背景与调色板：即时写 dataset 与 theme-color，刷新后保持', async ({ page }) => {
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('data-background', 'paper');

  await openSettings(page);
  await pick(page, '黑板');
  await expect(page.locator('html')).toHaveAttribute('data-background', 'blackboard');
  // 移动端地址栏颜色跟着走，否则黑底白条很刺眼
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');

  await pick(page, '莫奈');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'monet');

  await settle(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-background', 'blackboard');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'monet');
});

test('移动模式：控件放大、手柄常驻，且落库', async ({ page }) => {
  await boot(page, { notes: [noteRecord('n1', { contentMd: '移动' })] });

  const ctl = page.locator('.ctl[data-act="settings"]');
  expect((await ctl.boundingBox())?.width).toBeCloseTo(32, 0);
  await expect.poll(async () => await page.locator('.note-grip').evaluate(
    (el) => Number(getComputedStyle(el).opacity),
  )).toBe(0);

  await openSettings(page);
  await page.locator('.opt-row').click();
  await expect(page.locator('html')).toHaveAttribute('data-mobile', '1');

  expect((await ctl.boundingBox())?.width).toBeCloseTo(40, 0);
  await expect.poll(async () => await page.locator('.note-grip').evaluate(
    (el) => Number(getComputedStyle(el).opacity),
  )).toBeGreaterThan(0.2);

  // 面板变整宽底部抽屉。废纸篓那条"贴左下角"的锚点（`.sheet-trash`）不能反超
  // `[data-mobile='1'] .sheet`，否则移动模式下会退成贴左边的小浮窗
  await page.keyboard.press('Escape'); // 设置面板是模态的，不关掉它点不到左下角
  await page.locator('.trash-anchor').click();
  const sheet = page.locator('dialog.sheet-trash');
  await expect(sheet).toBeVisible();
  expect(Math.round((await sheet.boundingBox())!.width)).toBe(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await settle(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-mobile', '1');
});

test('Esc 优先级：面板打开时只关面板，不动编辑态；再按一次才退出编辑', async ({ page }) => {
  await boot(page);

  // 双击空白建卡 → 进编辑
  await page.locator('.viewport').dblclick({ position: { x: 420, y: 320 } });
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-settings')).toBeHidden();
  // 第一层（dialog）吃掉 Esc，编辑态必须原封不动
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.note.is-editing')).toHaveCount(0);
});

test.describe('触屏设备', () => {
  test.use({ hasTouch: true });

  test('首次访问问一次移动模式；选"不用了"后刷新不再问', async ({ page }) => {
    await page.goto('/');

    const prompt = page.locator('.sheet-prompt');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: '不用了' }).click();
    await expect(prompt).toHaveCount(0);

    await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-mobile', '0');

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
    // mobilePromptSeen 已落库：第二次访问不该再弹
    await expect(page.locator('.sheet-prompt')).toHaveCount(0);
  });
});
