import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 单测配置**故意与 vite.config.ts 分开**：vitest 2 自带 vite 5，而应用用 vite 6，
 * 两套 `Plugin` 类型不兼容。分开之后单测也不会加载 PWA 插件（它要读 dist、生成 SW）。
 */
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // settings.ts 会用到构建期注入的版本号；单测里也得有个值
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
  },
});
