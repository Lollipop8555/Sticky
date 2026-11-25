import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { DEPLOY_BASE } from './deploy-base';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
// 设置面板要显示版本号；从清单里读一次注入，而不是把整份 package.json 打进产物
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * PWA 壳（决策 17 / tech-design §5）。
 *
 * `injectRegister: null` 是关键：默认注入的是一段**内联** `<script>`，
 * 而本项目 CSP 是 `script-src 'self'`，内联脚本会被拦掉，SW 永远注册不上。
 * 改成在 `src/pwa.ts` 里 `import 'virtual:pwa-register'`，脚本走打包产物，CSP 放行。
 *
 * 单测走独立的 `vitest.config.ts`：vitest 2 自带一份 vite 5，与本项目的 vite 6
 * 类型不兼容，把两边塞进同一个 defineConfig 会得到一屏 "PluginOption 不能赋值"。
 */
export default defineConfig({
  // GitHub Pages 项目页部署在子路径（`https://looly.top/Sticky/`）：base 必须是
  // `/Sticky/`，否则 `index.html` 会去域名根取 `/assets/*.js` → 404 → 白屏（决策 72）。
  // 换路径用环境变量，不要改代码：`PUBLIC_BASE=/foo/ npm run build`。
  base: DEPLOY_BASE,
  resolve: {
    alias: { '@': srcDir },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '无限墙便签',
        short_name: '便签墙',
        description: '无限画布上的便签墙，数据只存在你自己的浏览器里。',
        lang: 'zh-CN',
        // 绝对路径，但要**跟着 base 走**（决策 72）：写成 '/' 时从主屏图标打开会跳到域名根，
        // 而根下没有这个应用 —— 用户看到的是一张白页
        start_url: DEPLOY_BASE,
        scope: DEPLOY_BASE,
        display: 'standalone',
        // manifest 里的主题色是静态的；切换材质只改 <meta name="theme-color">（tech-design §5）
        theme_color: '#F5F2EC',
        background_color: '#ffffff',
        // manifest 里的相对路径是相对 **manifest 自身**解析的，但装到主屏后图标请求会
        // 回到站点根 —— 子路径部署下必须显式带 base，否则装了也是白图标
        icons: [
          { src: `${DEPLOY_BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${DEPLOY_BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${DEPLOY_BASE}icons/maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 应用本体很小，全量预缓存；数据在 IDB 里，**不进缓存**
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        // 离线回退也要落在子路径里：`/index.html` 在子路径部署下指向的是**域名根**，
        // 而根下没有 app，离线打开就是白屏（决策 72）
        navigateFallback: `${DEPLOY_BASE}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
