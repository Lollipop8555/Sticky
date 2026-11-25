/**
 * 连线运行时单例：内存索引 + 变更通知。
 *
 * 真相有两层，别搞混：
 *   - `@/app/prefs` 里的 `links`（写库靠它，走 writeQueue 节流）；
 *   - 这里的 `LinkIndex`（相邻查询 O(1)，渲染与菜单每次打开都要用）。
 * 所有写操作都从 addLink / removeLink / pruneLinks 进来，先改索引，再把整份边集写回 prefs ——
 * 只有这一条路，所以两层不会分叉。
 */

import { getLinks, setLinks } from '@/app/prefs';
import type { LinkPair } from '@/storage/types';

import { createLinkIndex, normalizeLinks, type LinkIndex } from './links';

let index: LinkIndex = createLinkIndex(getLinks());
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of [...listeners]) fn();
}

/** boot 用：用库里读到的边集重建索引（prefs 必须先 init） */
export function initLinks(pairs: readonly LinkPair[] = getLinks()): void {
  index = createLinkIndex(pairs);
  emit();
}

export function linkIndex(): LinkIndex {
  return index;
}

export function hasLink(a: string, b: string): boolean {
  return index.has(a, b);
}

export function neighborIds(id: string): string[] {
  return index.neighbors(id);
}

/**
 * 加一条边。已存在或非法（自连）返回 false —— 调用方据此决定要不要给"已连过"的反馈。
 *
 * 判"有没有变"只能比 `size()`：`LinkIndex.add/remove` 按约定返回**内部数组本身**
 * （没变化时正是同一个引用，paint 靠这个跳过重绘），所以拿返回值比引用永远是 true、
 * 变更通知永远发不出去（曾经踩过：菜单数字减了、线还在、库也没写）。
 */
export function addLink(a: string, b: string): boolean {
  const before = index.size();
  index.add(a, b);
  if (index.size() === before) return false;
  setLinks(index.pairs());
  emit();
  return true;
}

export function removeLink(a: string, b: string): boolean {
  const before = index.size();
  index.remove(a, b);
  if (index.size() === before) return false;
  setLinks(index.pairs());
  emit();
  return true;
}

/**
 * 导入用：把包里的边**并**进本地边集（不是替换），去重后返回真正新增的条数。
 *
 * 为什么不是 `replaceAll`：导入是纯追加语义（决策 11/14），用户本机的线不能被一个
 * 外来的包抹掉。合并顺序 = 本地在前、包内新增在后，菜单里的顺序因此稳定。
 */
export function mergeLinks(pairs: readonly LinkPair[]): number {
  const merged = [...index.pairs(), ...normalizeLinks(pairs)];
  const added = index.replaceAll(merged);
  if (added > 0) {
    setLinks(index.pairs());
    emit();
  }
  return added;
}

/**
 * 只留两端都还活着的边。**只在物理删除后调**（清空回收站）：
 * 软删阶段故意不动边集，否则用户恢复便签时连线就没了（决策 73）。
 * 返回剔掉的条数，给导入/清理的日志用。
 */
export function pruneLinks(alive: ReadonlySet<string>): number {
  const keep = index.pairs().filter(([a, b]) => alive.has(a) && alive.has(b));
  const dropped = index.size() - keep.length;
  if (dropped > 0) {
    index = createLinkIndex(keep);
    setLinks(index.pairs());
    emit();
  }
  return dropped;
}

export function onLinksChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
