import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * S5 的压测面：500 张卡（25×20 网格，间距 320）一次性灌库。
 *
 * 断言方式刻意保持"看得见的结果"：`document.querySelectorAll('.note')` 的**数量**就是
 * 用户浏览器真正承担的节点数；不断言内部 Map 或调试计数。
 */

const COLS = 25;
const ROWS = 20;
const STEP = 320;
const STORAGE_SIZE = COLS * ROWS; // 500

function gridNotes(): Record<string, unknown>[] {
  return Array.from({ length: STORAGE_SIZE }, (_, i) =>
    noteRecord(`n-${String(i).padStart(3, '0')}`, {
      x: (i % COLS) * STEP,
      y: Math.floor(i / COLS) * STEP,
      z: i + 1,
      contentMd: '占位内容',
    }),
  );
}

async function bootWithGrid(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await seedDB(page, {
    notes: gridNotes(),
    prefs: { viewport: { panX: 0, panY: 0, scale: 1 } },
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', String(STORAGE_SIZE));
}

/** 已挂载卡片的世界坐标，顺带给出 noteId，便于断言"换血"而非"数量对得上" */
async function mounted(page: Page): Promise<{ ids: string[]; xs: number[]; ys: number[] }> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.note')];
    return {
      ids: els.map((el) => el.dataset['noteId'] ?? ''),
      xs: els.map((el) => Number(el.style.getPropertyValue('--x')) || 0),
      ys: els.map((el) => Number(el.style.getPropertyValue('--y')) || 0),
    };
  });
}

test('500 张卡只挂载视口附近的一小撮', async ({ page }) => {
  await bootWithGrid(page);

  const view = await mounted(page);
  // 可见带右/下边界 = 1.25 × 视口尺寸（外扩 1.5 倍后以视口为中心）。
  // 视口尺寸必须现取：Playwright 的默认视口是 1280×720，不是 jsdom 的 1024×768。
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(view.ids.length).toBeGreaterThan(0);
  expect(view.ids.length).toBeLessThan(60);
  expect(Math.max(...view.xs)).toBeLessThan(size.w * 1.25);
  expect(Math.max(...view.ys)).toBeLessThan(size.h * 1.25);
  // 远处的卡一张都不该在 DOM 里
  expect(view.ids.some((id) => id === `n-${String(STORAGE_SIZE - 1).padStart(3, '0')}`)).toBe(false);
});

test('平移到远处：旧卡卸载、新区域挂载，数量仍受控', async ({ page }) => {
  await bootWithGrid(page);
  const before = (await mounted(page)).ids;

  await page.mouse.move(512, 384);
  await page.mouse.wheel(0, 3000); // 纯滚轮 = 平移：可见带挪到 y ∈ [2808, 3960)

  // 等到"上一屏的卡全被换掉"，避免和帧调度比手速
  await expect
    .poll(async () => (await mounted(page)).ids.filter((id) => before.includes(id)).length)
    .toBe(0);

  const after = await mounted(page);
  expect(after.ids.length).toBeGreaterThan(0);
  expect(after.ids.length).toBeLessThan(60);
  expect(Math.min(...after.ys)).toBeGreaterThan(2000); // 确实是南边那一带，而不是原屏
});

test('缩放分档：0 全量 → 1 去阴影 → 2 色块 → 3（M4 前沿用色块）', async ({ page }) => {
  await bootWithGrid(page);
  const world = page.locator('#world');
  await expect(world).toHaveAttribute('data-lod', '0');

  const shadow = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.querySelector('.note') as HTMLElement).boxShadow);
  /** 光标只能从计算样式读：这是用户眼睛真正看到的那个箭头 */
  const cursor = (selector = '.note'): Promise<string> =>
    page.evaluate((sel) => getComputedStyle(document.querySelector(sel) as HTMLElement).cursor, selector);

  // 全量态有正文可点，文字光标是"双击就能改字"的提示
  expect(await cursor()).toBe('text');

  await page.mouse.move(512, 384);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100); // ×exp(-0.6) ≈ 0.55
  await page.keyboard.up('Control');
  await expect(world).toHaveAttribute('data-lod', '1');
  expect(await shadow()).toBe('none');

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100); // ≈ 0.30
  await page.keyboard.up('Control');
  await expect(world).toHaveAttribute('data-lod', '2');
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.note-body') as HTMLElement).visibility,
    ),
  ).toBe('hidden');
  // 正文都藏了，"I" 型光标是误导：这里既不能选字也不能落插入点，只有长按能拖
  expect(await cursor()).toBe('grab');

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 200); // ≈ 0.09
  await page.keyboard.up('Control');
  await expect(world).toHaveAttribute('data-lod', '3');
  expect(await cursor()).toBe('grab');

  // 看不见正文时双击不该进编辑（0.09 倍下 n-000 只占左上角约 23×17 px）。
  // 进去也是对着空白盲打：既不知道自己点中没点中，也看不清自己打的字。
  await page.mouse.dblclick(10, 8);
  await expect(page.locator('.note.is-editing')).toHaveCount(0);

  // 空白处双击照旧建卡（吞掉操作更糟），但同样不自动进编辑。
  // 落点必须现找一个没被色块盖住的像素：缩到 0.09 倍后哪里有缝是算不出来的。
  const empty = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.note')].map((el) => el.getBoundingClientRect());
    for (let y = 60; y < window.innerHeight - 60; y += 16) {
      for (let x = 60; x < window.innerWidth - 60; x += 16) {
        const hit = rects.some(
          (r) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8,
        );
        if (!hit) return { x, y };
      }
    }
    return null;
  });
  expect(empty).not.toBeNull();
  await page.mouse.dblclick(empty!.x, empty!.y);
  // 卡照建：那个原本空无一物的像素上现在有了一张卡（`data-notes` 只在 boot 时写一次，
  // 不是活计数，所以这里看的是落点上真的出现了卡片）
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.note')),
        empty!,
      ),
    )
    .toBe(true);
  await expect(page.locator('.note.is-editing')).toHaveCount(0);
});

test('先编辑再缩小：编辑中的卡仍全量显示，光标回到文字插入点', async ({ page }) => {
  await bootWithGrid(page);

  // 1× 下卡 0 压在左上角，双击就能进编辑
  await page.mouse.dblclick(100, 100);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.mouse.move(512, 384);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 400); // ≈ 0.09，一路穿过 1/2/3 档
  await page.keyboard.up('Control');
  await expect(page.locator('#world')).toHaveAttribute('data-lod', '3');

  // 已经在编辑的卡不倒退回色块：否则用户会以为刚打的字被吞了
  await expect(page.locator('.note.is-editing .note-body')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.note.is-editing')).toHaveCSS('cursor', 'text');
});

test('正在编辑的卡不会因为平移被卸载', async ({ page }) => {
  await bootWithGrid(page);

  // 卡片 0 占世界 (0,0)-(260,184)，scale=1、pan=(0,0) 时它就压在屏幕左上角
  await page.mouse.dblclick(100, 100);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);
  await page.keyboard.type('ping');

  await page.mouse.move(512, 384);
  await page.mouse.wheel(0, 3000); // 把它送出视口
  await expect(page.locator('[data-note-id="n-000"]')).toHaveCount(1);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.keyboard.press('Escape');
  // 退出编辑后它就只是普通卡：离开视口就该被剔掉（state 变化会补一帧）
  await expect(page.locator('[data-note-id="n-000"]')).toHaveCount(0);
});
