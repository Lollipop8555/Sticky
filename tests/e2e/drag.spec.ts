import { expect, test, type Page } from '@playwright/test';

import { noteRecord, readTransform, seedDB } from './helpers';

/**
 * impl-02 §11 的拖拽用例（第 6 条「拖到气泡上」属于 M4 聚合层，此处不适用）。
 *
 * 时间都是真等：长按 400ms 是产品参数，不是可以 mock 的实现细节 ——
 * 用假时钟会把"计时器与 pointerup 抢跑"这类真 bug 一起 mock 掉。
 */

const LONG_PRESS = 400;
const CARD = { x: 300, y: 200 };

async function seedOne(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await seedDB(page, {
    notes: [noteRecord('n1', { ...CARD, contentMd: '拖动我', ...patch })],
    prefs: { viewport: { panX: 0, panY: 0, scale: 1 } },
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');
}

/** 卡片的世界坐标与浮起态（纯读 CSS 变量，不碰内部状态） */
async function card(page: Page): Promise<{ x: number; y: number; lifted: boolean; z: string }> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.note') as HTMLElement;
    return {
      x: Number(el.style.getPropertyValue('--x')),
      y: Number(el.style.getPropertyValue('--y')),
      lifted: el.classList.contains('is-lifted'),
      z: el.style.zIndex,
    };
  });
}

async function center(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.note').boundingBox();
  if (!box) throw new Error('卡片没有布局盒');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('普通拖动卡片 = 平移画布，卡不动也没浮起', async ({ page }) => {
  await seedOne(page);
  const { x: cx, y: cy } = await center(page);
  const before = await card(page);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(180); // 远小于 400ms 长按
  await page.mouse.move(cx + 140, cy + 90, { steps: 6 });

  // 中途就该确认"没浮起"：等松手后再看，浮起过的痕迹已经被落定动画擦掉了
  expect((await card(page)).lifted).toBe(false);

  await page.mouse.up();

  const after = await card(page);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);

  const t = await readTransform(page);
  expect(t.panX).toBeCloseTo(140, 0);
  expect(t.panY).toBeCloseTo(90, 0);
  expect(t.scale).toBe(1);
});

test('长按 400ms 后浮起并跟手，视野不再跟着走', async ({ page }) => {
  await seedOne(page);
  const { x: cx, y: cy } = await center(page);
  const before = await card(page);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS + 120);

  const lifted = await card(page);
  expect(lifted.lifted).toBe(true);
  // 浮起要顺手置顶，否则拖过别的卡时会被压在下面
  expect(Number(lifted.z)).toBeGreaterThan(Number(before.z));

  const panBefore = await readTransform(page);
  await page.mouse.move(cx + 140, cy + 90, { steps: 6 });

  await expect
    .poll(async () => (await card(page)).x)
    .toBeGreaterThanOrEqual(before.x + 130);

  const after = await card(page);
  expect(after.x - before.x).toBeCloseTo(140, 0);
  expect(after.y - before.y).toBeCloseTo(90, 0);

  // 拖卡时画布必须钉住：跟手的是卡，不是视野
  const panAfter = await readTransform(page);
  expect(panAfter.panX).toBeCloseTo(panBefore.panX, 6);
  expect(panAfter.panY).toBeCloseTo(panBefore.panY, 6);

  await page.mouse.up();
  expect((await card(page)).lifted).toBe(false);
});

test('拖到右边缘停住不动，视野自动继续平移且卡片留在指针下', async ({ page }) => {
  await seedOne(page);
  const { x: cx, y: cy } = await center(page);
  const before = await card(page);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS + 120);

  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const edgeX = size.w - 20; // 落进 80px 的贴边带，且接近满速
  await page.mouse.move(edgeX, cy, { steps: 8 });

  const panAtEdge = (await readTransform(page)).panX;
  await page.waitForTimeout(900); // 指针不动，只能靠帧循环推进

  const panAfter = (await readTransform(page)).panX;
  // 贴右边缘 = 想看更右边的内容 = 画面左移 = panX **变小**。
  // 这条方向曾经整体写反（贴边时新内容从反方向钻出来），所以断言的是符号而不是绝对值。
  expect(panAtEdge - panAfter).toBeGreaterThan(80);
  expect((await card(page)).x).toBeGreaterThan(before.x);

  // 视野一直在动，所以 pan 与卡片矩形**必须在同一个 evaluate 里取**：
  // 分成几次 roundtrip 读，中间已经又平移了几帧，断言会凭空多出十几像素的误差。
  const snapshot = await page.evaluate(() => {
    const world = document.querySelector<HTMLElement>('#world') as HTMLElement;
    const el = document.querySelector<HTMLElement>('.note') as HTMLElement;
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(world).transform);
    const box = el.getBoundingClientRect();
    return { panX: m ? Number((m[1] ?? '').split(',')[4]) : 0, cx: box.x + box.width / 2 };
  });
  // 容差 12px ≈ 满速下一帧的位移。两处写入不在同一条路径上：
  // 视野的 transform 由 render 的帧回调写，卡片坐标由 store 通知同步写，
  // 读取的瞬间可能正好差一帧 —— 但两者在同一帧绘制，用户看到的是对齐的。
  expect(Math.abs(snapshot.cx - edgeX)).toBeLessThan(12);

  await page.mouse.up();

  // 松手后必须真的停下来（自动平移的循环要跟着停，不能自己一直转）。
  // 先让 pointerup 走完一帧再取样：贴着边缘时一帧就是 6px 左右，
  // 紧跟着 up 读会读到"事件还没被处理"的那一帧。
  await page.waitForTimeout(100);
  const stopped = (await readTransform(page)).panX;
  await page.waitForTimeout(250);
  expect((await readTransform(page)).panX).toBeCloseTo(stopped, 6);
});

test('拖到一半按 Esc：坐标原路退回，刷新后仍是原位置', async ({ page }) => {
  await seedOne(page);
  const { x: cx, y: cy } = await center(page);
  const before = await card(page);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS + 120);
  await page.mouse.move(cx + 200, cy + 120, { steps: 8 });

  const moved = await card(page);
  expect(moved.x - before.x).toBeGreaterThan(150);

  await page.keyboard.press('Escape');
  await page.mouse.up();

  const restored = await card(page);
  expect(restored.x).toBe(before.x);
  expect(restored.y).toBe(before.y);
  expect(restored.lifted).toBe(false);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '1');
  const persisted = await card(page);
  expect(persisted.x).toBe(before.x);
  expect(persisted.y).toBe(before.y);
});

test('拖动手柄是快路：按下就浮起，不用等长按', async ({ page }) => {
  await seedOne(page);
  const grip = page.locator('.note-grip');
  const box = await grip.boundingBox();
  if (!box) throw new Error('手柄没有布局盒');
  const gx = box.x + box.width / 2;
  const gy = box.y + box.height / 2;
  const before = await card(page);

  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.waitForTimeout(50); // 远不到长按阈值

  expect((await card(page)).lifted).toBe(true);

  const { x: cx, y: cy } = { x: gx, y: gy };
  const panBefore = await readTransform(page);
  await page.mouse.move(cx + 120, cy + 70, { steps: 5 });

  const after = await card(page);
  expect(after.x - before.x).toBeCloseTo(120, 0);
  expect(after.y - before.y).toBeCloseTo(70, 0);
  expect((await readTransform(page)).panX).toBeCloseTo(panBefore.panX, 6);

  await page.mouse.up();
});
