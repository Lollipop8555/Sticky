/// <reference types="vite-plugin-pwa/client" />

/**
 * 构建期注入的常量（见 vite.config.ts 的 define）。
 * 不直接 import package.json：那会把整个清单打进产物，而且暴露依赖列表。
 */
declare const __APP_VERSION__: string;
