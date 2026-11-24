/**
 * Tiptap 生命周期。每次进编辑 `new Editor()`，退出 `destroy()`。
 *
 * 为什么不复用实例：`History` 插件记着上一张卡的步骤，复用时 Ctrl+Z 会撤回**上一张卡**
 * 的内容并写进当前卡 —— 这属于会丢数据的 bug，省下的那点创建开销不值得。
 *
 * IME：中文输入期间 PM 会连续触发 update，此时序列化出去的是半成品（拼音字母），
 * 既污染 `contentMd`，又让写队列多写一次。所以组字期间不回调，`compositionend` 再补一次。
 */

import History from '@tiptap/extension-history';
import { Editor } from '@tiptap/core';

import { ImageTooLargeError, ingestImage } from '@/assets/ingest';
import { t } from '@/i18n';
import { toast } from '@/ui/toast';

import { docToMd, mdToDoc, noteExtensions } from './markdown';

/** 卡内格式条能切换的格式。名字与 Tiptap 命令一一对应，别在两处翻译 */
export type FormatAction = 'bold' | 'italic' | 'strike' | 'code' | 'bulletList' | 'orderedList';

export interface FormatState {
  active: Record<FormatAction | 'link', boolean>;
  /** 当前选区的链接地址（没有就是 null），给格式条回填输入框 */
  href: string | null;
}

export interface EditorHandlers {
  /** 内容变化（已排除 IME 组字中间态） */
  onChange(md: string): void;
  /** 选区/格式变化。格式条靠它同步按钮的按下态 */
  onSelection?(state: FormatState): void;
}

export interface EditorHandle {
  getMd(): string;
  setMd(md: string): void;
  focusAt(clientX?: number, clientY?: number): void;
  formatState(): FormatState;
  toggle(action: FormatAction): void;
  /** `null` = 去掉链接 */
  setLink(href: string | null): void;
  destroy(): void;
}

const EDITOR_ATTR = 'data-note-editor';

/**
 * 用户输入的 `example.com` 当相对路径插入会变成 `assets/example.com` 一样的死链，
 * 而 `#tag`、`/path` 这类站内写法必须原样保留 —— 所以只给"看起来像域名"的补协议。
 */
function normalizeHref(raw: string): string {
  const href = raw.trim();
  if (href === '') return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href; // 已有协议（http: mailto: data: …）
  if (href.startsWith('/') || href.startsWith('#')) return href;
  if (href.startsWith('assets/')) return href; // 站内图片/附件
  return `https://${href}`;
}

export function mountEditor(el: HTMLElement, md: string, handlers: EditorHandlers): EditorHandle {
  let composing = false;

  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
    handlers.onChange(docToMd(editor.state.doc));
  };

  /**
   * 逐张入库再插入。串行是为了保住顺序 —— 并行时哪张先压完就先插，用户会看到图序被打乱。
   * 压缩是异步的，期间编辑器可能已经被销毁（用户按了 Esc），所以每次插入前都检查。
   */
  const insertImages = async (files: File[]): Promise<void> => {
    for (const file of files) {
      if (editor.isDestroyed) return;
      try {
        const src = await ingestImage(file);
        if (editor.isDestroyed) return;
        editor
          .chain()
          .focus()
          .setImage({ src, alt: file.name.replace(/\.[^.]+$/, '') })
          .run();
      } catch (error) {
        if (error instanceof ImageTooLargeError) toast(t('toast.imageTooLarge'));
        else toast(t('toast.imageInsertFailed'));
        console.warn('[editor] 图片入库失败', error);
      }
    }
  };

  const editor = new Editor({
    element: el,
    extensions: [...noteExtensions, History],
    content: mdToDoc(md).toJSON(),
    autofocus: false,
    editorProps: {
      attributes: { [EDITOR_ATTR]: '', class: 'note-editor' },
      // 编辑区内的 pointerdown 不该被画布手势接走（平移/长按），交给 PM
      handleDOMEvents: {
        pointerdown: () => false,
      },
      /**
       * 粘贴图片。**必须拦下来**：不拦的话 PM 会把剪贴板里那张图当成"无法识别的 HTML 片段"
       * 直接丢掉，用户看到的现象是"粘贴了但什么都没发生"。
       *
       * 只处理 files 里有 image/* 的粘贴；带图的富文本（Word/网页）里既有 HTML 也有图片，
       * 这种情况下走默认行为（保留文字），避免把整段 HTML 结构吞掉。
       */
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },

      /**
       * 往编辑中的便签里拖图 = 光标处插图（与粘贴同一条路径）。
       * `moved` 为 true 是**编辑器内部**拖动已有节点，不是从外面拖文件进来，不能拦。
       */
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (composing) return;
      handlers.onChange(docToMd(instance.state.doc));
    },
    // 每笔输入都会走一次；格式条自己会比对"变了才写 DOM"，这里不做节流
    onTransaction: () => {
      handlers.onSelection?.(readFormat());
    },
  });

  function readFormat(): FormatState {
    return {
      active: {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        strike: editor.isActive('strike'),
        code: editor.isActive('code'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        link: editor.isActive('link'),
      },
      href: editor.isActive('link') ? String(editor.getAttributes('link')['href'] ?? '') || null : null,
    };
  }

  el.addEventListener('compositionstart', onCompositionStart);
  el.addEventListener('compositionend', onCompositionEnd);

  return {
    getMd: () => docToMd(editor.state.doc),

    setMd: (next: string) => {
      // 第二个参数 false = 不触发 onUpdate，避免"设置内容"被当成用户输入又写回队列
      editor.commands.setContent(mdToDoc(next).toJSON(), false);
    },

    focusAt: (clientX?: number, clientY?: number) => {
      // 同步聚焦：Tiptap 的 `focus` 命令把 `view.focus()` 推迟到下一帧，
      // 「双击建卡 → 立刻打字」时头几个字会落进 body（用户手快就会丢字）。
      // 选区仍交给命令设置，下一帧的那次聚焦是幂等的。
      editor.view.focus();

      if (clientX === undefined || clientY === undefined) {
        editor.commands.focus('end');
        return;
      }
      const pos = editor.view.posAtCoords({ left: clientX, top: clientY });
      if (pos) editor.chain().focus().setTextSelection(pos.pos).run();
      else editor.commands.focus('end');
    },

    formatState: readFormat,

    toggle: (action: FormatAction) => {
      // 不用 `chain()[action]()` 动态取方法：那样拿不到类型，一改名字只会在运行时炸
      const chain = editor.chain().focus();
      switch (action) {
        case 'bold':
          chain.toggleBold().run();
          break;
        case 'italic':
          chain.toggleItalic().run();
          break;
        case 'strike':
          chain.toggleStrike().run();
          break;
        case 'code':
          chain.toggleCode().run();
          break;
        case 'bulletList':
          chain.toggleBulletList().run();
          break;
        case 'orderedList':
          chain.toggleOrderedList().run();
          break;
      }
    },

    setLink: (href: string | null) => {
      const url = href === null ? '' : normalizeHref(href);
      if (url === '') {
        // extendMarkRange：光标停在链接里、没有选中文字时也该整段去掉
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    },

    destroy: () => {
      el.removeEventListener('compositionstart', onCompositionStart);
      el.removeEventListener('compositionend', onCompositionEnd);
      editor.destroy();
    },
  };
}
