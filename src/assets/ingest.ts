/**
 * 把一张粘贴/拖入的图片变成可以写进 markdown 的 `assets/<id>.<ext>`。
 *
 * 资产**直接写 IDB**，不走写队列：图片一旦落库就不再变（没有"拖动一张图"这种操作），
 * 排队反而会让 md 先于 blob 落库 —— 那一瞬间刷新就看到裂图。
 * 顺序反过来（先 blob 后 md）最差只是留下一个孤儿资产，由 GC 收走。
 */

import { t } from '@/i18n';
import { repo } from '@/storage/repo';
import type { AssetRecord } from '@/storage/types';

import { compressImage } from './compress';

/** 单张图的体积上限（压缩后仍然超）——超过就拒绝，别把配额一次吃光 */
const HARD_LIMIT = 12 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(bytes: number) {
    // 现取文案：这个 message 可能被编辑器的兜底 toast 直接显示出去
    super(t('file.imageTooLarge', { kb: Math.round(bytes / 1024) }));
    this.name = 'ImageTooLargeError';
  }
}

export interface IngestedImage {
  /** 写进 markdown 的 canonical 路径 */
  src: string;
  /** 压缩后的像素尺寸：图片便签靠它算初始高度 */
  w: number;
  h: number;
}

export async function ingestImageFile(file: File): Promise<IngestedImage> {
  const compressed = await compressImage(file);
  if (compressed.blob.size > HARD_LIMIT) throw new ImageTooLargeError(compressed.blob.size);

  const id = crypto.randomUUID();
  const record: AssetRecord = {
    id,
    mime: compressed.mime,
    ext: compressed.ext,
    blob: compressed.blob,
    w: compressed.w,
    h: compressed.h,
    createdAt: Date.now(),
  };

  await repo.putAssets([record]);
  return { src: `assets/${id}.${compressed.ext}`, w: compressed.w, h: compressed.h };
}

export async function ingestImage(file: File): Promise<string> {
  return (await ingestImageFile(file)).src;
}
