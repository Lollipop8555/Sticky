/**
 * 生成 PWA 图标（PNG）。图标是二进制产物，必须提交；这个脚本只是为了"以后改设计还能重出"。
 *
 * 用 Playwright 渲染而不是手搓 canvas：图标要的圆角、旋转、阴影、字体度量，
 * 浏览器里写三行 CSS 就准了，canvas 里要手算一堆三角函数。
 *
 * 用法：node scripts/gen-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));

/**
 * @param {number} size 画布边长
 * @param {number} inset 内容占比（maskable 要留安全区：内容只占 60%）
 */
function html(size, inset) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; overflow: hidden; }
  body {
    display: grid;
    place-items: center;
    background: linear-gradient(160deg, #faf7f1 0%, #f1ebe0 100%);
  }
  .note {
    width: ${Math.round(size * inset)}px;
    height: ${Math.round(size * inset)}px;
    border-radius: ${Math.round(size * inset * 0.1)}px;
    background: #f9d5e5;
    box-shadow: 0 ${Math.round(size * 0.03)}px ${Math.round(size * 0.06)}px rgb(80 52 34 / 22%);
    transform: rotate(-6deg);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: ${Math.round(size * inset * 0.11)}px;
    padding: 0 ${Math.round(size * inset * 0.16)}px;
  }
  .line {
    height: ${Math.max(2, Math.round(size * inset * 0.055))}px;
    border-radius: 999px;
    background: #8a6b78;
    opacity: 0.55;
  }
  .line:nth-child(2) { width: 68%; }
</style></head>
<body>
  <div class="note">
    <div class="line"></div>
    <div class="line"></div>
  </div>
</body></html>`;
}

/** @type {{ file: string; size: number; inset: number }[]} */
const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0.66 },
  { file: 'icon-512.png', size: 512, inset: 0.66 },
  // maskable：四角会被系统裁掉，内容压到中间 60%
  { file: 'maskable-512.png', size: 512, inset: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.66 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const { file, size, inset } of TARGETS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size, inset));
  const shot = await page.screenshot({ type: 'png' });
  await writeFile(`${OUT}${file}`, shot);
  await page.close();
  console.log(`${file}  ${size}x${size}  ${(shot.length / 1024).toFixed(1)}KB`);
}

await browser.close();
