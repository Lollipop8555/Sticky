/**
 * markdown ⇄ ProseMirror doc。
 *
 * 为什么必须走 PM doc 而不是 `innerHTML`：`contentMd` 是唯一真相（决策 1），
 * 富文本必须能**无损地**回到 markdown。拿 HTML 当中间态就必然要写一套 HTML→md 的反向规则，
 * 那是这个项目里最容易长出 bug 的地方。
 *
 * 一套 schema 三处用：Tiptap 编辑器、md 解析、非编辑态的 DOM 渲染。
 * 三者共用同一个 `noteSchema`，所以"编辑器里能显示的东西"和"卡上静息显示的东西"不会漂移。
 *
 * 支持范围（M2）：粗体/斜体/删除线/行内代码/链接/列表/图片。
 * 标题、引用、代码块、表格**故意不支持** —— 便签不是文档，解析失败会整卡退化成纯文本（见 `plainFallback`）。
 */

import Bold from '@tiptap/extension-bold';
import BulletList from '@tiptap/extension-bullet-list';
import Code from '@tiptap/extension-code';
import Document from '@tiptap/extension-document';
import { NoteImage } from './image';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { getSchema } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';

/**
 * 图片是 **inline** 节点：`![alt](src)` 在 CommonMark 里本来就是行内 token，
 * 用 block image 就得在解析时手写 token 特判。独占一行的观感交给 CSS（`img { display:block }`）。
 */
export const noteExtensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Strike,
  Code,
  Link.configure({
    openOnClick: false,
    autolink: false,
    // 静息态点链接要开新页：同页跳转会把整个画布连同未保存的输入一起丢掉
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
  }),
  BulletList,
  OrderedList,
  ListItem,
  // 图片用自己那层包装：canonical 路径要变成 data-asset，外链要变成占位符（见 note/image.ts）
  NoteImage.configure({ inline: true, allowBase64: false }),
];

/** 编辑器与渲染共用的 schema（`getSchema` 走的是同一套扩展，天然一致） */
export const noteSchema = getSchema(noteExtensions);

// html:false —— md 里出现的裸 HTML 一律当纯文本，不给它变成可执行 DOM 的机会。
// 保持 commonmark preset：换成 default 会引入 table token，schema 里没有它，
// MarkdownParser 会直接抛错，整卡退化成纯文本（比不支持更糟）。
const tokenizer = new MarkdownIt('commonmark', { html: false, linkify: false });
// `~~删除线~~` 不在 CommonMark 里，但用户会写；单独启用这一条规则，不多不少
tokenizer.enable('strikethrough');

const parser = new MarkdownParser(noteSchema, tokenizer, {
  // text token 由 prosemirror-markdown 内部直接 addText，不需要（也不能）配 spec
  paragraph: { block: 'paragraph' },
  // Tiptap 的 mark 叫 bold/italic，CommonMark 的 token 叫 strong/em，这里做唯一一处映射
  strong: { mark: 'bold' },
  em: { mark: 'italic' },
  s: { mark: 'strike' },
  code_inline: { mark: 'code', noCloseToken: true },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
  },
  // 列表：token 名是 snake_case，Tiptap 的节点名是 camelCase，映射只在这里出现
  bullet_list: { block: 'bulletList' },
  ordered_list: {
    block: 'orderedList',
    // markdown-it 的 start 是字符串；缺省时 CommonMark 语义是 1
    getAttrs: (tok) => ({ start: Number(tok.attrGet('start')) || 1 }),
  },
  list_item: { block: 'listItem' },
  // 只写 { node: 'image' } 拿到的是空 attrs：src/title/alt 的提取写在 prosemirror-markdown
  // 的**默认 parser 表**里，不是 MarkdownParser 的内建行为，必须照抄过来
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: tok.children?.[0]?.content ?? null,
    }),
  },
});

const serializer = new MarkdownSerializer(
  {
    // 必须显式给 text 配序列化器：`renderInline` 是逐个 child `render()` 的，
    // text 没有序列化器时会被当成"叶子节点，没有内容可渲染"直接跳过 —— 表现为整张卡变成空字符串
    text(state, node) {
      state.text(node.text ?? '');
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    bulletList(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    orderedList(state, node) {
      // 注意 Tiptap 的 attr 叫 start，prosemirror-markdown 默认序列化器读的是 order
      const start = Number(node.attrs['start']) || 1;
      const width = String(start + node.childCount - 1).length;
      const space = state.repeat(' ', width + 2);
      state.renderList(node, space, (i) => {
        const num = String(start + i);
        return state.repeat(' ', width - num.length) + num + '. ';
      });
    },
    listItem(state, node) {
      state.renderContent(node);
    },
    image(state, node) {
      // 和 prosemirror-markdown 的默认实现一致：括号要转义，否则 `a(b).png` 会被截断
      const src = String(node.attrs['src'] ?? '').replace(/[()]/g, '\\$&');
      const alt = state.esc(String(node.attrs['alt'] ?? ''));
      const title = node.attrs['title']
        ? ` "${String(node.attrs['title']).replace(/"/g, '\\"')}"`
        : '';
      state.write(`![${alt}](${src}${title})`);
    },
  },
  {
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    // escape:false —— 代码里的反引号/星号必须原样保留，被转义就改变了代码内容
    code: { open: '`', close: '`', escape: false },
    link: {
      // 不用 autolink 写法（`<url>`）：它要求链接文字与 href 完全相同，
      // 判断成本高于收益，统一 `[text](href)` 反而更好读
      open: () => '[',
      close(state, mark) {
        const href = state.esc(String(mark.attrs['href'] ?? ''));
        // 没有 state.quote()：标题里的双引号按 CommonMark 只能反斜杠转义
        const title = mark.attrs['title']
          ? ` "${String(mark.attrs['title']).replace(/"/g, '\\"')}"`
          : '';
        return `](${href}${title})`;
      },
    },
  },
  // strict:false —— 遇到没配序列化器的节点就渲染其内容，而不是抛错。
  // 以后加扩展时忘了配序列化器，用户丢的是格式而不是整段文字。
  { strict: false },
);

const domSerializer = DOMSerializer.fromSchema(noteSchema);

/** 空文档 = 一个空段落。Tiptap 不接受真正空的 doc */
function emptyDoc(): PMNode {
  const doc = noteSchema.topNodeType.createAndFill();
  if (!doc) throw new Error('[markdown] schema 无法创建空文档');
  return doc;
}

/**
 * 兜底：schema 还不支持的结构（标题、引用、代码块、表格）整段退化成**按空行分段的纯文本**。
 *
 * 为什么不是"整段塞进一个段落"：那会把用户的换行全吃掉，一屏文字变成一坨，
 * 而且下次保存就会用这个形态覆盖 `contentMd`。分段至少保住了行结构。
 * 格式丢了是可见的（用户看到 `# 标题` 原样显示），正文丢了是不可恢复的。
 */
function plainFallback(md: string): PMNode {
  const paragraph = noteSchema.nodes['paragraph'];
  if (!paragraph) return emptyDoc();

  const blocks = md
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => paragraph.create(null, noteSchema.text(block)));

  return noteSchema.topNodeType.create(null, blocks);
}

export function mdToDoc(md: string): PMNode {
  if (md.trim() === '') return emptyDoc();
  try {
    return parser.parse(md);
  } catch (error) {
    console.warn('[markdown] 含暂不支持的结构，按纯文本显示', error);
    return plainFallback(md);
  }
}

export function docToMd(doc: PMNode): string {
  if (doc.content.size === 0) return '';
  // tightLists —— Tiptap 的列表节点没有 `tight` 属性（那是 prosemirror-markdown 默认 schema 的字段），
  // 不传这个选项就按"松散列表"序列化，两项之间插一个空行：`- a` / 空行 / `- b`。
  // 代价是用户手写的松散列表在保存后被收紧，内容不受影响。
  return serializer.serialize(doc, { tightLists: true }).trimEnd();
}

/**
 * 空文本块补一个 `<br>`，对齐 ProseMirror 编辑态的 `br.ProseMirror-trailingBreak`。
 *
 * prosemirror-view 会给**每个**空文本块塞那个 `<br>`（`addTextblockHacks`：没有子节点就没有
 * 行盒，光标无处安放）。`DOMSerializer` 不塞，于是同一个 doc 出来两条不同的 DOM：
 *
 * - Chromium 下空 `<li><p></p></li>` 还能靠 marker 撑出一行，看起来"没坏"；
 * - **Safari（WebKit）下它塌成 0 高** —— 列表末尾那个只有序号、没有正文的 item，序号溢出到
 *   卡片的 padding 上，用户看到的就是"便签贴着卡片底边"，而一进编辑又多出一行、退出又缩回。
 *
 * 决策 68 要求两条渲染路径同高；这次补的正是 ProseMirror 本来就有的那一行，而不是再用 CSS 兜
 * —— 兜 CSS 只能让 `min-height` 假装有行高，marker 的基线仍然对不上。
 */
function fillEmptyTextblocks(fragment: DocumentFragment): DocumentFragment {
  for (const p of fragment.querySelectorAll('p')) {
    if (p.childNodes.length === 0) p.append(p.ownerDocument.createElement('br'));
  }
  return fragment;
}

/** 非编辑态渲染：直接由 PM doc 出 DOM，避免再写一条 md→HTML 的路子 */
export function docToFragment(doc: PMNode): DocumentFragment {
  // 不传 options 时返回的就是 DocumentFragment（传 document 才返回「包装成某文档」的元素）
  return fillEmptyTextblocks(domSerializer.serializeFragment(doc.content) as DocumentFragment);
}
