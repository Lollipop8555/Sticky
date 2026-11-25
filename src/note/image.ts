/**
 * 图片节点。
 *
 * 两处都不能用 Tiptap 的默认 `renderHTML`：
 * 1. 站内资产：`src` 里是 `assets/<id>.<ext>`，直接给浏览器会去请求这个不存在的路径（404）。
 *    改成 `data-asset`，由 `hydrateImages` 换成 blob URL。
 * 2. 外链图片：CSP 是 `img-src 'self' blob: data:`，https 图片本来就加载不出来。
 *    与其显示一个裂图，不如明说"外链图片（未加载）" —— 也顺便不向第三方泄露"谁在什么时候看了这张卡"。
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import BaseImage from '@tiptap/extension-image';

import { applyImageSrc, isAssetSrc } from '@/assets/urls';
import { t } from '@/i18n';

function externalPlaceholder(src: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'note-img-ext';
  // 现取而不是模块常量：占位符是渲染时创建的，切完语言新渲染的卡片就该是新语言
  span.textContent = t('img.external');
  span.title = src;
  return span;
}

export const NoteImage = BaseImage.extend({
  addNodeView() {
    return ({ node }) => {
      const src = String(node.attrs['src'] ?? '');

      if (!isAssetSrc(src)) {
        return { dom: externalPlaceholder(src) };
      }

      const img = document.createElement('img');
      img.className = 'note-img';
      img.loading = 'lazy';
      img.decoding = 'async';
      if (node.attrs['alt']) img.alt = String(node.attrs['alt']);
      applyImageSrc(img, src);

      return {
        dom: img,
        update: (next: PMNode) => {
          if (next.type.name !== node.type.name) return false;
          const nextSrc = String(next.attrs['src'] ?? '');
          if (!isAssetSrc(nextSrc)) return false;
          img.alt = next.attrs['alt'] ? String(next.attrs['alt']) : '';
          applyImageSrc(img, nextSrc);
          return true;
        },
      };
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = String(node.attrs['src'] ?? '');

    if (!isAssetSrc(src)) {
      return ['span', { class: 'note-img-ext', title: src }, t('img.external')];
    }

    // parent 的 renderHTML 已经把 src 塞进 HTMLAttributes，这里换成 data-asset
    const { src: _canonical, ...rest } = HTMLAttributes as Record<string, unknown>;
    return [
      'img',
      {
        ...rest,
        'data-asset': src,
        // 换成 blob URL 之后 canonical 路径就没了，而大图预览 / 出图都要按 canonical 回查资产，
        // 所以另留一份 data-src（hydrate 只摘 data-asset，不动它）
        'data-src': src,
        class: 'note-img',
        loading: 'lazy',
        decoding: 'async',
        // 静息态的图不可原生拖拽：拖出去松手会被画布的 drop 当成本地图片，多建一张卡
        draggable: 'false',
      },
    ];
  },
});
