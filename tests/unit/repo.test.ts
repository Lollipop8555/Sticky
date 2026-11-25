import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME, closeDB, migrate, openDB } from '@/storage/db';
import { repo } from '@/storage/repo';
import { DEFAULT_PREFS, type NoteRecord } from '@/storage/types';

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
    contentMd: 'hello',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...patch,
  };
}

/** 每个用例一个全新的库：单例会缓存连接，所以必须先关再删 */
async function wipe(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('repo', () => {
  beforeEach(async () => {
    await wipe();
    await migrate(await openDB());
  });

  afterEach(async () => {
    await wipe();
  });

  it('migrate 补齐三行偏好，且可重复执行不产生重复行', async () => {
    const db = await openDB();
    await migrate(db);

    const rows = await db.getAll('prefs');
    expect(rows.map((r) => r.key).sort()).toEqual(['counters', 'settings', 'viewport']);
  });

  it('空库读出的偏好等于默认值', async () => {
    const prefs = await repo.loadPrefs();
    expect(prefs).toEqual(DEFAULT_PREFS); // schemaVersion 由代码写死为当前版本
  });

  it('偏好逐字段回落默认值（老库缺字段是常态）', async () => {
    const db = await openDB();
    // 只写了 background，其余字段一个都没有
    await db.put('prefs', { key: 'settings', value: { background: 'blackboard' } as never });

    const prefs = await repo.loadPrefs();
    expect(prefs.background).toBe('blackboard');
    expect(prefs.palette).toBe(DEFAULT_PREFS.palette);
    expect(prefs.baseFontSize).toBe(DEFAULT_PREFS.baseFontSize);
  });

  it('savePrefs 是局部合并：先后写两个字段不会互相覆盖', async () => {
    // 这正是两次 flush 交错时的场景：各自只想改一个字段
    await repo.savePrefs({ settings: { palette: 'monet' } });
    await repo.savePrefs({ settings: { background: 'grid' } });

    const prefs = await repo.loadPrefs();
    expect(prefs.palette).toBe('monet');
    expect(prefs.background).toBe('grid');
  });

  it('savePrefs 不动未指定的行', async () => {
    await repo.savePrefs({ viewport: { panX: 10, panY: 20, scale: 0.5 } });
    await repo.savePrefs({ settings: { wheelMode: 'zoom' } });

    const prefs = await repo.loadPrefs();
    expect(prefs.lastViewport).toEqual({ panX: 10, panY: 20, scale: 0.5 });
    expect(prefs.wheelMode).toBe('zoom');
  });

  it('loadNotes 只返回墙上的，loadTrashed 只返回废纸篓里的', async () => {
    await repo.putNotes([note('live'), note('gone', { deletedAt: 123 })]);
    await repo.putNotes([note('gone2', { deletedAt: 456 })]);

    expect((await repo.loadNotes()).map((n) => n.id)).toEqual(['live']);
    // IDB 索引不容纳 null，所以这条索引天然只覆盖已删的
    expect((await repo.loadTrashed()).map((n) => n.id).sort()).toEqual(['gone', 'gone2']);
  });

  it('putNotes 同一 id 覆盖，delNotes 真删', async () => {
    await repo.putNotes([note('a', { x: 5 })]);
    await repo.putNotes([note('a', { x: 42 })]);
    expect((await repo.loadNotes())[0]?.x).toBe(42);

    await repo.delNotes(['a']);
    expect(await repo.loadNotes()).toHaveLength(0);
  });

  it('读出来的是副本：改内存对象不会"假装"已经入库', async () => {
    await repo.putNotes([note('a', { x: 1 })]);

    const first = await repo.loadNotes();
    if (first[0]) first[0].x = 999;
    const second = await repo.loadNotes();

    expect(second[0]?.x).toBe(1);
  });

  it('links 行：写入后读回，读时排序归一、自连与重复丢弃', async () => {
    // 故意写脏：反向对、自连、重复项 —— 落库不管，读的时候统一洗
    await repo.savePrefs({
      links: [
        ['b', 'a'],
        ['a', 'a'],
        ['a', 'b'],
        ['c', 'b'],
      ] as const,
    });

    const prefs = await repo.loadPrefs();
    expect(prefs.links).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });

  it('links 行可以写成空数组（清空连线），且老库没有这一行时是空边集', async () => {
    expect((await repo.loadPrefs()).links).toEqual([]);

    await repo.savePrefs({ links: [['a', 'b']] as const });
    await repo.savePrefs({ links: [] });
    expect((await repo.loadPrefs()).links).toEqual([]);
  });

  it('links 行被写坏时回落空边集，不影响其他偏好', async () => {
    const db = await openDB();
    await db.put('prefs', { key: 'links', value: 'not-an-array' as never });
    await db.put('prefs', { key: 'settings', value: { wheelMode: 'zoom' } as never });

    const prefs = await repo.loadPrefs();
    expect(prefs.links).toEqual([]);
    expect(prefs.wheelMode).toBe('zoom');
  });

  it('assets 存取（图片便签要用 w/h 免解 Blob）', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await repo.putAssets([
      { id: 'img1', mime: 'image/png', ext: 'png', blob, w: 800, h: 600, createdAt: 7 },
    ]);

    const all = await repo.loadAssetsAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.w).toBe(800);
    expect((await repo.getAsset('img1'))?.ext).toBe('png');
  });
});
