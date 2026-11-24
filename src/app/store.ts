/**
 * 唯一的内存真相 + 唯一的写入口。
 *
 * `commit` 是**唯一**能改 notes 的函数：先改内存 → 再入写队列 → 最后通知订阅者。
 * 任何地方想改便签都调 `commands.*`，由它组装好记录再调 `commit`。
 * 这条纪律换来的是：脏标记、落库、重绘只有一处实现，永远不需要"记得也调一下那边"。
 */

import type { NoteRecord } from '@/storage/types';
import { enqueue } from '@/storage/writeQueue';

export interface AppState {
  /** 严格单卡编辑：同一时间最多一张 */
  editingId: string | null;
  /**
   * 正在被拖着的卡。放进 store 而不是留在手势模块里，
   * 是因为**剔除也要读它**：一张被拖出可见带的卡如果被卸载，用户手里就什么都没了。
   */
  draggingId: string | null;
}

/** 只回报"变了什么"，订阅者不必自己 diff 全表 —— 拖动时每帧都会通知 */
type NotesListener = (upserts: readonly NoteRecord[], removed: readonly string[]) => void;
type StateListener = (state: Readonly<AppState>) => void;

const notes = new Map<string, NoteRecord>();
const state: AppState = { editingId: null, draggingId: null };

const noteListeners = new Set<NotesListener>();
const stateListeners = new Set<StateListener>();

export const store = {
  /** boot 用：灌入读到的记录。**不入队**——刚从库里读出来的东西没必要立刻写回去 */
  hydrate(records: readonly NoteRecord[]): void {
    notes.clear();
    for (const record of records) notes.set(record.id, record);
  },

  getNotes(): ReadonlyMap<string, NoteRecord> {
    return notes;
  },

  getNote(id: string): NoteRecord | undefined {
    return notes.get(id);
  },

  count(): number {
    return notes.size;
  },

  /**
   * 只从内存里摘掉（并通知订阅者卸载），**不入写队列**。
   *
   * 给软删除用：废纸篓里的卡和墙上的卡是同一条记录的两个状态，
   * 落库必须由调用方显式 `enqueue('upsert', { ...note, deletedAt })`。
   * 用 `commit(upserts, removed)` 的 `removed` 会入队 `delete` —— 那是物理删，
   * 卡就真没了，恢复无从谈起（决策 55）。
   */
  detach(ids: readonly string[]): void {
    const removed = ids.filter((id) => notes.has(id));
    if (removed.length === 0) return;
    for (const id of removed) notes.delete(id);
    for (const fn of noteListeners) fn([], removed);
  },

  getState(): Readonly<AppState> {
    return state;
  },

  setState(patch: Partial<AppState>): void {
    let changed = false;
    for (const [key, value] of Object.entries(patch) as [keyof AppState, AppState[keyof AppState]][]) {
      if (state[key] === value) continue;
      state[key] = value as never;
      changed = true;
    }
    if (!changed) return;
    for (const fn of stateListeners) fn(state);
  },

  subscribeNotes(fn: NotesListener): () => void {
    noteListeners.add(fn);
    return () => noteListeners.delete(fn);
  },

  subscribeState(fn: StateListener): () => void {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  },

  commit(upserts: readonly NoteRecord[], removed: readonly string[] = []): void {
    if (upserts.length === 0 && removed.length === 0) return;

    for (const id of removed) {
      notes.delete(id);
      enqueue('delete', id);
    }
    for (const record of upserts) {
      notes.set(record.id, record);
      enqueue('upsert', record);
    }

    for (const fn of noteListeners) fn(upserts, removed);
  },
};

/** 仅供测试：清空内存态 */
export function __resetStore(): void {
  notes.clear();
  state.editingId = null;
  state.draggingId = null;
  noteListeners.clear();
  stateListeners.clear();
}
