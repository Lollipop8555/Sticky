/**
 * 「复制为富文本」：把便签内容写成**标准 HTML**，粘到 Word / WPS / 飞书 / Notion 里保留排版。
 *
 * 为什么不是"复制 markdown 源码"：用户要的是"粘进办公软件"，那边认的是 HTML，
 * `**粗**` 粘过去就是四个星号。剪贴板能给两种东西 —— `text/html` 与 `text/plain`，
 * 办公软件优先读前者，纯文本编辑器读后者，两条都要写。
 *
 * 两个坑：
 * 1. **样式必须内联**：粘贴目标不会带我们的 CSS 走，`<strong>` 这类语义标签 Word 认，
 *    但段落间距、代码底色只能写成 `style`。
 * 2. **图片必须是 data URL**：卡上的图是 `blob:`，出了这个页面就是死链；
 *    出图那边有同样的问题（见 `assets/inline.ts`），共用一套内联逻辑。
 */

import { settleImages } from '@/assets/inline';
import { hydrateImages } from '@/assets/urls';
import { docToFragment, mdToDoc } from '@/note/markdown';

/** 外层容器：目标文档的默认字体五花八门，给一条和站内接近的字体栈 */
const WRAPPER_STYLE = [
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
  'font-size:15px',
  'line-height:1.6',
  'color:#1f2937',
].join(';');

/** 便签里会出现的标签 → 粘贴后该有的样子。没列到的只摘 class，不动样式 */
const TAG_STYLES: Record<string, string> = {
  p: 'margin:0 0 8px',
  ul: 'margin:0 0 8px;padding-left:24px',
  ol: 'margin:0 0 8px;padding-left:24px',
  li: 'margin:0 0 2px',
  strong: 'font-weight:600',
  em: 'font-style:italic',
  s: 'text-decoration:line-through',
  code: 'font-family:Consolas,Menlo,monospace;font-size:0.92em;background:#f1f3f5;padding:1px 4px;border-radius:3px',
  a: 'color:#1d4ed8;text-decoration:underline',
  img: 'max-width:100%;height:auto',
};

/**
 * 本应用内部才认识的东西（`note-img` 的块级与圆角、`data-asset` 的懒加载标记、
 * ProseMirror 的占位类）一律摘掉：目标文档不认识它们，留着只是垃圾属性。
 */
function inlineStyles(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const tag = el.tagName.toLowerCase();
    el.removeAttribute('class');

    if (tag === 'img') {
      el.removeAttribute('draggable');
      el.removeAttribute('loading');
      el.removeAttribute('decoding');
      el.removeAttribute('data-src');
      // 资产缺失（图被 GC / 跨设备缺文件）：没 src 的 img 粘过去是个空框，不如不要
      if (!el.hasAttribute('src')) {
        el.remove();
        continue;
      }
    }

    // 站内靠 target=_blank 防止同页跳转；粘到文档里这两个属性没有意义
    if (tag === 'a') {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    }

    const style = TAG_STYLES[tag];
    if (style) el.style.cssText = style;
  }
}

/** 便签 md → `{ html, text }`。图片先等 hydrate + 解码，再摊成 data URL */
export async function noteRichContent(md: string): Promise<{ html: string; text: string }> {
  const body = document.createElement('div');
  body.append(docToFragment(mdToDoc(md)));
  hydrateImages(body);

  /*
   * 必须进文档：`img.decode()` 要等布局，`innerText` 更是直接依赖渲染结果
   * （游离节点上它退化成 textContent，换行全丢）。放到屏幕外而不是 display:none，
   * 后者会让布局不发生，innerText 一样拿不到换行。
   */
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;';
  holder.append(body);
  document.body.append(holder);

  try {
    // 这里比出图更等不起：用户在等 toast。资产缺失时最多等 1.5s 就带着缺图往下走
    await settleImages(body, 1500);
    inlineStyles(body);
    return {
      html: `<div style="${WRAPPER_STYLE}">${body.innerHTML}</div>`,
      text: body.innerText.trim(),
    };
  } finally {
    holder.remove();
  }
}

export type CopyOutcome = 'rich' | 'plain' | 'empty' | 'failed';

/**
 * 写进剪贴板。`ClipboardItem` 的值可以是 Promise —— 图片转 data URL 要几十上百毫秒，
 * 不这么做就会在手势过期之后才调 `write()`，直接被拒（和 `copyPngWhenReady` 同一个理由）。
 */
export async function copyNoteText(md: string): Promise<CopyOutcome> {
  if (md.trim() === '') return 'empty';

  const pending = noteRichContent(md);
  pending.catch(() => undefined);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': pending.then((rich) => new Blob([rich.html], { type: 'text/html' })),
          'text/plain': pending.then((rich) => new Blob([rich.text], { type: 'text/plain' })),
        }),
      ]);
      return 'rich';
    } catch (error) {
      // 浏览器不支持 HTML 剪贴板 / 权限被拒：退到纯文本，至少文字能带走
      console.warn('[clipboard] 富文本复制失败，降级为纯文本', error);
    }
  }

  try {
    const { text } = await pending;
    await navigator.clipboard.writeText(text);
    return 'plain';
  } catch (error) {
    console.error('[clipboard] 复制文本失败', error);
    return 'failed';
  }
}
