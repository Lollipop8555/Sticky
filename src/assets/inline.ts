/**
 * 图片内联：把 `<img>` 上的 blob URL 摊成 data URL。
 *
 * 两处要用，两条路都卡在同一个前提上：
 * 1. **出图**（`io/png.ts`）：`modern-screenshot` 会把非 `data:` 的 `src` 用 `fetch()` 读回来内联，
 *    而页面 CSP 的 `connect-src 'self'` 不含 `blob:` —— 那次 fetch 被拒之后，库里只能把这张图
 *    静默丢掉，导出的 PNG 上就是一块空缺。
 * 2. **复制为富文本**（`io/richtext.ts`）：剪贴板只有把图片写成 data URL，Word / WPS 才拿得到像素；
 *    `blob:` 地址出了这个页面就是死链。
 *
 * 两条路都还有同一个先后问题：`renderNoteBody` 的 hydrate 是异步的（要读 IndexedDB），
 * 必须等它落定、图解码完，才能读 `naturalWidth` 去画 canvas。
 */

/** 等 hydrate + 解码的上限：超时就不等了，宁可少一张图也不要把导出卡死 */
const SETTLE_TIMEOUT_MS = 3000;

/** 把一张已解码的图摊到 canvas 上转成 data URL；转不出来就 null（调用方原样留着） */
export function toDataUrl(img: HTMLImageElement): string | null {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 大图（多半是照片）转 PNG 是几十 MB 的 data URL：铺白底转 JPEG，体积和内存都稳得多
  const lossless = width * height <= 1_200_000;
  if (!lossless) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  try {
    return lossless ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    // 同源 blob 不会污染画布，走到这里只可能是画布被浏览器关掉了
    return null;
  }
}

/** 把一段 DOM 里的 blob 图换成 data URL；换不出来的保持原样 */
export async function inlineImages(root: ParentNode): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>('img.note-img')];
  await Promise.all(
    images.map(async (img) => {
      if (!(img.currentSrc || img.src).startsWith('blob:')) return;
      const data = toDataUrl(img);
      if (!data) return;
      img.src = data;
      await img.decode?.().catch(() => undefined);
    }),
  );
}

/** 等图片就位（hydrate 落定 + 解码完成），然后把 blob URL 内联成 data URL */
export async function settleImages(
  root: ParentNode,
  timeoutMs = SETTLE_TIMEOUT_MS,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const images = [...root.querySelectorAll<HTMLImageElement>('img.note-img')];
    if (images.length === 0) return;
    const pending = images.filter((img) => !img.complete || img.naturalWidth === 0);
    const unresolved = root.querySelectorAll('img.note-img[data-asset]').length;
    if (pending.length === 0 && unresolved === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  // decode 再过一遍：complete 只代表数据到了，栅格化可能还没完成（快照会拿到空白）
  await Promise.all(
    [...root.querySelectorAll<HTMLImageElement>('img.note-img')].map((img) =>
      img.decode?.().catch(() => undefined),
    ),
  );
  await inlineImages(root);
}
