# 无限墙便签客户端（Static Infinite Sticky Wall）

纯静态、离线优先的无限画布便签应用。数据全部存在浏览器本地（IndexedDB 库 `sticky-wall`），没有服务端。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 生产构建
npm run preview    # 预览构建产物（http://127.0.0.1:4173）
npm run typecheck
npx vitest run     # 单元测试
npx playwright test # e2e（默认复用已启动的 preview）
```

## 把本地数据清干净（回到新用户状态）

应用在 boot 时就会建连接，**在 DevTools 里删库会被写回**：连接被关掉、删除完成，但内存里的卡还在，
下一次写入又会把库重建起来。所以别在页面开着的时候删。

可靠做法是带参数打开一次（删除发生在任何连接建立之前）：

```
http://127.0.0.1:4173/?reset=1
```

它会删掉整个库、抹掉参数并重载，重载后就是完整的首访体验（含那张操作说明便签）。
如果有其它标签页或已安装的窗口还开着，删除会被挡住，页面会提示先关掉它们。

DevTools 的 `Application → Storage → Clear site data` 也能用，但同样要**清完立刻刷新**，别让页面停留。
