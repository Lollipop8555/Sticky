/**
 * `assets/<id>.<ext>` ⇄ Blob URL。
 *
 * markdown 里只存 canonical 路径（`assets/<uuid>.<ext>`），**永远不存 blob URL**：
 * blob URL 的生命周期只到页面关闭，写进记录里下次打开全是死链。
 *
 * 解析是懒的：启动时不把所有图都读出来（几百张图会把首屏拖死），
 * 谁先渲染谁先加载，加载过的进 Map 复用。
 */

import { repo } from '@/storage/repo';

/**
 * id 允许 `[A-Za-z0-9_-]`：本应用生成的是 UUID（纯 hex），但**导入的第三方包**里可能是
 * 任意可读 id，导入时还会追加 `-1` 后缀。只认 hex 会让这些图导入后全是裂图。
 * 与 `importFlow.safeId()` 的清洗规则保持一致。
 */
const ASSET_SRC = /^assets\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/i;

const urls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function isAssetSrc(src: string): boolean {
  return src.startsWith('assets/');
}

/** `assets/<id>.<ext>` → `<id>`；不是资产路径就 null */
export function assetIdOf(src: string): string | null {
  return ASSET_SRC.exec(src)?.[1] ?? null;
}

export function cachedAssetUrl(src: string): string | undefined {
  const id = assetIdOf(src);
  return id ? urls.get(id) : undefined;
}

export async function resolveAssetUrl(src: string): Promise<string | null> {
  const id = assetIdOf(src);
  if (!id) return null;

  const cached = urls.get(id);
  if (cached) return cached;

  const running = inflight.get(id);
  if (running) return running;

  const task = (async () => {
    try {
      const asset = await repo.getAsset(id);
      if (!asset?.blob) {
        // 引用还在、资产没了（被 GC 或跨设备同步缺文件）：保留 canonical src，让 UI 显示占位
        return null;
      }
      const url = URL.createObjectURL(asset.blob);
      urls.set(id, url);
      return url;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, task);
  return task;
}

/** 给一个 `<img>` 补上真正能加载的地址。data-asset 是"待解析"标记，解析成功就摘掉 */
function hydrateOne(img: HTMLImageElement): void {
  const src = img.dataset['asset'];
  if (!src) return;

  const hit = cachedAssetUrl(src);
  if (hit) {
    img.src = hit;
    delete img.dataset['asset'];
    return;
  }

  void resolveAssetUrl(src).then((url) => {
    // 期间卡片可能已经被卸载、或换了内容：只认还是同一张图的情况
    if (!url || img.dataset['asset'] !== src) return;
    img.src = url;
    delete img.dataset['asset'];
  });
}

/** 渲染完一段 DOM 之后调用：把其中的资产图片换成 blob URL */
export function hydrateImages(root: ParentNode): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-asset]')) hydrateOne(img);
}

/** 编辑态 NodeView 用：直接给一个 img 定源 */
export function applyImageSrc(img: HTMLImageElement, src: string): void {
  if (isAssetSrc(src)) {
    img.removeAttribute('src');
    img.dataset['asset'] = src;
    hydrateOne(img);
    return;
  }
  // 外链图片：CSP 只允许 self/blob/data，本就加载不出来；这里不发起请求（等于不泄露访问行为）
  img.removeAttribute('src');
  img.removeAttribute('data-asset');
}

/**
 * 回收所有 blob URL。只在页面卸载时调用 —— 单张图换掉时不做，
 * 因为同一张图可能同时出现在编辑态和静息态。
 */
export function revokeAssetUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}
