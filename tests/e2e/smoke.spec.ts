import { expect, test, type Page } from '@playwright/test';

const BACKGROUNDS = ['paper', 'kraft', 'grid', 'blackboard'] as const;

/** 收集 console error 与 pageerror，任何一条都让用例失败 */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function canvasColor(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('.viewport') as HTMLElement).backgroundColor,
  );
}

test('首屏：骨架就位、脚本已执行、无 CSP 违规', async ({ page }) => {
  const errors = trackErrors(page);

  const res = await page.goto('./');
  expect(res?.status()).toBe(200);

  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#viewport')).toBeVisible();
  await expect(page.locator('#note-layer')).toBeAttached();

  // CSP 违规会以 console error 形式出现（style-src / img-src），这里一网打尽
  expect(errors).toEqual([]);
});

test('默认材质是 paper 且 theme-color 与底色一致', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('html')).toHaveAttribute('data-background', 'paper');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F5F2EC');

  const rgb = await canvasColor(page);
  expect(rgb).not.toBe('rgba(0, 0, 0, 0)');
});

test('四种材质各自有独立底色（?bg= 预览口）', async ({ page }) => {
  const seen = new Map<string, string>();

  for (const bg of BACKGROUNDS) {
    await page.goto(`./?bg=${bg}`);
    await expect(page.locator('html')).toHaveAttribute('data-background', bg);

    const color = await canvasColor(page);
    seen.set(bg, color);

    const meta = await page.getAttribute('meta[name="theme-color"]', 'content');
    expect(meta).toBeTruthy();
  }

  // 四种材质两两不同：能挡住「变量写错导致全部退回同一底色」
  const unique = new Set(seen.values());
  expect(unique.size).toBe(BACKGROUNDS.length);
});

test('非法 ?bg= 回落 paper，不白屏', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./?bg=%3Cscript%3Ealert(1)%3C/script%3E');

  await expect(page.locator('html')).toHaveAttribute('data-background', 'paper');
  await expect(page.locator('#note-layer')).toBeAttached();
  expect(errors).toEqual([]);
});
