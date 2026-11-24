import type { Page } from '@playwright/test';

export interface SeedOptions {
  count?: number;
  images?: number;
}

/**
 * 铺一面 500 张的墙（25 列 × 20 行，列距 320 / 行距 240）。
 *
 * 图片是真的用 canvas 画出来再 `toBlob('image/webp')` 的：塞零字节 blob 会让解码成本变 0，
 * 首屏数字会很好看，但和用户粘 20 张照片不是一回事。
 */
export async function seedWall(page: Page, options: SeedOptions = {}): Promise<{ count: number; images: number }> {
  const count = options.count ?? 500;
  const images = Math.min(options.images ?? 20, count);

  await page.evaluate(
    async ({ count, images }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sticky-wall');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const assets: Record<string, unknown>[] = [];
      for (let i = 0; i < images; i += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d 不可用');
        const gradient = ctx.createLinearGradient(0, 0, 800, 600);
        gradient.addColorStop(0, `hsl(${(i * 37) % 360} 68% 62%)`);
        gradient.addColorStop(1, `hsl(${(i * 37 + 140) % 360} 62% 44%)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 800, 600);
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b as Blob), 'image/webp', 0.8);
        });
        assets.push({
          id: `a1b2c3d4-0000-4000-8000-00000000${String(i).padStart(4, '0')}`,
          mime: 'image/webp',
          ext: 'webp',
          blob,
          w: 800,
          h: 600,
          createdAt: 1,
        });
      }

      const notes: Record<string, unknown>[] = [];
      for (let i = 0; i < count; i += 1) {
        const withImage = i < assets.length ? assets[i] : null;
        notes.push({
          id: `perf-${String(i).padStart(4, '0')}`,
          x: (i % 25) * 320,
          y: Math.floor(i / 25) * 240,
          width: 260,
          height: withImage ? 320 : 184,
          minHeight: 160,
          z: i + 1,
          bgColor: ['#FCE7F3', '#E0F2FE', '#FEF9C3', '#DCFCE7'][i % 4],
          contentMd: withImage
            ? `图 ${i}\n\n![图](assets/${String(withImage['id'])}.webp)\n\n这张卡会强制解码一次 WebP。`
            : `第 ${i} 张便签：一条随手记的正文，用来撑开正常的两三行高度。`,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        });
      }

      const prefs: Record<string, unknown>[] = [
        {
          key: 'settings',
          value: {
            background: 'paper',
            palette: 'macaron',
            defaultNoteWidth: 260,
            baseFontSize: 16,
            wheelMode: 'pan',
            createMode: 'dblclick',
            mobileMode: false,
            // 预置成已问过：否则移动模式询问会插进测量窗口
            mobilePromptSeen: true,
          },
        },
        // 视野钉在 (0,0) 1×：每次跑的起点一样，两遍数字才有可比性
        { key: 'viewport', value: { panX: 0, panY: 0, scale: 1 } },
        { key: 'counters', value: { zCounter: count } },
      ];

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['prefs', 'notes', 'assets'], 'readwrite');
        for (const row of prefs) tx.objectStore('prefs').put(row);
        for (const record of notes) tx.objectStore('notes').put(record);
        for (const asset of assets) tx.objectStore('assets').put(asset);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
    },
    { count, images },
  );

  return { count, images };
}

export interface PanOptions {
  steps?: number;
  dx?: number;
  dy?: number;
}

/**
 * 页面内合成"按住空白拖动"，逐帧推进。
 *
 * 不走 `page.mouse.move()`：CDP 每次 move 往返 1~5ms，那样测的是传输延迟不是渲染管线。
 * 也不直接改 store：要测的是**整条链**（手势 → 视野 → transform → 剔除 → 挂载），
 * 跳过手势层等于把最贵的部分挖掉。
 *
 * 默认 dx/dy 为负：手指往左上拖 = 视野向右下走。往正方向拖会滑到负坐标区（那里没有卡），
 * 测出来的"很流畅"其实是空画布。
 */
export async function drivePan(page: Page, options: PanOptions = {}): Promise<void> {
  await page.evaluate(
    async ({ steps, dx, dy }) => {
      const target = document.querySelector('#viewport');
      if (!target) throw new Error('缺少 #viewport');
      const cx = Math.round(window.innerWidth / 2);
      const cy = Math.round(window.innerHeight / 2);
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      };
      const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

      target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: 0, buttons: 1, clientX: cx, clientY: cy }));
      for (let i = 1; i <= steps; i += 1) {
        await frame();
        target.dispatchEvent(
          new PointerEvent('pointermove', { ...base, buttons: 1, clientX: cx + dx * i, clientY: cy + dy * i }),
        );
      }
      target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: 0, buttons: 0, clientX: cx + dx * steps, clientY: cy + dy * steps }));
    },
    { steps: options.steps ?? 120, dx: options.dx ?? -18, dy: options.dy ?? -6 },
  );
}

/**
 * ctrl+wheel 逐帧缩放（触控板捏合同一条路径）。返回过程中出现过的 LOD 档位 ——
 * 顺带证明"跨档位"真的发生了，否则这个用例可能一直在 FULL 档里空转。
 *
 * 前半程缩小（`deltaY > 0` → `exp(-dy·k) < 1`，见 gestures.ts 的 K_PINCH），后半程放大回 1×：
 * 只有缩小才会穿过 TEXT / BLOCK / CLUSTER，放大永远停在 FULL。
 */
export async function driveZoom(page: Page, steps = 120): Promise<{ levels: string[]; maxMounted: number }> {
  return page.evaluate(async (steps) => {
    const target = document.querySelector('#viewport');
    const world = document.querySelector('#world');
    if (!target || !world) throw new Error('缺少 #viewport / #world');
    const cx = Math.round(window.innerWidth / 2);
    const cy = Math.round(window.innerHeight / 2);
    const seen = new Set<string>();
    let maxMounted = 0;
    const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

    for (let i = 0; i < steps; i += 1) {
      await frame();
      // 前半程缩小到约 0.115×（穿过 TEXT/BLOCK/CLUSTER），后半程放大回 1×
      const direction = i < steps / 2 ? 1 : -1;
      target.dispatchEvent(
        new WheelEvent('wheel', { deltaY: direction * 6, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }),
      );
      // 取样一帧之后的状态：缩放缩到 CLUSTER 时可见矩形大到把所有卡都框进来，
      // 挂载数会冲到 500 —— 这正是"500 个节点同时挂着还要逐帧重排"的最坏情形
      const lod = world.getAttribute('data-lod');
      if (lod !== null) seen.add(lod);
      maxMounted = Math.max(maxMounted, document.querySelectorAll('#note-layer [data-note-id]').length);
    }
    return { levels: [...seen].sort(), maxMounted };
  }, steps);
}

/** 当前挂载的卡片数与总卡片数（剔除是否真的在工作） */
export async function readMount(page: Page): Promise<{ mounted: number; total: string }> {
  return page.evaluate(() => ({
    mounted: document.querySelectorAll('#note-layer [data-note-id]').length,
    total: document.querySelector('#app')?.getAttribute('data-notes') ?? '?',
  }));
}
