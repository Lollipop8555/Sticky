/**
 * `<uuid>.md` 的头部元数据（PRD §2.5）：位置 / 尺寸 / 调色板 / 时间戳。
 *
 * 为什么是 frontmatter 而不是把元数据塞进 manifest：zip 解开之后**每个 md 自己就是完整的**，
 * 用户拿一个文件出去、改完再拖回来也不会丢位置；manifest 里再抄一份就变成两个真相。
 *
 * 解析器是手写的，不引 YAML 库：这里的字段全部是"标量"，而 `js-yaml` 会顺带接受锚点、
 * 多行块、类型推断（`yes` 会变布尔）——能力越大，导入时踩到的意外越离奇。
 */

import type { NoteRecord } from '@/storage/types';

export interface NoteMeta {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minHeight: number;
  z: number;
  bgColor: string;
  createdAt: number;
  updatedAt: number;
}

/** 缺字段时的兜底：与当前默认便签（320 见方）一致，导入老包也不至于出现"一条线" */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 320;
const DEFAULT_MIN_HEIGHT = 160;

export function serializeNote(note: NoteRecord): string {
  const meta: Array<[string, string | number]> = [
    ['id', note.id],
    ['x', Math.round(note.x)],
    ['y', Math.round(note.y)],
    ['width', Math.round(note.width)],
    ['height', Math.round(note.height)],
    ['minHeight', Math.round(note.minHeight)],
    ['z', note.z],
    ['bgColor', note.bgColor],
    ['createdAt', note.createdAt],
    ['updatedAt', note.updatedAt],
  ];

  const head = meta.map(([key, value]) => `${key}: ${value}`).join('\n');
  // 正文前面垫一个空行：直接贴着 `---` 的话，某些 markdown 工具会把首行当成分隔线的一部分
  const body = note.contentMd === '' ? '' : `\n${note.contentMd}`;
  return `---\n${head}\n---\n${body}`;
}

function str(map: Map<string, string>, key: string, fallback = ''): string {
  const raw = map.get(key)?.trim();
  if (raw === undefined || raw === '') return fallback;
  // 允许 `id: "abc"` 这种写法（别的工具导出的包里常见）
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function num(map: Map<string, string>, key: string, fallback: number): number {
  const raw = map.get(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @returns 解析不出来（没有 frontmatter、id 缺失）时返回 null —— 调用方应当计入"跳过"，
 * 而不是猜一个 id 塞进库里。**没有 id 就无法判断是不是重复**，硬塞只会造出幽灵便签。
 */
export function parseNote(text: string): { meta: NoteMeta; contentMd: string } | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;

  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return null;

  const block = normalized.slice(4, end);
  // `\n---` 之后可能紧接正文（没有空行），也可能只有换行。
  // 开头连续的换行全部去掉：serializeNote 会垫一个空行，外来包可能垫两三个 ——
  // 正文开头的空行本来就是排版噪声，留着只会让 round-trip 越导越长。
  const rest = normalized.slice(end + 4).replace(/^\n+/, '');

  const map = new Map<string, string>();
  for (const line of block.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at <= 0) continue;
    map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const id = str(map, 'id');
  if (id === '') return null;

  const now = Date.now();
  const createdAt = num(map, 'createdAt', now);
  return {
    meta: {
      id,
      x: num(map, 'x', 0),
      y: num(map, 'y', 0),
      width: num(map, 'width', DEFAULT_WIDTH),
      height: num(map, 'height', DEFAULT_HEIGHT),
      minHeight: num(map, 'minHeight', DEFAULT_MIN_HEIGHT),
      z: Math.round(num(map, 'z', 0)),
      bgColor: str(map, 'bgColor', 'yellow'),
      createdAt,
      updatedAt: num(map, 'updatedAt', createdAt),
    },
    // 末尾的换行是排版噪声：markdown 序列化回来一样，留着只会让 round-trip 测试变脆
    contentMd: rest.replace(/\n+$/, ''),
  };
}
