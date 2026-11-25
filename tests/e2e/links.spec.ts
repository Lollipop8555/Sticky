import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

import { noteRecord, readTransform, seedDB, waitForPersistedNotes } from './helpers';

/**
 * 连线（决策 73–77）的黑盒验收。
 *
 * 线是**屏幕叠加层**画的，端点由便签坐标现算 —— 单测只能验边集与几何换算，
 * "右键能弹菜单""点目标真的连上""刷新后线还在"只有真浏览器说得清。
 */

const A = (): Record<string, unknown> =>
  noteRecord('a', { x: 120, y: 120, contentMd: '源便签', createdAt: 1 });
const B = (): Record<string, unknown> =>
  noteRecord('b', {
    x: 720,
    y: 160,
    contentMd: '目标便签',
    createdAt: 2,
    z: 2,
    // 与 A 不同的底色：两端色相同的话"有没有渐变"根本看不出来
    bgColor: '#BFDBFE',
  });

const path = (page: Page) => page.locator('#link-layer path.link');
const menu = (page: Page) => page.locator('.link-menu');

async function openWall(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await seedDB(page, {
    notes: [A(), B()],
    prefs: { viewport: { panX: 0, panY: 0, scale: 1 }, ...prefs },
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '2');
}

async function openMenuVia(page: Page, noteId: string): Promise<void> {
  await page.locator(`.note[data-note-id="${noteId}"]`).click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

test('已连的线：叠加层画出来；右键列表能断开，刷新后仍然断', async ({ page }) => {
  await openWall(page, { links: [['a', 'b']] });
  await expect(path(page)).toHaveCount(1);

  // 两端取各自卡片的"毛线色"，所以渐变的两枚 stop 必须不同色 ——
  // 曾用 textColor：不是近黑就是近白，两端永远同色，渐变等于没有
  const stops = await page
    .locator('#link-layer stop')
    .evaluateAll((els) => els.map((el) => el.getAttribute('stop-color')));
  expect(stops).toHaveLength(2);
  expect(stops[0]).not.toBe(stops[1]);
  await expect(path(page)).toHaveAttribute('stroke', /url\(#link-grad-\d+\)/);

  await openMenuVia(page, 'a');
  await expect(menu(page).locator('.link-menu-title')).toContainText('1');
  await expect(menu(page).locator('.link-menu-item')).toHaveCount(1);
  await expect(menu(page).locator('.link-menu-text')).toContainText('目标便签');

  await menu(page).locator('.link-menu-cut').click();
  await expect(path(page)).toHaveCount(0);
  // 断完不关菜单：断到 0 条自然显示空态
  await expect(menu(page).locator('.link-menu-empty')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  // 等写队列把边集冲进库，否则刷新读回的还是旧值
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(path(page)).toHaveCount(0);
});

test('右键 → 添加连线 → 点目标连上；重复点不叠加；Esc 与点空白都能退出', async ({ page }) => {
  await openWall(page);
  await openMenuVia(page, 'a');
  await menu(page).locator('.link-menu-add').click();

  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');
  const hud = page.locator('.link-hud');
  await expect(hud).toBeVisible();

  // 底部只有"完成"，没有预览卡：源便签的身份由墙上那张卡承担
  const done = page.locator('.link-hud-done');
  await expect(done).toBeVisible();
  await expect(done).toHaveText('完成');
  await expect(page.locator('.link-source-card')).toHaveCount(0);

  // 源便签留在原位、灰化发光，不再"消失"
  const sourceNote = page.locator('.note[data-note-id="a"]');
  await expect(sourceNote).toBeVisible();
  await expect(sourceNote).toHaveClass(/note--link-source/);
  // 连线途中不能删卡、不能进废纸篓
  await expect(page.locator('.note[data-note-id="b"] .note-delete')).toBeHidden();
  await expect(page.locator('.trash-anchor')).toBeHidden();

  // 点源便签自己：无反应，不退出模式也不加边
  await sourceNote.click();
  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');
  await expect(path(page)).toHaveCount(0);

  await page.locator('.note[data-note-id="b"]').click();
  await expect(path(page)).toHaveCount(1);
  // 连完留在模式里继续连；再点一次是幂等的
  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');
  await page.locator('.note[data-note-id="b"]').click();
  await expect(path(page)).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-linking', 'true');
  await expect(hud).toBeHidden();
  // 退出模式清掉灰化标记，也不影响已经连上的线
  await expect(sourceNote).toBeVisible();
  await expect(sourceNote).not.toHaveClass(/note--link-source/);
  await expect(path(page)).toHaveCount(1);

  // 再进一次，点"完成"退出
  await openMenuVia(page, 'a');
  await menu(page).locator('.link-menu-add').click();
  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');
  await done.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-linking', 'true');
  await expect(sourceNote).toBeVisible();

  // 再进一次，点空白退出
  await openMenuVia(page, 'a');
  await menu(page).locator('.link-menu-add').click();
  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');
  await page.mouse.click(1120, 700);
  await expect(page.locator('html')).not.toHaveAttribute('data-linking', 'true');
});

test('源便签离屏：边缘方位指引出现，回到屏内立即消失', async ({ page }) => {
  await openWall(page);
  await openMenuVia(page, 'a');
  await menu(page).locator('.link-menu-add').click();

  const compass = page.locator('.link-compass');
  await expect(compass).not.toHaveClass(/is-visible/);

  // 把画布往左拖，源便签 a 被推到屏幕外
  await page.mouse.move(1000, 400);
  await page.mouse.down();
  await page.mouse.move(200, 400, { steps: 12 });
  await page.mouse.up();

  // 200ms 迟滞 + 150ms 淡入
  await expect(compass).toHaveClass(/is-visible/, { timeout: 1000 });
  await expect(compass).toBeVisible();
  const edgeX = await compass.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(edgeX).toBeGreaterThanOrEqual(40);
  expect(edgeX).toBeLessThanOrEqual(80);
  // 仍在模式里：拖画布不是"点空白退出"
  await expect(page.locator('html')).toHaveAttribute('data-linking', 'true');

  // 拖回来，回屏立即收起（不等迟滞）
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(1000, 400, { steps: 12 });
  await page.mouse.up();
  await expect(compass).not.toHaveClass(/is-visible/);
});

test('大头针开列表 → 跳转：先退出编辑、scale 不变、目标居中', async ({ page }) => {
  await openWall(page, { links: [['a', 'b']] });
  const before = await readTransform(page);

  // 编辑态：双击正文进编辑（大头针只在格式条上有）
  const aBox = await page.locator('.note[data-note-id="a"]').boundingBox();
  expect(aBox).not.toBeNull();
  await page.mouse.dblclick(aBox!.x + aBox!.width / 2, aBox!.y + aBox!.height / 2);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.locator('.note.is-editing [data-link-open]').click();
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('.link-menu-pick').click();

  await expect(menu(page)).toBeHidden();
  // 都跳转了就不编辑了：culling 不保留编辑卡，留着一个"幽灵编辑态"没有意义
  await expect(page.locator('.note.is-editing')).toHaveCount(0);

  const size = page.viewportSize();
  expect(size).not.toBeNull();
  // set() 只 scheduleFrame：transform 要等一帧才落到 DOM 上，所以 poll 而不是立刻量
  await expect
    .poll(async () => {
      const box = await page.locator('.note[data-note-id="b"]').boundingBox();
      return box ? [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] : null;
    })
    .toEqual([Math.round(size!.width / 2), Math.round(size!.height / 2)]);

  // 跳转只挪 pan，不动 scale
  const after = await readTransform(page);
  expect(after.scale).toBeCloseTo(before.scale, 5);
});

test('软删参与连线的便签：线消失，撤销恢复后线回来', async ({ page }) => {
  await openWall(page, { links: [['a', 'b']] });
  await expect(path(page)).toHaveCount(1);

  await page.locator('.note[data-note-id="a"]').hover();
  await page.locator('.note[data-note-id="a"] .note-delete').click();
  // 软删只是把记录从内存摘掉：边集不动，但读不到坐标就不该画
  await expect(page.locator('.note[data-note-id="a"]')).toHaveCount(0);
  await expect(path(page)).toHaveCount(0);

  await page.locator('.toast-action').click();
  await expect(page.locator('.note[data-note-id="a"]')).toHaveCount(1);
  await expect(path(page)).toHaveCount(1);
});

test('整库导出带 manifest.links；再导入后边集合并去重', async ({ page }, testInfo) => {
  await openWall(page, { links: [['a', 'b']] });

  // ---- 导出
  await page.locator('.ctl[data-act="settings"]').click();
  await page.locator('.data-export').click();
  const confirm = page.locator('dialog.sheet-prompt');
  await expect(confirm).toContainText('导出整库备份');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    confirm.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const zipPath = testInfo.outputPath('links.zip');
  await download.saveAs(zipPath);

  // 边集在 manifest 顶层，不能混进 preferences
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const entry = zip.file('manifest.json');
  expect(entry).not.toBeNull();
  const manifest = JSON.parse(await entry!.async('string')) as {
    links?: unknown;
    preferences?: unknown;
  };
  expect(manifest.links).toEqual([['a', 'b']]);
  expect(manifest.preferences).not.toHaveProperty('links');

  // ---- 导入：两张卡都会改名，线必须跟着指向改名后的 id
  await page.locator('.ctl[data-act="settings"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.data-import').click();
  await (await chooser).setFiles(zipPath);
  const prefsDialog = page.locator('dialog.sheet-prompt');
  await expect(prefsDialog).toContainText('导入设置');
  await prefsDialog.getByRole('button', { name: '导入便签' }).click();

  const summary = page.locator('dialog.sheet-prompt');
  await expect(summary).toContainText('导入完成');
  await expect(summary).toContainText('新增 2 张便签');
  await expect(summary).toContainText('恢复 1 条连线');
  await summary.getByRole('button', { name: '知道了' }).click();

  await expect(page.locator('.note')).toHaveCount(4);
  await expect(path(page)).toHaveCount(2);
  await waitForPersistedNotes(page, 4);

  // 刷新后边集仍是合并后的两条（重复的包不会把同一条线加两次）
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '4');
  await expect(path(page)).toHaveCount(2);
});
