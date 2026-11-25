import { expect, test, type Locator, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * impl-04 §7 的验收：控件、设置面板的三个"即时生效"，以及 Esc 的三层优先级。
 *
 * 全部走真实交互（点按钮、点分段控件），不直接改 prefs —— 
 * "改 prefs 后 UI 会不会跟着变"才是要测的东西，绕过 prefs 就什么都没测到。
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

test('移动兼容模式的说明排在标题下方，说明再长也不撑破面板', async ({ page }) => {
  await boot(page);
  await openSettings(page);

  const title = (await page.locator('.opt-row .opt-text > span').boundingBox())!;
  const hint = (await page.locator('.opt-row .opt-hint').boundingBox())!;

  // 两行：说明在标题**下方**，且左对齐同一列（不是 `margin-left:auto` 顶到行尾）
  expect(hint.y).toBeGreaterThanOrEqual(title.y + title.height - 0.5);
  expect(Math.abs(hint.x - title.x)).toBeLessThan(1);

  const overflow = async (): Promise<{ sheet: number; body: number }> =>
    page.evaluate(() => {
      const sheet = document.querySelector('.sheet-settings') as HTMLElement;
      const body = sheet.querySelector('.sheet-body') as HTMLElement;
      return { sheet: sheet.scrollWidth - sheet.clientWidth, body: body.scrollWidth - body.clientWidth };
    });

  // 320px 是面板的自身宽度，也是窄屏抽屉的下限：说明必须自己换行，不能把内容往外顶
  expect(await overflow()).toEqual({ sheet: 0, body: 0 });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await overflow()).toEqual({ sheet: 0, body: 0 });

  // 复选框不能被长文案压扁
  expect((await page.locator('.opt-row input').boundingBox())?.width).toBeCloseTo(16, 0);
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

test('面板的关闭叉是线描图标，在 hover 圆底里几何居中', async ({ page }) => {
  await boot(page);

  // 字形 `×` 的墨迹位置随字体漂（上一版 hover 时能看出图标偏上），所以必须是 svg 且没有文本
  async function checkCentered(close: Locator): Promise<void> {
    await expect(close.locator('svg')).toHaveCount(1);
    await expect(close).toHaveText('');
    const offset = await close.evaluate((el) => {
      const btn = el.getBoundingClientRect();
      const icon = el.querySelector('svg')!.getBoundingClientRect();
      return {
        dx: Math.abs(btn.x + btn.width / 2 - (icon.x + icon.width / 2)),
        dy: Math.abs(btn.y + btn.height / 2 - (icon.y + icon.height / 2)),
      };
    });
    expect(offset.dx).toBeLessThan(0.5);
    expect(offset.dy).toBeLessThan(0.5);
  }

  await page.locator('.ctl[data-act="settings"]').click();
  await expect(page.locator('.sheet-settings')).toBeVisible();
  await checkCentered(page.locator('.sheet-settings .sheet-close'));
  await page.locator('.sheet-settings .sheet-close').click();
  await expect(page.locator('.sheet-settings')).toBeHidden();

  await page.locator('.trash-anchor').click();
  await expect(page.locator('.sheet-trash')).toBeVisible();
  await checkCentered(page.locator('.sheet-trash .sheet-close'));
});

test.describe('触屏设备', () => {
  test.use({ hasTouch: true });

  test('首次访问问一次移动模式；选"不用了"后刷新不再问', async ({ page }) => {
    await page.goto('./');

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
