/**
 * 站点的部署基路径 —— 构建（vite）、PWA（manifest / sw）与 e2e 三处共用同一个值，
 * 免得各写一份又对不上。
 *
 * GitHub Pages **项目页**的地址形如 `https://<user>.github.io/<repo>/`
 * （本项目部署在 `https://looly.top/Sticky/`），因此产物里每个 URL 都必须带
 * `/Sticky/` 前缀。写死成 `/` 的后果不是"图标 404"这种小毛病，而是 `index.html`
 * 去域名根取 `/assets/index-*.js` → 404 → **整页空白**（决策 72）。
 *
 * 换路径不要改代码：`PUBLIC_BASE=/foo/ npm run build`；根部署用 `PUBLIC_BASE=/`。
 */
function normalize(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  // 根部署要的是单斜杠，不是 '//'
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

export const DEPLOY_BASE = normalize(process.env['PUBLIC_BASE'] ?? '/Sticky/');
