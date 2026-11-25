import { expect, test, type Page } from '@playwright/test';

/**
 * 卡片的完整闭环：**双击建卡 → 输入 → 点空白保存 → 刷新还在，且长得一样**。
 *
 * 断言分两层：
 * - DOM（用户看见的）：正文文字、卡片包围盒高度、占位符消失
 * - 库（真相）：`contentMd` / `height` / `x,y` / `z`
 * 只断言前者会漏掉"显示对了但没存"；只断言后者会漏掉"存对了但显示错"。
 */

async function booted(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
}

async function readStored(page: Page): Promise<
  { id: string; contentMd: string; height: number; x: number; y: number; z: number }[]
> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sticky-wall');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<{ id: string; contentMd: string; height: number; x: number; y: number; z: number }[]>(
      (resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return rows;
  });
}

test('双击空白建卡 → 输入 → 点空白保存 → 刷新一致', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(640, 360);
  await expect(page.locator('.note')).toHaveCount(1);
  // 建完立刻进编辑：新建卡的目的就是写字
  await expect(page.locator('.note.is-editing .note-editor')).toBeVisible();

  for (let i = 1; i <= 10; i++) {
    await page.keyboard.type(`第${i}行`);
    if (i < 10) await page.keyboard.press('Enter');
  }

  // 点空白 = 保存并退出（不是 pointerdown：拖画布时编辑框不该突然消失）
  await page.mouse.click(1080, 640);
  await expect(page.locator('.note.is-editing')).toHaveCount(0);

  const card = page.locator('.note').first();
  await expect(card.locator('.note-body')).toContainText('第10行');

  const box = await card.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200); // 内容真的把卡撑高了

  await page.waitForTimeout(600); // 等节流窗口过去，验证"定时落库"这条路径
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  const [stored] = await readStored(page);
  expect(stored?.contentMd).toContain('第10行');
  expect(stored?.contentMd.split('\n\n')).toHaveLength(10); // 段落在 md 里是 \n\n
  expect(stored?.height ?? 0).toBeGreaterThan(200);

  // 刷新后高度与落库值一致：远视角色块要靠这个比例，差得多就说明回填没走通
  const after = await page.locator('.note').first().boundingBox();
  expect(Math.abs((after?.height ?? 0) - (stored?.height ?? 0))).toBeLessThanOrEqual(2);
  await expect(page.locator('.note-body')).toContainText('第1行');
});

test('粗体进编辑器、落库成 markdown 而不是 HTML', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(640, 360);
  await page.keyboard.type('普通');
  // ControlOrMeta：ProseMirror 的 Mod-b 在 macOS 上是 Cmd，写死 Control 只在 Linux/Windows 生效
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('加粗');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('尾巴');

  await expect(page.locator('.note-body strong')).toHaveCount(1); // 编辑器里确实是富文本

  await page.mouse.click(1080, 640);
  await page.waitForTimeout(600);

  const [stored] = await readStored(page);
  expect(stored?.contentMd).toBe('普通**加粗**尾巴');

  // 非编辑态用同一套 schema 渲染，所以刷新后粗体还在
  await page.reload();
  await expect(page.locator('.note-body strong')).toHaveText('加粗');
});

test('双击卡片进编辑；双击另一张时前一张先保存（严格单卡）', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('第一张');
  await page.mouse.click(1100, 650); // 保存并退出
  await expect(page.locator('.note')).toHaveCount(1);

  await page.mouse.dblclick(900, 300);
  await page.keyboard.type('第二张');
  await page.mouse.click(1100, 650);
  await expect(page.locator('.note')).toHaveCount(2);

  await page.mouse.dblclick(400, 300); // 进第一张
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.mouse.dblclick(900, 300); // 直接进第二张：第一张必须已经被保存
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  await page.waitForTimeout(600);
  const stored = await readStored(page);
  expect(stored.map((n) => n.contentMd).sort()).toEqual(['第一张', '第二张']);
});

test('Esc 退出编辑并保存', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(640, 360);
  await page.keyboard.type('按 Esc 保存');
  await page.keyboard.press('Escape');

  await expect(page.locator('.note.is-editing')).toHaveCount(0);
  await expect(page.locator('.note-body')).toHaveText('按 Esc 保存');

  await page.waitForTimeout(600);
  expect((await readStored(page))[0]?.contentMd).toBe('按 Esc 保存');
});

test('空卡显示占位符，输入后消失；删空后占位符回来', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(640, 360);
  await expect(page.locator('.note')).toHaveAttribute('data-empty', 'false'); // 编辑中不显示

  await page.mouse.click(1080, 640);
  await expect(page.locator('.note')).toHaveAttribute('data-empty', 'true');
  await expect(page.locator('.note-placeholder')).toBeVisible();

  await page.mouse.dblclick(640, 360);
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');

  await expect(page.locator('.note')).toHaveAttribute('data-empty', 'true');
});

test('新建卡与已有卡重叠时不会完全盖住旧卡', async ({ page }) => {
  await booted(page);

  await page.mouse.dblclick(640, 360);
  await page.keyboard.press('Escape');
  // 偏离旧卡下边缘（320 高的卡，底边在 520）40px 再建：
  // 以落点为心的新卡会与旧卡重叠 37.5%，
  // 超过 30% 容差后应向右下让开（同一落点会命中旧卡、进编辑，建不出新卡）
  await page.mouse.dblclick(640, 560);
  await page.keyboard.press('Escape');

  const boxes = await page.locator('.note').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );

  expect(boxes).toHaveLength(2);
  expect(boxes[0]?.x).not.toBe(boxes[1]?.x); // 挪开了，不是完全重合
});
