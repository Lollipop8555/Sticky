import type { Page } from '@playwright/test';

/**
 * 性能探针：只从页面里读 DOM 与 Performance API，**不给应用加任何调试钩子**。
 * 埋点会改变被测物（多一层回调、多一次闭包保留），而基线要能对着线上构建说事。
 *
 * 必须在 `page.goto` 之前 `addInitScript`，否则启动阶段的帧与 FCP 采不到。
 */
export interface FrameStats {
  samples: number;
  p50: number;
  p95: number;
  worst: number;
  fps: number;
  /** 单帧超过 32ms（两个 60Hz 周期）的次数 */
  jank: number;
}

export interface BootMetrics {
  fcpMs: number | null;
  bootedMs: number | null;
  /** 第一张卡进 DOM 的时刻 —— 用户真正"看见墙"的那一刻，比 FCP 有意义 */
  notesMs: number | null;
  longTasks: number;
  blockingMs: number;
}

declare global {
  interface Window {
    __perf: {
      boot: { bootedMs: number | null; notesMs: number | null; fcpMs: number | null };
      start(): void;
      stop(): { frames: number[]; loaf: { start: number; duration: number }[]; longTasks: { start: number; duration: number }[] };
      bootLongTasks(): { start: number; duration: number }[];
      memoryMB(): number | null;
      gc(): void;
    };
  }
}

export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const boot: { bootedMs: number | null; notesMs: number | null; fcpMs: number | null } = {
      bootedMs: null,
      notesMs: null,
      fcpMs: null,
    };
    const frames: number[] = [];
    const longTasks: { start: number; duration: number }[] = [];
    let recording = false;

    // 帧间隔 = 相邻两次 rAF 的差。掉帧在这里就是一个大值，不需要任何额外埋点
    const tick = (now: number): void => {
      if (recording) frames.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      // 不支持 longtask 的浏览器：这一项留空，不影响其余指标
    }

    /*
     * LoAF（long-animation-frame）：单帧真正的耗时（脚本 + 样式 + 布局 + 绘制），
     * 上限是 16.7ms。为什么非要有它：rAF 时间戳被对齐到 vsync，只要没超过 16.7ms
     * 报出来都是 16.7 —— 掉帧看得出，**"还有多少余量"看不出**。实测 p50 16.7 / worst 16.8
     * 这种"完美"数字，没有 LoAF 就无法区分"每帧花 1ms"和"每帧花 15ms"。
     */
    const loaf: { start: number; duration: number }[] = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) loaf.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'long-animation-frame', durationThreshold: 16 } as PerformanceObserverInit);
    } catch {
      // Chromium < 123 没有 LoAF：这一项留空
    }

    // 每帧查三个信号，比在应用里插 MutationObserver 干净。
    // FCP 也在帧里取：页面很小，`load` 可能**早于首次绘制**（实测 load@8ms、FCP@28ms），
    // 挂在 load 上会稳定拿到 null。
    let attempts = 0;
    const watch = (): void => {
      const app = document.querySelector('#app');
      if (boot.bootedMs === null && app?.getAttribute('data-booted') === 'true') boot.bootedMs = performance.now();
      if (boot.notesMs === null && (document.querySelector('#note-layer')?.childElementCount ?? 0) > 0) {
        boot.notesMs = performance.now();
      }
      if (boot.fcpMs === null) {
        boot.fcpMs = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null;
      }
      attempts += 1;
      const done = boot.bootedMs !== null && boot.notesMs !== null && boot.fcpMs !== null;
      if (!done && attempts < 900) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);

    window.__perf = {
      boot,
      start() {
        frames.length = 0;
        loaf.length = 0;
        longTasks.length = 0;
        recording = true;
      },
      stop() {
        recording = false;
        return { frames: [...frames], loaf: [...loaf], longTasks: [...longTasks] };
      },
      bootLongTasks() {
        const until = boot.bootedMs ?? Number.POSITIVE_INFINITY;
        return longTasks.filter((t) => t.start <= until);
      },
      memoryMB() {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
      },
      gc() {
        (window as unknown as { gc?: () => void }).gc?.();
      },
    };
  });
}

/** 帧时间戳 → 统计量。丢掉前两帧：start() 与首个 rAF 之间那段空窗不是真实帧间隔 */
export function summarize(frames: number[]): FrameStats {
  const deltas = frames.slice(2).map((t, i) => t - (frames[i + 1] ?? t)).filter((d) => d > 0);
  if (deltas.length === 0) return { samples: 0, p50: 0, p95: 0, worst: 0, fps: 0, jank: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const p50 = at(0.5);
  return {
    samples: deltas.length,
    p50,
    p95: at(0.95),
    worst: sorted[sorted.length - 1] ?? 0,
    fps: p50 > 0 ? 1000 / p50 : 0,
    jank: deltas.filter((d) => d > 32).length,
  };
}

export async function readBoot(page: Page): Promise<BootMetrics> {
  return page.evaluate(() => {
    const { boot, bootLongTasks } = window.__perf;
    const tasks = bootLongTasks();
    return {
      fcpMs: boot.fcpMs,
      bootedMs: boot.bootedMs,
      notesMs: boot.notesMs,
      longTasks: tasks.length,
      blockingMs: tasks.reduce((sum, t) => sum + t.duration, 0),
    };
  });
}

/** 堆用量（需要 `--enable-precise-memory-info`）。先 gc 再读，否则测的是垃圾的峰值 */
export async function readHeapMB(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    window.__perf.gc();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return window.__perf.memoryMB();
  });
}

/** 把一批数字打成人能读的一行，报告直接来自它 */
export function describeFrames(stats: FrameStats): string {
  return `p50 ${stats.p50.toFixed(1)}ms / p95 ${stats.p95.toFixed(1)}ms / worst ${stats.worst.toFixed(1)}ms / ${stats.fps.toFixed(0)}fps / 掉帧 ${stats.jank}/${stats.samples}`;
}

/** 单帧实际耗时（LoAF）。没有条目就是整个窗口每一帧都低于 16ms，那是好消息 */
export function describeLoaf(loaf: { duration: number }[]): string {
  if (loaf.length === 0) return '没有超过 16ms 的帧';
  const durations = loaf.map((e) => e.duration).sort((a, b) => a - b);
  const at = (p: number): number => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] ?? 0;
  return `超 16ms 的帧 ${loaf.length} 个 / p95 ${at(0.95).toFixed(1)}ms / max ${(durations[durations.length - 1] ?? 0).toFixed(1)}ms`;
}
