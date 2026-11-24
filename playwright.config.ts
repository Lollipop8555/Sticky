import { defineConfig, devices } from '@playwright/test';

import { RETURNING_STATE } from './tests/e2e/global-setup';
import { BASE_URL } from './tests/e2e/server';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  /**
   * 预置"已经用过"的库（示例便签已清、onboarded 已置真）。
   * 没有它，每个全新 context 都会走一遍首访流程，凭空多出一张欢迎便签。
   */
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: RETURNING_STATE,
    trace: 'on-first-retry',
    // 画布类应用的手势依赖真实视口尺寸，固定一个桌面尺寸避免 flaky
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
