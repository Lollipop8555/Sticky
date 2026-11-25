import { expect, test, type Page } from '@playwright/test';

/**
 * S10 的验收：列表/链接/行内代码/删除线能写、能存、刷新后还在。
 * 这里只验"用户能走通的路"，md 层面的 round-trip 全在 `tests/unit/markdown.test.ts`。
 */

/** 在视口中心双击建一张卡并进入编辑态 */
async function createNote(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await page.mouse.dblclick(640, 400);
  await expect(page.locator('.note.is-editing')).toHaveCount(1);
  await expect(page.locator('.note-editor')).toBeFocused();
}

test('输入 `- ` 触发无序列表，退出编辑后渲染成真实 li，刷新仍在', async ({ page }) => {
  await createNote(page);

  await page.keyboard.type('- 第一项');
  await page.keyboard.press('Enter');
  await page.keyboard.type('第二项');

  // 编辑态里就应该已经是列表项（input rule 生效），而不是等退出才转
  await expect(page.locator('.note-editor li')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(page.locator('.note-body li')).toHaveCount(2);
  await expect(page.locator('.note-body')).toContainText('第一项');
  await expect(page.locator('.note-body')).toContainText('第二项');

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.note-body li')).toHaveCount(2);
});

test('格式条：选中文字加粗，刷新后 strong 还在', async ({ page }) => {
  await createNote(page);
  await page.keyboard.type('重点');

  // 选中刚输入的两个字（光标在句尾）
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');

  await page.locator('.note-format-btn[data-fmt="bold"]').click();
  await expect(page.locator('.note-editor strong')).toHaveText('重点');

  await page.keyboard.press('Escape');
  await expect(page.locator('.note-body strong')).toHaveText('重点');

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.note-body strong')).toHaveText('重点');
});

test('格式条：链接输入框写入地址，渲染成可点的 a[href]', async ({ page }) => {
  await createNote(page);
  await page.keyboard.type('文档');

  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');

  await page.locator('.note-format-btn[data-fmt="link"]').click();
  const input = page.locator('.note-format-link input');
  await expect(input).toBeVisible();
  await input.fill('example.com/spec');
  await input.press('Enter');

  // 没写协议的要补 https://，否则会变成站内相对路径的死链
  await expect(page.locator('.note-editor a')).toHaveAttribute('href', 'https://example.com/spec');

  await page.keyboard.press('Escape');
  const link = page.locator('.note-body a');
  await expect(link).toHaveAttribute('href', 'https://example.com/spec');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('格式条只在编辑态出现，退出即隐藏', async ({ page }) => {
  await createNote(page);
  await expect(page.locator('.note-format')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.note-format')).toBeHidden();
  await expect(page.locator('.note-format')).toHaveCount(0);
});

test('列表末尾的空 item 在静息态也占一行（进出一编辑高度不变）', async ({ page }) => {
  await createNote(page);

  // 写到超过 --min-h(320px)：只有内容撑高时，"少一行"才看得出来
  for (let i = 1; i <= 12; i += 1) {
    await page.keyboard.type(`${i === 1 ? '1. ' : ''}项目 ${i}`);
    await page.keyboard.press('Enter');
  }
  // 最后一个 Enter 留下第 13 项：只有序号、没有正文 —— Safari 下空 `<li><p></p></li>` 会塌成 0 高
  const editingCard = await page.locator('.note.is-editing').boundingBox();
  const editingBody = await page.locator('.note-editor').boundingBox();

  await page.keyboard.press('Escape');
  await expect(page.locator('.note-editor')).toHaveCount(0);

  // 关键不变量（决策 68 / 70）：静息渲染必须和编辑态同高，序号不能溢出到卡片底边
  const restingCard = await page.locator('.note').boundingBox();
  const restingBody = await page.locator('.note-body').boundingBox();
  expect(restingBody!.height).toBeCloseTo(editingBody!.height, 0);
  expect(restingCard!.height).toBeCloseTo(editingCard!.height, 0);

  // 空 item 里要有 ProseMirror 同款的撑行 `<br>`，否则 WebKit 下这一项一行都没有
  await expect(page.locator('.note-body ol > li')).toHaveCount(13);
  await expect(page.locator('.note-body ol > li:last-child > p > br')).toHaveCount(1);
});
