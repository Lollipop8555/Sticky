import { expect, test } from '@playwright/test';

import { readTransform, worldAt } from './helpers';

test('空白处拖动平移画布，位移与指针一致', async ({ page }) => {
  await page.goto('/');

  const before = await readTransform(page);
  expect(before).toEqual({ scale: 1, panX: 0, panY: 0 });

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 360, { steps: 6 });
  await page.mouse.up();

  const after = await readTransform(page);
  // 1 倍缩放下 1px 指针 = 1px 位移，没有加速度也没有惯性
  expect(after.panX).toBeCloseTo(120, 0);
  expect(after.panY).toBeCloseTo(60, 0);
  expect(after.scale).toBe(1);
});

test('拖动结束后画布不"粘"在指针上（capture 已释放）', async ({ page }) => {
  await page.goto('/');

  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(360, 300, { steps: 3 });
  await page.mouse.up();

  const afterUp = await readTransform(page);

  await page.mouse.move(800, 600, { steps: 3 }); // 抬手后继续移动
  const afterMove = await readTransform(page);

  expect(afterMove.panX).toBeCloseTo(afterUp.panX, 3);
  expect(afterMove.panY).toBeCloseTo(afterUp.panY, 3);
});

test('Ctrl+滚轮以光标为锚点缩放：光标下的世界坐标不动', async ({ page }) => {
  await page.goto('/');

  const anchor = { sx: 412, sy: 288 };
  await page.mouse.move(anchor.sx, anchor.sy);

  const before = await readTransform(page);
  const worldBefore = worldAt(before, anchor.sx, anchor.sy);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');

  const after = await readTransform(page);
  expect(after.scale).toBeGreaterThan(before.scale);

  const worldAfter = worldAt(after, anchor.sx, anchor.sy);
  expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(0.5);
  expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(0.5);
});

test('普通滚轮默认平移（wheelMode=pan），不缩放', async ({ page }) => {
  await page.goto('/');

  const before = await readTransform(page);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, 120);

  const after = await readTransform(page);
  expect(after.scale).toBe(before.scale);
  expect(after.panY).toBeLessThan(before.panY - 10); // 向下滚 → 内容上移
});

test('缩放比例被夹在 [0.002, 3] 之间', async ({ page }) => {
  await page.goto('/');
  await page.mouse.move(500, 400);

  await page.keyboard.down('Control');
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -400);
  const maxed = await readTransform(page);
  expect(maxed.scale).toBeLessThanOrEqual(3.0001);

  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 400);
  const minned = await readTransform(page);
  expect(minned.scale).toBeGreaterThanOrEqual(0.0019);
  await page.keyboard.up('Control');

  // 顶到上下限后不能出现 NaN/Infinity —— 那会让整个画布变空白
  expect(Number.isFinite(minned.panX)).toBe(true);
  expect(Number.isFinite(minned.panY)).toBe(true);
});

test('网格层跟随平移与缩放（世界坐标系里的方格纸）', async ({ page }) => {
  await page.goto('/?bg=grid');

  const gridBefore = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.viewport') as HTMLElement, '::after')
      .backgroundPosition,
  );

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 380, { steps: 4 });
  await page.mouse.up();

  const gridAfter = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.viewport') as HTMLElement, '::after')
      .backgroundPosition,
  );

  // 变量名拼错、或忘了在 grid 材质下写变量，这里会相等 → 卡片在动格子不动
  expect(gridAfter).not.toBe(gridBefore);
});

test('页面本身不滚动、不选中文字（滚轮与拖拽都被画布吃掉）', async ({ page }) => {
  await page.goto('/');

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 500, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, 300);

  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    selection: window.getSelection()?.toString() ?? '',
  }));

  expect(scroll.x).toBe(0);
  expect(scroll.y).toBe(0);
  expect(scroll.selection).toBe('');
});
