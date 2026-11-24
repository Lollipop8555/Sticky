import { describe, expect, it } from 'vitest';

import { parseNote, serializeNote } from '@/io/frontmatter';
import type { NoteRecord } from '@/storage/types';

/**
 * frontmatter 是导出/导入的**唯一持久契约**：这里的 round-trip 一旦悄悄漂移，
 * 用户几个月后才发现备份里的坐标/颜色不对，那时已经无从补救。
 */

function note(patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'n-1',
    x: 120,
    y: -40,
    width: 260,
    height: 322,
    minHeight: 160,
    z: 7,
    bgColor: '#FCE7F3',
    contentMd: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    deletedAt: null,
    ...patch,
  };
}

describe('serializeNote / parseNote', () => {
  it('round-trip：几何、颜色、时间一字不差', () => {
    const source = note({ contentMd: '第一行\n\n- 列表\n- 还有一项' });
    const parsed = parseNote(serializeNote(source));
    expect(parsed).not.toBeNull();
    expect(parsed?.meta).toEqual({
      id: source.id,
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
      minHeight: source.minHeight,
      z: source.z,
      bgColor: source.bgColor,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });
    expect(parsed?.contentMd).toBe(source.contentMd);
  });

  it('空正文不产生空行噪声', () => {
    const text = serializeNote(note());
    expect(text.endsWith('---\n')).toBe(true);
    expect(parseNote(text)?.contentMd).toBe('');
  });

  it('正文里的 --- 不会被当成 frontmatter 结束符', () => {
    const body = '上半段\n---\n下半段';
    expect(parseNote(serializeNote(note({ contentMd: body })))?.contentMd).toBe(body);
  });

  it('CRLF 与 BOM 归一后再解析', () => {
    const crlf = serializeNote(note({ contentMd: '换行' })).replace(/\n/g, '\r\n');
    const parsed = parseNote(`\uFEFF${crlf}`);
    expect(parsed?.meta.id).toBe('n-1');
    expect(parsed?.contentMd).toBe('换行');
  });

  it('接受引号包起来的 id（别的工具导出的包常见）', () => {
    const text = '---\nid: "abc-123"\nx: 1\n---\n正文';
    expect(parseNote(text)?.meta.id).toBe('abc-123');
  });

  it('缺 id 或没有 frontmatter → null（不能猜一个 id 塞进库）', () => {
    expect(parseNote('只是一段普通 markdown')).toBeNull();
    expect(parseNote('---\nx: 1\n---\n正文')).toBeNull();
    expect(parseNote('---\nid: demo\n只有开头没有结尾')).toBeNull();
  });

  it('坏数字回落到默认值，不让 NaN 流进记录', () => {
    const parsed = parseNote('---\nid: demo\nx: 不是数字\nheight: NaN\nz: 2.6\n---\n');
    expect(parsed?.meta.x).toBe(0);
    expect(parsed?.meta.height).toBe(320);
    expect(parsed?.meta.z).toBe(3);
    expect(parsed?.meta.bgColor).toBe('yellow');
  });
});
