/**
 * 连线边集：全局、无向、去重（决策 73）。
 *
 * 为什么是"全局 id 对集合"而不是"每条记录各存自己的 links 数组"：
 * 双份存储必然有裂缝（A 说连着、B 说没连），还得成对写、成对删；而 `a|b` 这个键
 * 自带去重能力，导入时 concat 完再 Set 就完事。
 *
 * 三条不变量，改动前先看：
 *   1. **无向**：`a|b` 的 key 用排序后的顺序，所以 `add(a,b)` 与 `add(b,a)` 是同一件事；
 *   2. **自连丢弃**：`a === b` 不是连接，直接不进集合；
 *   3. **方向是未来的另一层**：将来要做箭头，方向另存字段，**不要改 key 的语义** ——
 *      改了以后历史数据全对不上（决策 73）。
 *
 * 这里只有纯数据，不碰库、不碰 DOM：持久化在 `@/app/prefs`，绘制在 `@/link/paint`。
 */

import type { LinkPair } from '@/storage/types';

/** 无向键：`a<b` 归一后拼接。uuid 不含 `|`，所以拼接无歧义 */
export function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 归一成合法边对；自连（a === b）返回 null */
export function normalizePair(a: string, b: string): LinkPair | null {
  if (a === b || !a || !b) return null;
  return a < b ? [a, b] : [b, a];
}

/**
 * 外部数据（库里读回、ZIP 里导入）→ 合法边集。
 * 非法项**丢弃而不抛错**：一行坏数据不该让整个库打不开。
 */
export function normalizeLinks(raw: unknown): LinkPair[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LinkPair[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [a, b] = item as unknown[];
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    const pair = normalizePair(a, b);
    if (!pair) continue;
    const key = linkKey(pair[0], pair[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

/**
 * 运行时索引。内部可变，但 `add`/`remove` 返回**数组引用**：
 * 没变化时返回同一个引用，调用方比一下就知道要不要重绘（paint 每帧都会问）。
 */
export interface LinkIndex {
  /** 全量边对（只读视图）。顺序 = 插入序，菜单排序另做 */
  pairs(): readonly LinkPair[];
  size(): number;
  has(a: string, b: string): boolean;
  /** 与 id 相连的邻居，按插入序；返回副本，外部改不到内部 */
  neighbors(id: string): string[];
  degree(id: string): number;
  add(a: string, b: string): readonly LinkPair[];
  remove(a: string, b: string): readonly LinkPair[];
  /** 整体替换（导入合并用）。返回新增了几条，供导入摘要用 */
  replaceAll(pairs: readonly LinkPair[]): number;
}

export function createLinkIndex(initial: readonly LinkPair[] = []): LinkIndex {
  const list: LinkPair[] = [];
  const keys = new Set<string>();
  /** id → 邻居 id 数组；用数组而不是 Set 是为了保住插入序，菜单顺序稳定 */
  const adj = new Map<string, string[]>();

  function insert(a: string, b: string): void {
    list.push([a, b]);
    keys.add(linkKey(a, b));
    pushAdj(a, b);
    pushAdj(b, a);
  }

  function pushAdj(from: string, to: string): void {
    const arr = adj.get(from);
    if (arr) arr.push(to);
    else adj.set(from, [to]);
  }

  function dropAdj(from: string, to: string): void {
    const arr = adj.get(from);
    if (!arr) return;
    const at = arr.indexOf(to);
    if (at !== -1) arr.splice(at, 1);
    if (arr.length === 0) adj.delete(from);
  }

  function clear(): void {
    list.length = 0;
    keys.clear();
    adj.clear();
  }

  for (const pair of normalizeLinks(initial)) insert(pair[0], pair[1]);

  return {
    pairs: () => list,
    size: () => list.length,

    has(a, b) {
      return keys.has(linkKey(a, b));
    },

    neighbors(id) {
      const arr = adj.get(id);
      return arr ? [...arr] : [];
    },

    degree(id) {
      return adj.get(id)?.length ?? 0;
    },

    add(a, b) {
      const pair = normalizePair(a, b);
      if (!pair) return list;
      const key = linkKey(pair[0], pair[1]);
      if (keys.has(key)) return list;
      insert(pair[0], pair[1]);
      return list;
    },

    remove(a, b) {
      const key = linkKey(a, b);
      if (!keys.has(key)) return list;
      const pair = normalizePair(a, b);
      // has() 为真时 pair 一定存在（a === b 的对从来没有进过 keys）
      if (!pair) return list;

      keys.delete(key);
      const at = list.findIndex((p) => p[0] === pair[0] && p[1] === pair[1]);
      if (at !== -1) list.splice(at, 1);
      dropAdj(pair[0], pair[1]);
      dropAdj(pair[1], pair[0]);
      return list;
    },

    replaceAll(pairs) {
      const next = normalizeLinks(pairs);
      const before = keys.size;
      clear();
      for (const pair of next) insert(pair[0], pair[1]);
      return Math.max(0, keys.size - before);
    },
  };
}
