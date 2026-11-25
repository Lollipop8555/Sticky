import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB, waitForPersistedNotes } from './helpers';

/**
 * M3 验收：拖图建卡 / Lightbox / 复制为图片 / 整墙出图 / 整库导出导入。
 *
 * 这些全是"真浏览器里才成立"的行为：图片解码、剪贴板、对话框、下载。
 * jsdom 里 mock 掉任何一环，验的都只是 mock 自己。
 */

const VIEWPORT_CENTER = { x: 640, y: 400 };

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
}

/**
 * 在画布上派发一次真实的拖拽事件，带一张 600×900 的 PNG。
 *
 * `osLike` 用来还原**真实操作系统拖拽**：`dragover` 阶段 `dataTransfer.files` 是空表，
 * 只有 `items` 里能看到 kind=file。合成的 DataTransfer 两样都有，所以"只读 files"的
 * 实现能在合成事件里蒙混过关，真人上手才发现 dragover 从未 preventDefault，
 * 松手时浏览器把窗口导航成了图片文件本身。
 */
async function dragTallImage(
  page: Page,
  type: 'dragover' | 'drop',
  { osLike = false, target = '#viewport', at = VIEWPORT_CENTER } = {},
): Promise<boolean> {
  return page.evaluate(
    async ({ x, y, type: eventType, osLike, target: selector }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 0, 600, 900);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      });
      const file = new File([blob], 'tall.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);

      const el = document.querySelector(selector);
      if (!el) throw new Error(`没有 ${selector}`);
      const event = new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: x,
        clientY: y,
      });
      if (osLike) {
        // Chromium 的合成 DataTransfer 会同时填 items 和 files，没法直接造出
        // "只有 items" 的状态，只能把事件的 dataTransfer 换成这个替身
        Object.defineProperty(event, 'dataTransfer', {
          value: {
            items: data.items,
            types: data.types,
            files: new DataTransfer().files,
            dropEffect: 'none',
            effectAllowed: 'all',
            getData: () => '',
            setData: () => {},
            clearData: () => {},
            setDragImage: () => {},
          },
        });
      }
      el.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { ...at, type, osLike, target },
  );
}

const dropTallImage = (page: Page): Promise<boolean> => dragTallImage(page, 'drop');

test('拖入图片：建一张图片便签，高度按图片比例、刷新后仍在', async ({ page }) => {
  await boot(page);

  // 拖到一半要有"可以放这里"的视觉反馈
  await dragTallImage(page, 'dragover');
  await expect(page.locator('#app')).toHaveClass(/is-dropping/);

  await dropTallImage(page);

  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('#app')).not.toHaveClass(/is-dropping/);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });

  // 600×900、宽 320 → 高 480（夹在 160~720 之间），不是"一张图一条线"
  const box = await page.locator('.note').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(450);
  expect(box?.height ?? 0).toBeLessThan(540);

  // 刷新后从库里重建：高度不能在图片解码前被 measure 校正成一条线
  await waitForPersistedNotes(page, 1);
  await page.reload();
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });
  // 用 poll 而不是单次取样：刷新后卡片可能正好在剔除/重挂的那一刻，单次量到的是 null
  await expect
    .poll(async () => (await page.locator('.note').boundingBox())?.height ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(450);
});

test('真实 OS 拖拽的 dragover 只有 items（files 为空）：也要接住并给反馈', async ({ page }) => {
  await boot(page);
  // 以前只读 dataTransfer.files，而真实拖拽在 dragover 阶段这个表是空的：
  // 于是从不 preventDefault，松手时浏览器把窗口导航成了那张图片
  const prevented = await dragTallImage(page, 'dragover', {
    osLike: true,
    target: '.controls',
    at: { x: 120, y: 620 },
  });
  expect(prevented).toBe(true);
  await expect(page.locator('#app')).toHaveClass(/is-dropping/);
});

test('拖到控件条上松手：接住并建卡，不把窗口导航走', async ({ page }) => {
  await boot(page);
  // 拖拽的落点判定不能按 DOM 分家：控件条、废纸篓锚点、toast 都在 #viewport 之外
  const prevented = await dragTallImage(page, 'drop', {
    target: '.controls',
    at: { x: 120, y: 620 },
  });
  expect(prevented).toBe(true);
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });
});

test('单击图片开 Lightbox，Esc 关闭', async ({ page }) => {
  await boot(page);
  await dropTallImage(page);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });

  await page.locator('.note-body img.note-img').click();
  const lightbox = page.locator('dialog.lightbox');
  await expect(lightbox).toHaveCount(1);
  await expect(lightbox.locator('img.lightbox-img')).toHaveAttribute('src', /^blob:/);

  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  // 卡还在：预览不该顺手改任何数据
  await expect(page.locator('.note')).toHaveCount(1);
});

test('静息态的图拖不动：光标是"点开看大图"，也不能被浏览器当文件拖出去', async ({ page }) => {
  await boot(page);
  await dropTallImage(page);
  const img = page.locator('.note-body img.note-img');
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });

  /*
   * `<img>` 默认 draggable，按住拖出去松手时浏览器给的是一份真文件，
   * 画布的 drop 又正是"收到图片就建一张卡" —— 用户看到的是一张卡变成两张。
   * 光标也不能继承卡片的 `text`（那支 I 形光标在图片上没有意义）。
   */
  await expect(img).toHaveAttribute('draggable', 'false');
  await expect(img).toHaveCSS('cursor', 'zoom-in');

  // 在图上按住拖一段再松手：只是拖画布，不会多出第二张卡
  const box = await img.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.note')).toHaveCount(1);
});

/** 在编辑中的便签里粘贴一张 240×120 的纯色图 */
async function pasteImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, 0, 240, 120);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const data = new DataTransfer();
    data.items.add(new File([blob], 'inline.png', { type: 'image/png' }));
    const editor = document.querySelector('.note-editor');
    if (!editor) throw new Error('编辑器不在');
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
}

test('图文混排：编辑态与静息态排版一致，图片下方的文字不跳到卡片边缘', async ({ page }) => {
  await boot(page);
  await page.mouse.dblclick(VIEWPORT_CENTER.x, VIEWPORT_CENTER.y);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);

  // 内容要撑过 min-height，否则两边都被 min-height 兜住，量不出排版差
  for (const line of ['第一行文字', '第二行文字', '第三行文字']) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await pasteImage(page);
  await expect(page.locator('.note-editor img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('图片下方的文字');
  await page.waitForTimeout(300);

  // Tiptap 在图片节点两侧塞的 .ProseMirror-separator 是布局幽灵：必须 0 尺寸、且压过它
  // 自己注入的 `display: inline !important`。以前它们是 48px 高的灰块（套上了
  // `img:not([src])` 的占位样式），编辑态凭空比静息态高 116px，一退出编辑
  // "图片下方的文字"就整块上移、贴到卡片边缘。
  const separators = await page.evaluate(() =>
    [...document.querySelectorAll('.note-editor img.ProseMirror-separator')].map((el) => {
      const rect = el.getBoundingClientRect();
      return [rect.width, rect.height];
    }),
  );
  expect(separators.length).toBeGreaterThan(0); // 前置条件：Tiptap 真的插了这两个占位
  for (const [width, height] of separators) {
    expect(width).toBe(0);
    expect(height).toBe(0);
  }

  const editBox = await page.locator('.note').boundingBox();
  await page.keyboard.press('Escape');
  await expect(page.locator('.note.is-editing')).toHaveCount(0);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/);

  const restBox = await page.locator('.note').boundingBox();
  expect(Math.abs((restBox?.height ?? 0) - (editBox?.height ?? 0))).toBeLessThanOrEqual(4);

  // 图片下方的文字离卡片底边还得留着卡片自己的内边距
  const gapToBottom = await page.evaluate(() => {
    const note = document.querySelector('.note');
    if (!note) throw new Error('卡片不在');
    const body = note.querySelector('.note-body');
    const last = [...(body?.querySelectorAll('p') ?? [])].at(-1);
    if (!last) throw new Error('没有段落');
    return note.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  });
  expect(gapToBottom).toBeGreaterThanOrEqual(10);
});

test('复制为图片：进剪贴板（或退化成下载），卡不变', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await dropTallImage(page);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });

  await page.locator('.note').hover();
  await page.locator('.note-copy').click();
  // 两条路径都是产品行为：能写剪贴板就复制，权限/浏览器不支持就下载
  const toast = page.locator('.toast');
  await expect(toast).toContainText(/已复制|已下载/, { timeout: 15_000 });
  const text = await toast.innerText();
  if (text.includes('已复制')) {
    // 不只看"剪贴板里有个 PNG"：图有没有真的画进去，只能数像素
    const report = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find((one) => one.types.includes('image/png'));
      if (!item) return { hasPng: false, blue: 0 };
      const blob = await item.getType('image/png');
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) > 200 && (data[i + 2] ?? 0) > 200 && (data[i] ?? 0) < 140) {
          blue += 1;
        }
      }
      return { hasPng: true, blue };
    });
    expect(report.hasPng).toBe(true);
    // 拖进去的是一张 #38bdf8 的满版图：出图里必须有成片的蓝。
    // 曾经这里是 0 —— 快照库 fetch(blob:) 被 CSP 的 connect-src 拦掉，整张图被丢弃
    expect(report.blue).toBeGreaterThan(10_000);
  }

  await expect(page.locator('.note')).toHaveCount(1);
});

test('静息态不摆 I 形光标：卡片主体是默认光标，编辑态才回到文字输入', async ({ page }) => {
  await boot(page);
  await seedDB(page, {
    notes: [noteRecord('c1', { x: 140, y: 140, contentMd: '一段**没法选中**的文字' })],
  });
  await page.reload();
  const note = page.locator('.note');
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute('data-empty', 'false');
  // 静息态既选不中、也放不下插入点：那道 I 形光标许诺的是一个做不到的操作
  await expect(note).toHaveCSS('cursor', 'default');
  await expect(page.locator('.note-body')).toHaveCSS('cursor', 'default');

  await note.dblclick();
  await expect(note).toHaveClass(/is-editing/);
  await expect(note).toHaveCSS('cursor', 'auto');
});

test('复制为文本：剪贴板里是带内联样式的 HTML，纯文本不带 markdown 记号', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await seedDB(page, {
    notes: [
      noteRecord('t1', {
        x: 140,
        y: 140,
        contentMd: '**重点**内容，还有一点代码 `npm i`\n\n- 第一条\n- 第二条',
      }),
    ],
  });
  await page.reload();
  await expect(page.locator('.note')).toHaveCount(1);

  await page.locator('.note').hover();
  await page.locator('.note-text').click();
  await expect(page.locator('.toast')).toContainText(/已复制文本|只能复制纯文本/, {
    timeout: 15_000,
  });

  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const html = items.find((one) => one.types.includes('text/html'));
    const plain = items.find((one) => one.types.includes('text/plain'));
    return {
      html: html ? await (await html.getType('text/html')).text() : '',
      plain: plain ? await (await plain.getType('text/plain')).text() : '',
    };
  });

  /*
   * 粘进 Word 的是 HTML 这一份：语义标签要在、样式要内联（目标文档不会带我们的 CSS 走），
   * 而且不能是 markdown 源码 —— 那粘过去就是一堆星号和反引号。
   */
  expect(clip.html).toContain('<strong');
  expect(clip.html).toContain('<code');
  expect(clip.html).toContain('<li');
  expect(clip.html).toContain('font-family');
  expect(clip.html).not.toContain('**');

  // 记事本/聊天框读的是纯文本这一份：内容在，记号不在
  expect(clip.plain).toContain('重点');
  expect(clip.plain).toContain('第一条');
  expect(clip.plain).not.toContain('**');
  expect(clip.plain).not.toContain('`');
});

test('复制为文本：卡上的图也一起带走（剪贴板里是 data URL，不是 blob）', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await dropTallImage(page);
  await expect(page.locator('.note-body img.note-img')).toHaveAttribute('src', /^blob:/, {
    timeout: 15_000,
  });

  await page.locator('.note').hover();
  await page.locator('.note-text').click();
  await expect(page.locator('.toast')).toContainText(/已复制文本|只能复制纯文本/, {
    timeout: 15_000,
  });

  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((one) => one.types.includes('text/html'));
    return item ? await (await item.getType('text/html')).text() : '';
  });
  // blob: 出了这个页面就是死链，Word 拿到的是一个空图框
  expect(html).toContain('src="data:image');
  expect(html).not.toContain('blob:');
});

test('设置 → 导出整墙图片：拿到一张 PNG', async ({ page }) => {
  await boot(page);
  await seedDB(page, {
    notes: [
      noteRecord('n1', { x: 100, y: 100, contentMd: '左边' }),
      noteRecord('n2', { x: 500, y: 260, contentMd: '右边', z: 2 }),
    ],
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '2');

  await page.locator('.ctl[data-act="settings"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('.data-wall').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^便签墙-\d{4}-\d{2}-\d{2}\.png$/);
  expect(await download.path()).toBeTruthy();
  await expect(page.locator('.toast')).toContainText('已导出');
});

test('整库导出 → 再导入：数量翻倍但内容不丢，刷新后仍在', async ({ page }, testInfo) => {
  await boot(page);
  await seedDB(page, {
    notes: [
      noteRecord('n1', { x: 100, y: 100, contentMd: '第一张' }),
      noteRecord('n2', { x: 480, y: 300, contentMd: '第二张', z: 2 }),
    ],
    prefs: { viewport: { panX: 0, panY: 0, scale: 1 } },
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '2');

  // ---- 导出：确认框先说明导出范围，再说"废纸篓不导出"
  await page.locator('.ctl[data-act="settings"]').click();
  await page.locator('.data-export').click();
  const confirm = page.locator('dialog.sheet-prompt');
  await expect(confirm).toContainText('导出整库备份');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    confirm.getByRole('button', { name: '导出', exact: true }).click(),
  ]);
  const zipPath = testInfo.outputPath('backup.zip');
  await download.saveAs(zipPath);
  expect(download.suggestedFilename()).toMatch(/^便签墙-\d{4}-\d{2}-\d{2}\.zip$/);

  // ---- 导入：选包 → 问外观（默认不勾）→ 汇总
  await page.locator('.ctl[data-act="settings"]').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.data-import').click();
  await (await chooserPromise).setFiles(zipPath);

  const prefsDialog = page.locator('dialog.sheet-prompt');
  await expect(prefsDialog).toContainText('导入设置');
  await expect(prefsDialog.locator('input[data-field="importPrefs"]')).not.toBeChecked();
  await prefsDialog.getByRole('button', { name: '导入便签' }).click();

  const summary = page.locator('dialog.sheet-prompt');
  await expect(summary).toContainText('导入完成');
  await expect(summary).toContainText('新增 2 张便签');
  await summary.getByRole('button', { name: '知道了' }).click();

  // data-notes 只在启动时写，导入当场要看真实 DOM
  await expect(page.locator('.note')).toHaveCount(4);

  // 名字撞了要改名，不能覆盖：库里应当是 4 个互不相同的 id
  await waitForPersistedNotes(page, 4);
  const ids = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sticky-wall');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db.transaction('notes', 'readonly').objectStore('notes').getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return keys.map(String);
  });
  expect(new Set(ids).size).toBe(4);
  expect(ids).toEqual(expect.arrayContaining(['n1', 'n2', 'n1-1', 'n2-1']));

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-notes', '4');
  await expect(page.locator('.note').filter({ hasText: '第一张' })).toHaveCount(2);
});
