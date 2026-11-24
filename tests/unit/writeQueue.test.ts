import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteRecord } from '@/storage/types';
import { createWriteQueue, type WriteQueueIO } from '@/storage/writeQueue';

function note(id: string, patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    x: 0,
    y: 0,
    width: 260,
    height: 184,
    minHeight: 160,
    z: 1,
    bgColor: '#FCE7F3',
    contentMd: '',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...patch,
  };
}

function makeIO() {
  const puts: NoteRecord[][] = [];
  const dels: string[][] = [];
  const errors: string[] = [];
  let prefsWrites = 0;

  const io: WriteQueueIO = {
    putNotes: async (records) => {
      const fail = errors.shift();
      if (fail) throw Object.assign(new Error(fail), { name: fail });
      puts.push(records);
    },
    delNotes: async (ids) => {
      dels.push(ids);
    },
    savePrefs: async () => {
      prefsWrites += 1;
    },
  };

  return { io, puts, dels, errors, prefsWrites: () => prefsWrites };
}

describe('writeQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同 id 多次修改合并成一次写，且写的是最后一次的值', async () => {
    const { io, puts } = makeIO();
    const queue = createWriteQueue(io);

    for (let i = 0; i < 5; i++) queue.enqueue('upsert', note('a', { x: i * 10 }));
    expect(queue.size()).toBe(1);

    await vi.advanceTimersByTimeAsync(400);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toHaveLength(1);
    expect(puts[0]?.[0]?.x).toBe(40); // 最后那次
  });

  it('400ms 是节流不是防抖：后续入队不推迟落库时间', async () => {
    const { io, puts } = makeIO();
    const queue = createWriteQueue(io);

    queue.enqueue('upsert', note('a'));
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue('upsert', note('b')); // 若为防抖，这里会把时间重置到 600ms
    await vi.advanceTimersByTimeAsync(200);

    expect(puts).toHaveLength(1);
    expect(puts[0]?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('积压 20 条立即写，不等定时器', async () => {
    const { io, puts } = makeIO();
    const queue = createWriteQueue(io);

    for (let i = 0; i < 20; i++) queue.enqueue('upsert', note(`n${i}`));
    await queue.flush();

    expect(puts).toHaveLength(1);
    expect(puts[0]).toHaveLength(20);
    expect(queue.size()).toBe(0);
  });

  it('同一 id 先 upsert 后 delete：只发删除，不写脏数据', async () => {
    const { io, puts, dels } = makeIO();
    const queue = createWriteQueue(io);

    queue.enqueue('upsert', note('a'));
    queue.enqueue('delete', 'a');
    await vi.advanceTimersByTimeAsync(400);

    expect(puts).toHaveLength(0);
    expect(dels).toEqual([['a']]);
  });

  it('flush 期间新入队的不丢，落在下一批', async () => {
    const puts: NoteRecord[][] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = createWriteQueue({
      putNotes: async (records) => {
        await gate; // 把这一批"卡在写库中"，制造真实的并发窗口
        puts.push(records);
      },
      delNotes: async () => undefined,
      savePrefs: async () => undefined,
    });

    queue.enqueue('upsert', note('a'));
    const first = queue.flush();
    await Promise.resolve(); // 让批次真正开始，此时还卡在 gate 上

    queue.enqueue('upsert', note('b')); // 写库途中入队
    release();
    await first;
    await queue.flush();

    expect(puts.map((batch) => batch.map((r) => r.id))).toEqual([['a'], ['b']]);
  });

  it('入队存快照：之后改原对象不影响落库内容', async () => {
    const { io, puts } = makeIO();
    const queue = createWriteQueue(io);

    const record = note('a', { x: 1 });
    queue.enqueue('upsert', record);
    record.x = 999; // store 拿的是同一个引用，后续 mutation 会改到它

    await vi.advanceTimersByTimeAsync(400);

    expect(puts[0]?.[0]?.x).toBe(1);
  });

  it('写失败：数据留在队列里，3 秒后自动重试成功', async () => {
    const { io, puts, errors } = makeIO();
    const onError = vi.fn();
    const queue = createWriteQueue(io, { onError });

    errors.push('AbortError'); // 第一次写失败
    queue.enqueue('upsert', note('a'));

    await vi.advanceTimersByTimeAsync(400);
    expect(puts).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith({ kind: 'write', error: expect.anything() });
    expect(queue.size()).toBe(1); // 没丢

    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  it('配额溢出：报告一次后停写，不再无限重试', async () => {
    const { io, puts, errors } = makeIO();
    const onError = vi.fn();
    const queue = createWriteQueue(io, { onError });

    errors.push('QuotaExceededError');
    queue.enqueue('upsert', note('a'));

    await vi.advanceTimersByTimeAsync(400);
    expect(onError).toHaveBeenCalledWith({ kind: 'quota', error: expect.anything() });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(puts).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1); // 刷屏比不提示更糟
  });

  it('prefs 标脏后与 notes 同批落库', async () => {
    const { io, puts, prefsWrites } = makeIO();
    const queue = createWriteQueue(io);

    queue.markPrefsDirty();
    queue.enqueue('upsert', note('a'));

    await vi.advanceTimersByTimeAsync(400);

    expect(puts).toHaveLength(1);
    expect(prefsWrites()).toBe(1);
  });

  it('没有变化时 flush 是空操作（不产生空事务）', async () => {
    const { io, puts, dels, prefsWrites } = makeIO();
    const queue = createWriteQueue(io);

    await queue.flush();

    expect(puts).toHaveLength(0);
    expect(dels).toHaveLength(0);
    expect(prefsWrites()).toBe(0);
  });

  it('onFlushed 只在真有内容落库后触发一次', async () => {
    const { io } = makeIO();
    const batches: { records: number; prefs: boolean }[] = [];
    const queue = createWriteQueue(io, { onFlushed: (info) => batches.push(info) });

    // 空 flush 不该触发（首次持久化申请靠它，空转就是白要权限）
    await queue.flush();
    expect(batches).toHaveLength(0);

    queue.enqueue('upsert', note('a'));
    queue.enqueue('upsert', note('b'));
    await vi.advanceTimersByTimeAsync(400);

    expect(batches).toEqual([{ records: 2, prefs: false }]);
  });
});
