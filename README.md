# 无限墙便签客户端（Static Infinite Sticky Wall）

纯静态、离线优先的无限画布便签应用。数据全部存在浏览器本地（IndexedDB 库 `sticky-wall`），没有服务端。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 生产构建
npm run preview    # 预览构建产物（http://127.0.0.1:4173/Sticky/）
npm run typecheck
npx vitest run     # 单元测试
npx playwright test # e2e（默认复用已启动的 preview）
```

## 部署

线上地址 <https://looly.top/Sticky/>，即 GitHub Pages 的**项目页**：站点不在域名根，而在 `/<仓库名>/` 子路径下。

产物里每个 URL 都必须带这个前缀，否则 `index.html` 会去域名根取 `/assets/*.js` → 404 → **整页空白**（决策 72）。
前缀的唯一真相是 `deploy-base.ts`，vite 的 `base`、PWA 的 `start_url`/`scope`/图标、workbox 的离线回退都由它派生：

```bash
npm run build                  # 默认 /Sticky/，本地与 CI 一致
PUBLIC_BASE=/ npm run build     # 换成域名根部署时才需要
PUBLIC_BASE=/foo/ npm run build # 换子路径
```

CI（`.github/workflows/deploy.yml`）里用 `PUBLIC_BASE=/${{ github.event.repository.name }}/` 构建，
所以**改仓库名不需要改代码**。

部署后自查一条命令就够 —— 看首页引用的脚本是不是落在子路径下、且真的能取到：

```bash
curl -s https://looly.top/Sticky/ | grep -o 'src="[^"]*\.js"'
curl -s -o /dev/null -w '%{http_code}\n' https://looly.top/Sticky/assets/<上面看到的文件名>
```

## 把本地数据清干净（回到新用户状态）

应用在 boot 时就会建连接，**在 DevTools 里删库会被写回**：连接被关掉、删除完成，但内存里的卡还在，
下一次写入又会把库重建起来。所以别在页面开着的时候删。

可靠做法是带参数打开一次（删除发生在任何连接建立之前）：

```
http://127.0.0.1:4173/Sticky/?reset=1
```

线上同理，换成 `https://looly.top/Sticky/?reset=1`。

它会删掉整个库、抹掉参数并重载，重载后就是完整的首访体验（含那张操作说明便签）。
如果有其它标签页或已安装的窗口还开着，删除会被挡住，页面会提示先关掉它们。

DevTools 的 `Application → Storage → Clear site data` 也能用，但同样要**清完立刻刷新**，别让页面停留。

## 许可

[MIT](./LICENSE) © 2026 Sticky Wall contributors。当前版本 **1.0.0**，显示在设置面板底部的「帮助」里。
