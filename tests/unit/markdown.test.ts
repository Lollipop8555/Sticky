import { describe, expect, it } from 'vitest';

import { docToMd, mdToDoc } from '@/note/markdown';

/** 语义相等：md 允许有等价的多种写法，比较解析后的 doc 才是真正的不变量 */
function sameDoc(a: string, b: string): boolean {
  return JSON.stringify(mdToDoc(a).toJSON()) === JSON.stringify(mdToDoc(b).toJSON());
}

describe('markdown ⇄ doc', () => {
  it('空内容 → 空文档 → 空字符串（空卡的 contentMd 必须是 ""，不是 "\\n"）', () => {
    expect(docToMd(mdToDoc(''))).toBe('');
    expect(docToMd(mdToDoc('   \n\n '))).toBe('');
    expect(mdToDoc('').childCount).toBe(1); // Tiptap 不接受真正空的 doc
  });

  it('纯文本往返不变', () => {
    for (const md of ['hello', '第一行', 'a b  c']) {
      expect(docToMd(mdToDoc(md))).toBe(md);
    }
  });

  it('多段落往返保持分段（\n\n 是段，不是空行）', () => {
    const md = '第一段\n\n第二段\n\n第三段';
    expect(docToMd(mdToDoc(md))).toBe(md);
    expect(mdToDoc(md).childCount).toBe(3);
  });

  it('粗体/斜体映射到 Tiptap 的 bold/italic mark', () => {
    const doc = mdToDoc('a **b** c *d*');
    const marks: string[] = [];
    doc.descendants((node) => {
      for (const mark of node.marks) marks.push(mark.type.name);
    });

    expect(marks).toContain('bold');
    expect(marks).toContain('italic');
    expect(docToMd(doc)).toBe('a **b** c *d*');
  });

  it('含特殊字符的正文二次往返稳定（序列化器会自动转义）', () => {
    const once = mdToDoc('a*b_c > d');
    const md = docToMd(once);
    // 第一遍可能加转义符，关键是第二遍起不再漂移
    expect(sameDoc(docToMd(mdToDoc(md)), md)).toBe(true);
  });

  it('暂不支持的结构（标题）退化成纯文本但保留分段', () => {
    const doc = mdToDoc('# 标题\n\n正文段落');

    // 两段都在，正文没丢（整卡退化也不能吞字）
    expect(doc.childCount).toBe(2);
    expect(doc.textContent).toContain('标题');
    expect(doc.textContent).toContain('正文段落');
  });

  it('无序列表往返：节点是 bulletList/listItem，列表符号不漂移', () => {
    const md = '- 第一项\n- 第二项';
    const doc = mdToDoc(md);

    expect(doc.firstChild?.type.name).toBe('bulletList');
    expect(doc.firstChild?.firstChild?.type.name).toBe('listItem');
    expect(docToMd(doc)).toBe(md);
  });

  it('有序列表保留起始序号（start=3 不能被改回 1）', () => {
    const md = '3. 三\n4. 四';
    const doc = mdToDoc(md);

    expect(doc.firstChild?.attrs['start']).toBe(3);
    expect(docToMd(doc)).toBe(md);
  });

  it('列表内的粗体与链接一起往返', () => {
    const md = '- **重要** [文档](https://example.com)';
    expect(docToMd(mdToDoc(md))).toBe(md);
  });

  it('行内代码里的反引号与星号原样保留（不能被转义）', () => {
    const md = 'a `x*y` b';
    expect(docToMd(mdToDoc(md))).toBe(md);

    const marks: string[] = [];
    mdToDoc(md).descendants((node) => {
      for (const mark of node.marks) marks.push(mark.type.name);
    });
    expect(marks).toContain('code');
  });

  it('删除线映射到 strike mark 并往返', () => {
    const md = 'a ~~删掉~~ b';
    const doc = mdToDoc(md);

    const marks: string[] = [];
    doc.descendants((node) => {
      for (const mark of node.marks) marks.push(mark.type.name);
    });
    expect(marks).toContain('strike');
    expect(docToMd(doc)).toBe(md);
  });

  it('链接保留 href，且序列化回 []() 形式', () => {
    const doc = mdToDoc('[官网](https://example.com/a?b=1)');
    let href = '';
    doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'link') href = mark.attrs['href'];
    });

    expect(href).toBe('https://example.com/a?b=1');
    expect(docToMd(doc)).toBe('[官网](https://example.com/a?b=1)');
  });

  it('图片解析成 inline image 节点，alt/src 都在，往返不变', () => {
    const md = '![一只猫](assets/abc.png)';
    const doc = mdToDoc(md);
    const image = doc.firstChild?.firstChild;

    expect(image?.type.name).toBe('image');
    expect(image?.attrs['src']).toBe('assets/abc.png');
    expect(image?.attrs['alt']).toBe('一只猫');
    expect(docToMd(doc)).toBe(md);
  });

  it('图片与文字同段时不互相吞掉', () => {
    const md = '看图 ![x](assets/a.png) 完';
    const round = docToMd(mdToDoc(md));
    expect(round).toContain('看图');
    expect(round).toContain('assets/a.png');
    expect(round).toContain('完');
  });

  it('schema 不支持的结构不吞正文（标题会退化成段落文本或保留原文）', () => {
    const md = '# 标题';
    const round = docToMd(mdToDoc(md));
    expect(round).toContain('标题');
  });

  it('空段落夹在中间不丢段落数（粘贴多行后仍可继续编辑）', () => {
    const doc = mdToDoc('a\n\nb');
    const md = docToMd(doc);
    expect(md.split('\n\n')).toHaveLength(2);
  });
});
