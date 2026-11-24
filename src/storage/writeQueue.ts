/**
 * 写队列：内存是真相，库是镜像。
 *
 * 为什么不是「每次 mutation 直接 await 一次 IDB」：
 * 拖动一张卡一秒能触发几十次坐标变化，逐次落库会把主线程塞满微任务，且几乎全是重复写同一条记录。
 * 这里用 `Map<id, op>` 合并 —— 同一个 id 无论改多少次，一批里只写一次。
 *
 * 三条时序规则（impl-00 §5）：
 *   - 400ms **节流**（不是防抖）：防抖会让持续输入时永远不落库，一次崩溃全丢
 *   - 积压 20 条立即写：批量等不到定时器也不能让内存里堆太多未落库状态
 *   - 页面隐藏/关闭立即写：这是"关掉标签页不丢"的唯一保障
 */

import type { NoteRecord } from './types';

export type PendingOp = { kind: 'upsert'; record: NoteRecord } | { kind: 'delete'; id: string };

export interface WriteQueueIO {
  putNotes(records: NoteRecord[]): Promise<void>;
  delNotes(ids: string[]): Promise<void>;
  /** 由 prefs 模块提供：把当前偏好快照写回库 */
  savePrefs(): Promise<void>;
}

export interface WriteQueueEvents {
  onError?: (info: { kind: 'quota' | 'write'; error: unknown }) => void;
  /**
   * 一批**成功**写完之后。给"首次落库后申请持久化存储"用的（tech-design §5）：
   * 一次都没写成就去要权限，等于向用户索取一个还没用上的东西。
   */
  onFlushed?: (info: { records: number; prefs: boolean }) => void;
}

export interface WriteQueue {
  enqueue(kind: PendingOp['kind'], payload: NoteRecord | string): void;
  markPrefsDirty(): void;
  flush(): Promise<void>;
  size(): number;
  dispose(): void;
}

const FLUSH_DELAY = 400;
const MAX_BACKLOG = 20;
const MAX_RETRIES = 3;
const RETRY_DELAY = 3000;

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export function createWriteQueue(io: WriteQueueIO, events: WriteQueueEvents = {}): WriteQueue {
  const queue = new Map<string, PendingOp>();
  let prefsDirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  /** 串行化：两批并发写同一批记录时，后完成的会覆盖先完成的，顺序就乱了 */
  let chain: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function report(kind: 'quota' | 'write', error: unknown): void {
    if (events.onError) events.onError({ kind, error });
    else console.error(`[writeQueue] ${kind} 失败`, error);
  }

  function schedule(delay: number): void {
    // 已有定时器就不重置：连续入队不该把落库时间无限往后推（节流而非防抖）
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function runBatch(): Promise<void> {
    if (queue.size === 0 && !prefsDirty) return;

    // 先整批搬走再写：flush 期间新入队的操作进 map 本身，不会丢
    const batch = [...queue.values()];
    queue.clear();
    const writePrefs = prefsDirty;
    prefsDirty = false;

    const records = batch.flatMap((op) => (op.kind === 'upsert' ? [op.record] : []));
    const ids = batch.flatMap((op) => (op.kind === 'delete' ? [op.id] : []));

    try {
      // 空调用不发：只有删除的一批不该去开一个空的 notes 写事务
      if (ids.length > 0) await io.delNotes(ids);
      if (records.length > 0) await io.putNotes(records);
      if (writePrefs) await io.savePrefs();
      retries = 0;
      if (events.onFlushed && (records.length > 0 || writePrefs)) {
        events.onFlushed({ records: records.length, prefs: writePrefs });
      }
    } catch (error) {
      // 写失败：把这一批放回队列，但不能覆盖 flush 期间新产生的操作（新的才是真相）
      for (const op of batch) {
        const key = op.kind === 'upsert' ? op.record.id : op.id;
        if (!queue.has(key)) queue.set(key, op);
      }
      if (writePrefs) prefsDirty = true;

      if (isQuotaError(error)) {
        // 配额满了重试没有意义，只会无限刷屏：停写，交给 UI 提示用户导出/清理
        clearTimer();
        report('quota', error);
        return;
      }

      report('write', error);
      if (retries < MAX_RETRIES) {
        retries += 1;
        clearTimer();
        schedule(RETRY_DELAY);
      }
    }
  }

  function flush(): Promise<void> {
    // 链式排队：不并发、不重入，天然保住批次顺序
    chain = chain.then(runBatch, runBatch);
    return chain;
  }

  return {
    enqueue(kind, payload): void {
      // 必须存快照：record 对象在 store 里是同一个引用，会被继续修改，
      // 直接存引用等于 flush 时读到了"未来的值"，与入队时刻的状态不一致
      if (kind === 'upsert') {
        const record = payload as NoteRecord;
        queue.set(record.id, { kind: 'upsert', record: { ...record } });
      } else {
        const id = payload as string;
        queue.delete(id);
        queue.set(id, { kind: 'delete', id });
      }

      if (queue.size >= MAX_BACKLOG) {
        clearTimer();
        void flush();
        return;
      }
      schedule(FLUSH_DELAY);
    },

    markPrefsDirty(): void {
      prefsDirty = true;
      schedule(FLUSH_DELAY);
    },

    flush,

    size(): number {
      return queue.size;
    },

    dispose(): void {
      clearTimer();
      queue.clear();
      prefsDirty = false;
    },
  };
}

let instance: WriteQueue | null = null;

/** 组装期注入：main.ts 里把 repo 与 prefs 接进来，模块本身不 import 它们（避免循环依赖） */
export function configureWriteQueue(io: WriteQueueIO, events?: WriteQueueEvents): WriteQueue {
  instance = createWriteQueue(io, events);
  return instance;
}

function current(): WriteQueue {
  if (!instance) throw new Error('[writeQueue] 尚未 configureWriteQueue');
  return instance;
}

export function enqueue(kind: PendingOp['kind'], payload: NoteRecord | string): void {
  current().enqueue(kind, payload);
}

export function markPrefsDirty(): void {
  current().markPrefsDirty();
}

export function flush(): Promise<void> {
  return instance ? instance.flush() : Promise.resolve();
}

/**
 * 退出保护。三个事件缺一不可：
 * - visibilitychange(hidden)：手机切 App、切标签页，桌面关闭标签页也会触发
 * - pagehide：比 unload 可靠（Safari 的 unload 常常不触发）
 * - blur：切到别的窗口，用户可能就在那边关掉浏览器
 */
export function attachFlushTriggers(win: Window = window, doc: Document = document): () => void {
  const onHidden = (): void => {
    if (doc.visibilityState === 'hidden') void flush();
  };
  const onLeave = (): void => {
    void flush();
  };

  doc.addEventListener('visibilitychange', onHidden);
  win.addEventListener('pagehide', onLeave);
  win.addEventListener('blur', onLeave);

  return () => {
    doc.removeEventListener('visibilitychange', onHidden);
    win.removeEventListener('pagehide', onLeave);
    win.removeEventListener('blur', onLeave);
  };
}
