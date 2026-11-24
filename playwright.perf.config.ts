import { defineConfig, devices } from '@playwright/test';

/**
 * 性能基线**单独一档配置**，理由与 vitest.config.ts 同源：
 * - 它要跑 3~4 分钟（500 张卡 × 4 个用例），塞进 `npm run e2e` 会把日常反馈拖慢一个数量级；
 * - 它需要 `--enable-precise-memory-info`（否则 `performance.memory` 是量化过的粗值）
 *   与 `--expose-gc`（先回收再读，否则测的是垃圾峰值），这些开关对功能测试只有副作用；
 * - 一个进程跑全部：并发会让帧时间互相污染，测出来的 p95 是"抢 CPU"的结果而不是渲染成本。
 */
const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 单个用例要铺 500 张卡 + 造 20 张 WebP，90s 起步
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 与 e2e 同一个桌面尺寸，数字才对得上
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    // 与 e2e 的 4173 错开端口：两个配置可以同时开着而不抢服务
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
