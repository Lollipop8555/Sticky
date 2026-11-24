/**
 * 图片入库前的压缩（`io-persistence §1.3`）：最长边 2400、体积上限 800KB。
 *
 * 为什么必须在**入库前**压：IDB 里存的是 Blob，存进去之后再压就要读写两遍。
 * 而且浏览器配额是按压缩后的体积算的，这一步直接决定用户能存多少张图。
 *
 * 两个例外原样入库：
 * - gif：过 canvas 就只剩第一帧，等于把动图毁了
 * - svg：矢量图转位图是降级；而且 svg 里可能带脚本，我们后面按 `<img>` 加载（不解析）即可
 */

export interface CompressedImage {
  blob: Blob;
  mime: string;
  /** 小写、不带点。`assets/<id>.<ext>` 里的扩展名就是它 */
  ext: string;
  /** 像素尺寸（svg 可能拿不到，给 0） */
  w: number;
  h: number;
}

const MAX_EDGE = 2400;
const MAX_BYTES = 800 * 1024;
const WEBP_QUALITY = 0.85;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function extOf(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

async function readSize(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // 拿不到尺寸不该阻断入库（少见：某些 svg 没有 intrinsic size）
    return { w: 0, h: 0 };
  }
}

function drawToBlob(
  source: ImageBitmap,
  w: number,
  h: number,
  mime: string,
  quality?: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  // 缩小用高质量插值：默认的 low 在文字截图上一眼能看出锯齿
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

/**
 * 压缩一张图。**不会抛错**：实在处理不了（损坏的图/不支持的格式）就原样返回，
 * 让用户至少能看到"插入失败"之外的结果 —— 入库一张原图，比把内容整段吞掉好。
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const fallback: CompressedImage = {
    blob: file,
    mime: file.type || 'application/octet-stream',
    ext: extOf(file.type),
    w: 0,
    h: 0,
  };

  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return { ...fallback, ...(await readSize(file)) };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fallback;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    let w = Math.max(1, Math.round(bitmap.width * scale));
    let h = Math.max(1, Math.round(bitmap.height * scale));
    const resized = scale < 1;
    const tooBig = file.size > MAX_BYTES;

    if (!resized && !tooBig) {
      return { blob: file, mime: file.type, ext: extOf(file.type), w, h };
    }

    // 质量阶梯：单靠 q=0.85 压不到 800KB 的内容是真实存在的（噪声、截图里的颗粒），
    // 与其让它超限入库，不如逐级降质 —— 用户看到的是"略糊"，不是"配额被一张图吃掉"。
    const QUALITIES = [WEBP_QUALITY, 0.75, 0.65, 0.55];
    let blob: Blob | null = null;
    for (const quality of QUALITIES) {
      // WebP 不支持时 toBlob 会回落成 PNG（blob.type 会告诉我们）
      blob = await drawToBlob(bitmap, w, h, 'image/webp', quality);
      if (!blob || blob.size <= MAX_BYTES) break;
    }

    // 降到底还超：按体积比缩边，最多 4 轮。ratio < 1 保证每轮都在收敛
    for (let round = 0; blob && blob.size > MAX_BYTES && round < 4; round++) {
      const ratio = Math.sqrt(MAX_BYTES / blob.size) * 0.95;
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
      blob = (await drawToBlob(bitmap, w, h, 'image/webp', 0.7)) ?? blob;
    }

    const best = blob ?? file;
    return { blob: best, mime: best.type || file.type, ext: extOf(best.type || file.type), w, h };
  } finally {
    bitmap.close();
  }
}
