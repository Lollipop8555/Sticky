/** 下载与剪贴板的两个小工具：不依赖任何库，也不该被 png/zip 各自复制一遍 */

/**
 * @param blob `Promise<Blob>` 而不是 `Blob` 的原因见 `copyPngWhenReady`：
 *   复制要求"在用户手势里调用"，出图却要几百毫秒，只能把手势和结果解耦。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // 立刻 revoke 会把正在进行的下载掐断（Safari 尤其明显），给它 10 秒
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 把"还没生成完的 PNG"写进剪贴板。
 *
 * `ClipboardItem` 的值可以是 Promise —— 这是保住用户手势的唯一办法：
 * 出图要等图片解码、要跑一遍 DOM 快照，几百毫秒后 `navigator.clipboard.write`
 * 已经不在手势的有效期里了，会直接抛 NotAllowedError。
 */
export async function copyPngWhenReady(blob: Promise<Blob>): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (error) {
    // 权限被拒（Safari 需要用户菜单触发）/ 浏览器不支持图片剪贴板：交给下载兜底
    console.warn('[clipboard] 复制图片失败，降级为下载', error);
    return false;
  }
}

/** 文件名里不能出现的字符，顺便把换行与连续空格压掉 */
export function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned === '' ? fallback : cleaned;
}
