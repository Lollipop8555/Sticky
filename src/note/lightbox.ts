/**
 * 图片大图预览（interaction-spec §7.1）：非编辑态单击卡内图片打开。
 *
 * 三条纪律：
 * 1. **自己建 blob URL**，不用 `assets/urls.ts` 的共享缓存 —— 那份缓存只到页面卸载才 revoke，
 *    预览关掉时如果去 revoke 它，墙上那张卡会瞬间变成裂图。这里开一个、关一个，互不干扰。
 * 2. 用原生 `<dialog>`：焦点陷阱、Esc、顶层渲染、背景 inert 全是浏览器送的，
 *    自己拿 div 拼一遍就会漏掉其中一两样（尤其是 Esc 与焦点）。
 * 3. 缩放/pans 全部落在图自己的 transform 上，对话框本身不动 —— 好看，也好在 e2e 里断言。
 */

import { repo } from '@/storage/repo';
import { assetIdOf } from '@/assets/urls';

const MAX_SCALE = 8;
/** 按下与松开差这么多就算拖动过，不再当成"点背景关闭" */
const CLICK_SLOP = 4;

let showing = false;

/**
 * @param canonicalSrc `assets/<id>.<ext>`（**不是** blob URL）—— 记录里只存 canonical，
 *   由这里自己换成一个只活在预览期间的 blob URL。
 */
export function openLightbox(canonicalSrc: string, alt = ''): void {
  const id = assetIdOf(canonicalSrc);
  if (!id || showing) return;
  showing = true;
  void show(id, alt).catch((error: unknown) => {
    console.error('[lightbox] 打开失败', error);
    showing = false;
  });
}

async function show(id: string, alt: string): Promise<void> {
  const asset = await repo.getAsset(id);
  if (!asset?.blob) {
    // 资产被 GC / 跨设备没同步过来：安静地不开，别弹一个空框
    showing = false;
    return;
  }

  const url = URL.createObjectURL(asset.blob);

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.dataset['lightbox'] = '';

  const img = document.createElement('img');
  img.className = 'lightbox-img';
  img.alt = alt;
  img.src = url;
  img.draggable = false;

  const hint = document.createElement('p');
  hint.className = 'lightbox-hint';
  hint.textContent = '滚轮缩放 · 拖动平移 · 双击 1:1 · Esc 关闭';

  dialog.append(img, hint);
  document.body.append(dialog);

  // ---- 视图状态：scale = 1 表示"适配屏幕"，它是基准，不是 1:1 ----
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const apply = (): void => {
    img.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${scale})`;
  };

  const reset = (): void => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  };

  /** 1:1 = 一个图片像素对屏幕一个 CSS 像素。基准是 fit 宽度，所以倍率要按自然宽度反推 */
  const oneToOne = (): number => {
    const base = img.offsetWidth > 0 ? img.offsetWidth : asset.w;
    return Math.min(MAX_SCALE, Math.max(1, asset.w / base));
  };

  let downAt: { x: number; y: number } | null = null;
  let dragFrom: { x: number; y: number } | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    downAt = { x: event.clientX, y: event.clientY };
    dragFrom = { x: event.clientX - tx, y: event.clientY - ty };
    dialog.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragFrom || !downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    if (moved < CLICK_SLOP) return; // 抖动不算拖动，避免手一抖图就偏
    tx = event.clientX - dragFrom.x;
    ty = event.clientY - dragFrom.y;
    apply();
  };

  const onPointerUp = (event: PointerEvent): void => {
    const moved = downAt ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) : 0;
    downAt = null;
    dragFrom = null;
    if (dialog.hasPointerCapture(event.pointerId)) dialog.releasePointerCapture(event.pointerId);
    // 点背景（不是图）且没拖动 → 关闭
    if (moved <= CLICK_SLOP && event.target === dialog) dialog.close();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    // 指针到对话框中心的位置：缩放要绕这个点，否则会"图往一边跑"
    const cx = event.clientX - rect.left - rect.width / 2;
    const cy = event.clientY - rect.top - rect.height / 2;
    const next = Math.min(MAX_SCALE, Math.max(1, scale * Math.exp(-event.deltaY * 0.0015)));
    if (next === scale) return;
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
    // 缩回适配大小时把平移清零：留下几像素偏移看起来像"没对齐"
    if (scale === 1) {
      tx = 0;
      ty = 0;
    }
    apply();
  };

  const onDblClick = (event: MouseEvent): void => {
    event.preventDefault();
    const target = oneToOne();
    if (scale > 1.01) {
      reset();
      return;
    }
    scale = target;
    tx = 0;
    ty = 0;
    apply();
  };

  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointermove', onPointerMove);
  dialog.addEventListener('pointerup', onPointerUp);
  dialog.addEventListener('wheel', onWheel, { passive: false });
  dialog.addEventListener('dblclick', onDblClick);

  dialog.addEventListener(
    'close',
    () => {
      // 这一句是"关一个、还一个"：预览期间自己开的 URL 只能在这里回收
      URL.revokeObjectURL(url);
      dialog.remove();
      showing = false;
    },
    { once: true },
  );

  apply();
  dialog.showModal();
}
