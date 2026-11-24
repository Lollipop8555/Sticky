import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetPrefs, initPrefs, setZCounter } from '@/app/prefs';
import { __resetStore, store } from '@/app/store';
import { toWorld, viewportSize, set as setViewport } from '@/canvas/viewport';
import { DB_NAME, closeDB, migrate, openDB } from '@/storage/db';
import { FALLBACK_PREFS, repo } from '@/storage/repo';
import type { NoteRecord } from '@/storage/types';
import { configureWriteQueue, flush } from '@/storage/writeQueue';
import { collectAssetIds, emptyTrash, gcAssets, listTrash, restoreNote, trashNote } from '@/trash/trash';

function note(id: string, patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    x: 100,
    y: 100,
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

async function wipe(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** 真库 + 真写队列：软删除的正确性全在"谁入队、谁摘内存"上，假队列测不出来 */
async function seed(...records: NoteRecord[]): Promise<void> {
  await repo.putNotes(records);
  store.hydrate(records);
}

describe('trash（废纸篓数据层）', () => {
  beforeEach(async () => {
    await wipe();
    await migrate(await openDB());
    configureWriteQueue({
      putNotes: (records) => repo.putNotes(records),
      delNotes: (ids) => repo.delNotes(ids),
      savePrefs: async () => undefined,
    });
    __resetStore();
    __resetPrefs();
    initPrefs(FALLBACK_PREFS);
    setZCounter(0);
    setViewport({ panX: 0, panY: 0, scale: 1 });
  });

  afterEach(async () => {
    __resetStore();
    await wipe();
  });

  it('trashNote 是软删除：从墙上摘掉，记录带 deletedAt 落库（不是物理删）', async () => {
    await seed(note('a'));

    const trashed = trashNote('a');
    expect(trashed).not.toBeNull();
    expect(trashed?.deletedAt).toBeTypeOf('number');
    expect(store.getNote('a')).toBeUndefined();

    await flush();
    // 这条是关键：废纸篓里能查到，说明记录还在，只是不在墙上
    expect((await repo.loadTrashed()).map((n) => n.id)).toEqual(['a']);
    expect(await repo.loadNotes()).toHaveLength(0);
  });

  it('删不存在的 id 是安全空操作', () => {
    expect(trashNote('nope')).toBeNull();
  });

  it('恢复：原坐标还在视野里 → 原地放回', async () => {
    await seed(note('a', { x: 120, y: 80 }));
    trashNote('a');

    expect(await restoreNote('a')).toBe('restored');

    const back = store.getNote('a');
    expect(back?.x).toBe(120);
    expect(back?.y).toBe(80);
    expect(back?.deletedAt).toBeNull();

    // 恢复也要落库：否则刷新后又回到废纸篓
    await flush();
    expect(await repo.loadTrashed()).toHaveLength(0);
    expect((await repo.loadNotes()).map((n) => n.id)).toEqual(['a']);
  });

  it('恢复：原坐标不在视野里 → 摆到视野中心并置顶（否则用户以为没恢复）', async () => {
    await seed(note('a', { x: 0, y: 0, z: 1 }));
    trashNote('a');

    // 把视野挪到很远，原坐标 (0,0) 已经不在可见范围内
    setViewport({ panX: -5000, panY: -5000, scale: 1 });
    expect(await restoreNote('a')).toBe('relocated');

    const back = store.getNote('a');
    const { width: vw, height: vh } = viewportSize();
    const center = toWorld(vw / 2, vh / 2);
    expect(back?.x).toBe(Math.round(center.x - (back?.width ?? 0) / 2));
    expect(back?.y).toBe(Math.round(center.y - (back?.height ?? 0) / 2));
    expect(back?.deletedAt).toBeNull();
    expect(back?.z).toBe(1); // zCounter 从 0 起步，nextZ 给 1
  });

  it('恢复不存在的 id → missing；重复恢复是幂等的', async () => {
    await seed(note('a'));
    trashNote('a');
    await restoreNote('a');

    expect(await restoreNote('a')).toBe('restored');
    expect(await restoreNote('ghost')).toBe('missing');
  });

  it('listTrash 按删除时间倒序（最近删的在最上面）', async () => {
    await seed(note('old'), note('new'), note('mid'));
    trashNote('old');
    trashNote('new');
    trashNote('mid');

    const rows = await listTrash();
    expect(rows.map((n) => n.id)).toEqual(['mid', 'new', 'old']);
  });

  it('collectAssetIds 只认本库资产路径，外链不当引用', () => {
    const md =
      '![a](assets/11111111-1111-1111-1111-111111111111.webp)\n' +
      '![b](./assets/abc.png)\n' + // 相对写法也算：导入的库可能是这个形态
      '![c](https://x.test/y.png)';
    expect(collectAssetIds(md)).toEqual(['11111111-1111-1111-1111-111111111111', 'abc']);
  });

  it('GC：只回收无人引用的资产，废纸篓里的卡仍然算引用', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await seed(
      note('live', { contentMd: '![a](assets/a.webp)' }),
      note('gone', { contentMd: '![b](assets/b.webp)', deletedAt: 9 }),
    );
    await repo.putAssets([
      { id: 'a', mime: 'image/webp', ext: 'webp', blob, w: 10, h: 10, createdAt: 1 },
      { id: 'b', mime: 'image/webp', ext: 'webp', blob, w: 10, h: 10, createdAt: 1 },
      { id: 'c', mime: 'image/webp', ext: 'webp', blob, w: 10, h: 10, createdAt: 1 },
    ]);

    expect(await gcAssets()).toBe(1);
    expect((await repo.loadAssetsAll()).map((a) => a.id).sort()).toEqual(['a', 'b']);
  });

  it('emptyTrash：删记录，并把只有废纸篓引用的资产一起回收', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await seed(
      note('live', { contentMd: '![a](assets/a.webp)' }),
      note('gone', { contentMd: '![b](assets/b.webp)', deletedAt: 9 }),
    );
    await repo.putAssets([
      { id: 'a', mime: 'image/webp', ext: 'webp', blob, w: 10, h: 10, createdAt: 1 },
      { id: 'b', mime: 'image/webp', ext: 'webp', blob, w: 10, h: 10, createdAt: 1 },
    ]);

    const result = await emptyTrash();
    expect(result).toEqual({ removed: 1, freed: 1 });
    expect(await repo.loadTrashed()).toHaveLength(0);
    // 墙上的卡没事，它的图也没事
    expect((await repo.loadNotes()).map((n) => n.id)).toEqual(['live']);
    expect((await repo.loadAssetsAll()).map((a) => a.id)).toEqual(['a']);
  });

  it('清空空废纸篓不报错、也不碰资产', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await seed(note('live', { contentMd: '![a](assets/a.webp)' }));
    await repo.putAssets([{ id: 'a', mime: 'image/webp', ext: 'webp', blob, w: 1, h: 1, createdAt: 1 }]);

    expect(await emptyTrash()).toEqual({ removed: 0, freed: 0 });
    expect(await repo.loadAssetsAll()).toHaveLength(1);
  });
});
