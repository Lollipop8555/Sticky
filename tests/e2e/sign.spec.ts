import { expect, test, type Page } from '@playwright/test';

import { noteRecord, seedDB } from './helpers';

/**
 * 尾签（决策 90）的验收。三句话的要求，三条路各测一遍：
 *
 * - 屏幕上要有它（卡片的一部分）；
 * - 必须**真的进图**（导出图里没字的话，DOM 上有个 `.note-sign` 也没意义）；
 * - 复制文本时必须**没有**它（它不属于内容）。
 *
 * "复制不带它"这条其实不用测：复制走的是 `contentMd`，尾签压根不在这条路上。
 * 但正因为如此才要有一条断言把这个约定钉住 —— 以后谁把复制改成"抓卡片 DOM 的文本"，
 * 尾签就会悄悄跟着走，这条会红。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await seedDB(page, { notes: [noteRecord('n1', { x: 40, y: 40, contentMd: '一张便签' })] });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note')).toHaveCount(1);
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.ctl[data-act="settings"]').click();
  await expect(page.locator('.sheet-settings')).toBeVisible();
}

async function turnOnSign(page: Page, text: string): Promise<void> {
  await openSettings(page);
  await page.locator('.sheet-settings input[data-field="signOn"]').check();
  await page.locator('.sheet-settings input[data-field="signText"]').fill(text);
  await page.locator('.sheet-settings .sheet-close').click();
}

/** 等写队列把偏好冲进库：改完立刻 reload 是在赌 400ms 节流 */
async function waitForSignSaved(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (expected) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sticky-wall');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const row = await new Promise<{ key: string; value: unknown } | undefined>(
            (resolve, reject) => {
              const req = db.transaction('prefs', 'readonly').objectStore('prefs').get('settings');
              req.onsuccess = () => resolve(req.result as { key: string; value: unknown } | undefined);
              req.onerror = () => reject(req.error);
            },
          );
          db.close();
          const settings = row?.value as { signOn?: boolean; signText?: string } | undefined;
          return settings?.signOn === true && settings.signText === expected;
        }, text),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** 复制单卡图并读回来（读不到就返回 null，说明走了下载分支） */
async function copyCardImage(page: Page): Promise<string | null> {
  await page.evaluate(() => navigator.clipboard.writeText('stale'));
  await page.locator('.note').hover();
  await page.locator('.note-copy').click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText(/已复制|已下载/, { timeout: 20_000 });
  if ((await toast.innerText()).includes('已下载')) return null;

  const read = (): Promise<string | null> =>
    page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find((one) => one.types.includes('image/png'));
      if (!item) return null;
      const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
      return btoa(binary);
    });

  await expect.poll(async () => (await read()) !== null, { timeout: 20_000 }).toBe(true);
  return read();
}

/**
 * 两张 PNG 逐像素比。同一张卡只差一个尾签，正文区域应当完全相同，
 * 差异只会落在多出来那一行上。
 *
 * 用像素而不是"DOM 里有 `.note-sign`"：快照库完全可能忽略那个节点，
 * 那样 DOM 断言全绿、用户拿到的图还是干净的。
 */
async function diffPixels(page: Page, withSign: string, clean: string) {
  return page.evaluate(
    async ({ a, b }) => {
      async function load(b64: string): Promise<ImageData> {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }

      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) {
        return { sameSize: false, diff: 0, total: 0 };
      }
      let diff = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const dr = Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0));
        const dg = Math.abs((x.data[i + 1] ?? 0) - (y.data[i + 1] ?? 0));
        const db = Math.abs((x.data[i + 2] ?? 0) - (y.data[i + 2] ?? 0));
        if (dr > 2 || dg > 2 || db > 2) diff += 1;
      }
      return { sameSize: true, diff, total: x.width * x.height };
    },
    { a: withSign, b: clean },
  );
}

test('默认关；开启后卡片末尾出现尾签，刷新后回填', async ({ page }) => {
  await boot(page);

  // 关着时元素在、但不占位（`hidden`）：省掉"开关一拨就得重建卡片"这条路径
  await expect(page.locator('.note-sign')).toBeHidden();

  await turnOnSign(page, '阿洛');
  await expect(page.locator('.note-sign')).toHaveText('阿洛');
  await expect(page.locator('.note-sign')).toBeVisible();

  await waitForSignSaved(page, '阿洛');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note-sign')).toHaveText('阿洛');

  // 关掉：整行消失
  await openSettings(page);
  await page.locator('.sheet-settings input[data-field="signOn"]').uncheck();
  await page.locator('.sheet-settings .sheet-close').click();
  await expect(page.locator('.note-sign')).toBeHidden();
});

test('复制为文本：尾签不跟着走（它不属于内容）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await turnOnSign(page, '阿洛');

  await page.locator('.note').hover();
  await page.locator('.note-text').click();
  await expect(page.locator('.toast')).toContainText(/已复制文本|只能复制纯文本/, {
    timeout: 15_000,
  });

  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const plain = items.find((one) => one.types.includes('text/plain'));
    const html = items.find((one) => one.types.includes('text/html'));
    return {
      plain: plain ? await (await plain.getType('text/plain')).text() : '',
      html: html ? await (await html.getType('text/html')).text() : '',
    };
  });

  expect(clip.plain).toContain('一张便签');
  expect(clip.plain).not.toContain('阿洛');
  expect(clip.html).not.toContain('阿洛');
  // 装饰线也不该以字符形式混进来（早期版本是往 textContent 里敲 `-` 拼的）
  expect(clip.plain).not.toMatch(/-{3,}/);
});

test('复制为图片：尾签真的画进了图里', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);

  const clean = await copyCardImage(page);
  test.skip(clean === null, '剪贴板不可用，单卡走了下载分支');

  await turnOnSign(page, '阿洛');
  const signed = await copyCardImage(page);
  expect(signed).not.toBeNull();

  const result = await diffPixels(page, signed!, clean!);
  expect(result.sameSize).toBe(true);
  // 字确实画上去了
  expect(result.diff).toBeGreaterThan(200);
  // 但只多了一行：不能把整张卡染一遍
  expect(result.diff).toBeLessThan(result.total * 0.2);
});

test('几何：两条线等长、文字夹在正中；长文字换行时线不再变短', async ({ page }) => {
  await boot(page);
  await turnOnSign(page, '阿洛');

  /**
   * 量的是"看起来对不对"，不是"节点在不在"。
   * 早期版本把线拼成 `-` 字符，靠字数对齐 —— 换个字重就歪，文字一长直接顶出卡片。
   * 现在线是 flex 边，这两条断言就是在守它：等长（文字才居中）、有下限（长文字不把线吃光）。
   */
  const measure = () =>
    page.evaluate(() => {
      const sign = document.querySelector<HTMLElement>('.note-sign');
      if (!sign) throw new Error('没找到尾签');
      const rules = [...sign.querySelectorAll<HTMLElement>('.note-sign-rule')];
      const text = sign.querySelector<HTMLElement>('.note-sign-text');
      if (rules.length !== 2 || !text) throw new Error('尾签结构不对：应为 线 | 文字 | 线');

      const [left, right] = rules as [HTMLElement, HTMLElement];
      const lb = left.getBoundingClientRect();
      const rb = right.getBoundingClientRect();
      const tb = text.getBoundingClientRect();
      const style = getComputedStyle(text);

      return {
        leftWidth: lb.width,
        rightWidth: rb.width,
        // 文字中心 vs 两条线之间的空隙中心
        textMid: tb.left + tb.width / 2,
        gapMid: (lb.right + rb.left) / 2,
        textHeight: tb.height,
        lineHeight: parseFloat(style.lineHeight),
        fontPx: parseFloat(getComputedStyle(sign).fontSize),
      };
    });

  const short = await measure();
  expect(Math.abs(short.leftWidth - short.rightWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(short.textMid - short.gapMid)).toBeLessThanOrEqual(1.5);
  // 单行
  expect(short.textHeight).toBeLessThan(short.lineHeight * 1.5);

  // 顶到 40 字上限：文字折行，两侧线各自保留"基本长度"（2.5em）
  await turnOnSign(page, '这是一句相当长的尾签文字用来验证换行之后两侧线条还在不在');
  const long = await measure();
  expect(long.textHeight).toBeGreaterThan(long.lineHeight * 1.5);
  expect(Math.abs(long.leftWidth - long.rightWidth)).toBeLessThanOrEqual(1);
  expect(Math.min(long.leftWidth, long.rightWidth)).toBeGreaterThanOrEqual(long.fontPx * 2.4);
});

test('贴底：内容不满一卡时按在卡底，撑满时接在正文后', async ({ page }) => {
  await boot(page);
  await turnOnSign(page, '阿洛');

  /**
   * 两组数字缺一不可：
   * - `gapToBottom` 小 → 确实在卡底（不是跟着最后一行字跑）；
   * - `textToSign` 大 → 正文短的时候中间是空的；
   * 反过来（长内容）`textToSign` 收到一行行距、`cardHeight` 超过 `--min-h`。
   * 只测前者会漏掉"内容一多就压住正文"，只测后者会漏掉这次的 bug。
   */
  const measure = () =>
    page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.note');
      if (!card) throw new Error('没找到便签');
      const body = card.querySelector<HTMLElement>('.note-body');
      const sign = card.querySelector<HTMLElement>('.note-sign');
      if (!body || !sign) throw new Error('缺少正文或尾签');

      const cb = card.getBoundingClientRect();
      const bb = body.getBoundingClientRect();
      const sb = sign.getBoundingClientRect();
      const style = getComputedStyle(card);

      return {
        cardHeight: cb.height,
        // 这张卡的 `--min-h`：内容不满时卡高应该正好等于它
        minH: parseFloat(style.minHeight),
        padBottom: parseFloat(style.paddingBottom),
        // 尾签底边到卡底的距离：贴底时 ≈ 下内边距
        gapToBottom: cb.bottom - sb.bottom,
        // 正文底边到尾签顶边：内容装不满时是一大片空白，撑满时只剩一行行距
        textToSign: sb.top - bb.bottom,
      };
    });

  const short = await measure();
  // 内容只有一行：卡高被 `min-height` 兜住，尾签应该已经沉到底部
  expect(Math.abs(short.cardHeight - short.minH)).toBeLessThanOrEqual(1);
  expect(short.gapToBottom).toBeLessThanOrEqual(short.padBottom + 1);
  expect(short.textToSign).toBeGreaterThan(40);

  // 换一张长卡：正文自己把卡撑高，尾签跟着到最后一行下面，不是浮在半空
  await seedDB(page, {
    notes: [
      noteRecord('n1', {
        x: 40,
        y: 40,
        contentMd: Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段`).join('\n\n'),
      }),
    ],
  });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('.note-sign')).toBeVisible();

  const long = await measure();
  expect(long.cardHeight).toBeGreaterThan(short.cardHeight);
  expect(long.gapToBottom).toBeLessThanOrEqual(long.padBottom + 1);
  // 紧接正文：`margin-top: auto` 在这里归零，那 0.8em 的间距是尾签自己的 padding-top
  expect(Math.abs(long.textToSign)).toBeLessThanOrEqual(1);
});

test('编辑态：尾签还在屏幕上，但不进编辑器内容', async ({ page }) => {
  await boot(page);
  await turnOnSign(page, '阿洛');

  const note = page.locator('.note');
  await note.dblclick();
  await expect(note).toHaveClass(/is-editing/);

  await expect(note.locator('.note-sign')).toBeVisible();
  // 编辑器内容里不能有它：有的话一按 End + 退格就被删了，还会跟着 markdown 存回去
  await expect(note.locator('.note-editor')).not.toContainText('阿洛');
});
