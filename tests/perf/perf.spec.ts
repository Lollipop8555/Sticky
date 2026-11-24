import { expect, test, type Page } from '@playwright/test';

import { describeFrames, describeLoaf, installProbe, readBoot, readHeapMB, summarize } from './probe';
import { drivePan, driveZoom, readMount, seedWall } from './wall';

/**
 * 性能基线（roadmap M0 验收 + tech-design §2 的上限）。
 *
 * 预算不是"跑得动"的底线，而是**回归网**：数字变差一倍以上一定要有人看见。
 * 阈值都按实测留了 3~4 倍裕量（CI 机器比开发机慢一档），但每次运行都把实测值打出来 ——
 * 看绝对值比看红绿更能发现"还没超标但在变差"。
 *
 * 两套帧指标缺一不可：
 * - rAF 帧间隔：只反映**掉了多少帧**（没超过 16.7ms 一律报 16.7）；
 * - LoAF 单帧耗时：反映**还剩多少余量**（1ms 还是 15ms）。
 */
const BUDGET = {
  /** 首次内容绘制（HTML/CSS 先画出来，与便签无关）—— roadmap 的"首屏 <300ms" */
  fcpMs: 300,
  /** 第一张卡进 DOM："墙出现了" */
  notesMs: 600,
  /** boot 全流程走完 */
  bootedMs: 800,
  /** 平移：中位帧 ≤ 20ms（超过就说明一半以上的帧在掉） */
  panP50: 20,
  panP95: 40,
  /** 最差单帧：一次 GC 抖 100ms 不算回归，但半秒的冻结要拦 */
  panWorst: 160,
  /** 平移期单帧实际耗时（LoAF）的上限：60fps 的预算是 16.7ms，留一帧给合成 */
  panFrameWorkMs: 34,
  zoomP95: 40,
  zoomFrameWorkMs: 40,
  /** 500 卡 + 20 图常驻堆（产品上限 150MB） */
  heapMB: 150,
  /** 1280×800 下的挂载上限：可见带内约 25~45 张，留 3 倍余量 */
  mountedMax: 120,
};

/** 先让页面把库建好，再塞 500 张，然后重载 —— 被测的是"带着 500 张启动" */
async function bootWall(page: Page, seed: { count?: number; images?: number } = {}): Promise<void> {
  await installProbe(page);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');

  await seedWall(page, seed);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-booted', 'true');
  await expect(page.locator('#app')).toHaveAttribute('data-notes', String(seed.count ?? 500));
}

function annotate(name: string, value: string): void {
  test.info().annotations.push({ type: name, description: value });
  console.log(`  · ${name}: ${value}`);
}

test('首屏：500 张卡 + 20 张图，FCP / 墙出现 / boot 完成都在预算内', async ({ page }) => {
  await bootWall(page);
  // booted 之后 FCP 条目还要一两帧才进 buffer（probe 每帧尝试填充）
  await expect.poll(async () => (await readBoot(page)).fcpMs, { timeout: 5000 }).not.toBeNull();

  const boot = await readBoot(page);
  const heap = await readHeapMB(page);
  const mount = await readMount(page);

  annotate('FCP', `${boot.fcpMs?.toFixed(0)}ms`);
  annotate('首卡可见', `${boot.notesMs?.toFixed(0)}ms`);
  annotate('boot 完成', `${boot.bootedMs?.toFixed(0)}ms`);
  annotate('启动期长任务', `${boot.longTasks} 个 / 共阻塞 ${boot.blockingMs.toFixed(0)}ms`);
  annotate('挂载 / 总数', `${mount.mounted} / ${mount.total}`);
  annotate('堆用量', `${heap?.toFixed(1)}MB`);

  expect(boot.fcpMs).not.toBeNull();
  expect(boot.fcpMs).toBeLessThan(BUDGET.fcpMs);
  expect(boot.notesMs).toBeLessThan(BUDGET.notesMs);
  expect(boot.bootedMs).toBeLessThan(BUDGET.bootedMs);

  // 剔除真的在工作：500 张不可能全挂
  expect(mount.mounted).toBeLessThan(BUDGET.mountedMax);
  expect(mount.mounted).toBeGreaterThan(0);
  expect(heap).toBeLessThan(BUDGET.heapMB);
});

test('平移：500 张连拖，帧时间不塌方，剔除全程不失控', async ({ page }) => {
  await bootWall(page);
  await page.waitForTimeout(300); // 让启动期的高度校正跑完，别混进平移样本

  const before = await page.evaluate(() => document.querySelector('#world')?.getAttribute('style') ?? '');

  await page.evaluate(() => window.__perf.start());
  await drivePan(page, { steps: 120 });
  const { frames, loaf } = await page.evaluate(() => window.__perf.stop());
  const stats = summarize(frames);
  const mount = await readMount(page);
  const after = await page.evaluate(() => document.querySelector('#world')?.getAttribute('style') ?? '');

  annotate('平移帧间隔', describeFrames(stats));
  annotate('平移单帧耗时', describeLoaf(loaf));
  annotate('平移后挂载', `${mount.mounted} / ${mount.total}`);

  // 先证明"真的动了、真的还有卡"：这条断言是补上的 —— 早期版本往负方向拖，
  // 结果画布外没有任何卡，测出来的"完美 60fps"其实是空画布
  expect(after).not.toBe(before);
  expect(mount.mounted).toBeGreaterThan(0);

  expect(stats.samples).toBeGreaterThan(60);
  expect(stats.p50).toBeLessThan(BUDGET.panP50);
  expect(stats.p95).toBeLessThan(BUDGET.panP95);
  expect(stats.worst).toBeLessThan(BUDGET.panWorst);
  // 平移中挂载量必须仍然有界：一旦剔除在移动中失效，这里会先炸
  expect(mount.mounted).toBeLessThan(BUDGET.mountedMax);

  const worstWork = loaf.reduce((max, entry) => Math.max(max, entry.duration), 0);
  expect(worstWork).toBeLessThan(BUDGET.panFrameWorkMs);
});

test('缩放：跨 LOD 三档来回，帧时间可控且档位真的切过', async ({ page }) => {
  await bootWall(page);
  await page.waitForTimeout(300);

  await page.evaluate(() => window.__perf.start());
  const { levels, maxMounted } = await driveZoom(page, 120);
  const { frames, loaf } = await page.evaluate(() => window.__perf.stop());
  const stats = summarize(frames);

  annotate('缩放帧间隔', describeFrames(stats));
  annotate('缩放单帧耗时', describeLoaf(loaf));
  annotate('经过的 LOD 档位', levels.join(' → '));
  annotate('峰值挂载', `${maxMounted} / 500`);

  expect(stats.samples).toBeGreaterThan(60);
  expect(stats.p95).toBeLessThan(BUDGET.zoomP95);
  // 1=TEXT / 2=BLOCK / 3=CLUSTER：三个都出现过才说明这条路径被真的走到了
  expect(levels).toEqual(expect.arrayContaining(['1', '2', '3']));
  // 缩到 CLUSTER 时可见矩形覆盖整面墙，500 个节点必须同时挂着 —— 这是最坏情形，
  // 若它一直很小，说明剔除没有按预期放开，本用例其实没压到 500 节点
  expect(maxMounted).toBeGreaterThan(300);

  const worstWork = loaf.reduce((max, entry) => Math.max(max, entry.duration), 0);
  expect(worstWork).toBeLessThan(BUDGET.zoomFrameWorkMs);
});

test('内存：静止与平移之后堆用量都受控（< 150MB）', async ({ page }) => {
  await bootWall(page);

  const idle = await readHeapMB(page);
  await drivePan(page, { steps: 90 });
  const afterPan = await readHeapMB(page);

  annotate('静止堆', `${idle?.toFixed(1)}MB`);
  annotate('平移后堆', `${afterPan?.toFixed(1)}MB`);

  expect(idle).not.toBeNull();
  expect(idle).toBeLessThan(BUDGET.heapMB);
  expect(afterPan).toBeLessThan(BUDGET.heapMB);
});
