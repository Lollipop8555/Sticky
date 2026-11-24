import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  // 站点部署在域名根（决策 31）。改成项目页只需把这里换成 '/sticky-wall/'。
  base: '/',
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
        // 站点部署在域名根：用绝对值，不用 './'（否则 scope 判断会出错，impl-00 §8）
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // manifest 里的主题色是静态的；切换材质只改 <meta name="theme-color">（tech-design §5）
        theme_color: '#F5F2EC',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 应用本体很小，全量预缓存；数据在 IDB 里，**不进缓存**
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
