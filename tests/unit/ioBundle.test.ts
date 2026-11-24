import 'fake-indexeddb/auto';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetPrefs, initPrefs, nextZ } from '@/app/prefs';
import { __resetStore, store } from '@/app/store';
import { buildBundle, parseBundle } from '@/io/bundle';
import { importLibraryBundle, planImport, sanitizeSettings } from '@/io/importFlow';
import { serializeNote } from '@/io/frontmatter';
import { DB_NAME, closeDB, migrate, openDB } from '@/storage/db';
import { FALLBACK_PREFS, repo } from '@/storage/repo';
import type { AssetRecord, NoteRecord, PrefsRecord } from '@/storage/types';
import { DEFAULT_PREFS } from '@/storage/types';
import { configureWriteQueue, flush } from '@/storage/writeQueue';

/**
 * 整库打包/解包 + 导入编排。这里刻意用**真库 + 真写队列**：
 * 改名、重写引用、zCounter 抬升这些行为一旦错了，用户数据就真的坏了，mock 掉等于不测。
 */

function note(id: string, patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    x: 100,
    y: 120,
    width: 260,
    height: 184,
    minHeight: 160,
    z: 1,
    bgColor: '#FCE7F3',
    contentMd: '',
    createdAt: 1,
    updatedAt: 2,
    deletedAt: null,
    ...patch,
  };
}

function asset(id: string, patch: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id,
    mime: 'image/png',
    ext: 'png',
    blob: new Blob([`img-${id}`], { type: 'image/png' }),
    w: 640,
    h: 480,
    createdAt: 1,
    ...patch,
  };
}

function prefs(): PrefsRecord {
  return { ...DEFAULT_PREFS };
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
});

afterEach(async () => {
  await flush();
  await wipe();
});

describe('buildBundle / parseBundle', () => {
  it('打出来的包：notes/ 每个 md 一个、assets/ 存原图、manifest 带资产索引', async () => {
    const records = [note('a', { contentMd: '看这张\n\n![图](assets/img-1.png)' }), note('b')];
    const assets = new Map([['img-1', asset('img-1')]]);

    const parsed = await parseBundle(await buildBundle(records, (id) => assets.get(id), prefs()));

    expect(parsed.notes.map((n) => n.meta.id)).toEqual(['a', 'b']);
    expect(parsed.assets.size).toBe(1);
    expect(parsed.manifest?.version).toBe(1);
    expect(parsed.manifest?.noteCount).toBe(2);
    expect(parsed.manifest?.assets).toEqual([
      { id: 'img-1', ext: 'png', mime: 'image/png', w: 640, h: 480 },
    ]);
    // 正文（含图片引用）原样回来
    expect(parsed.notes[0]?.contentMd).toBe('看这张\n\n![图](assets/img-1.png)');
  });

  it('资产取不到时跳过图片，不拖垮整包；manifest 的 preferences 只带六个字段', async () => {
    const records = [note('a', { contentMd: '![缺图](assets/gone.png)' })];
    const parsed = await parseBundle(await buildBundle(records, () => undefined, prefs()));

    expect(parsed.notes).toHaveLength(1);
    expect(parsed.assets.size).toBe(0);
    expect(Object.keys(parsed.manifest?.preferences ?? {}).sort()).toEqual([
      'background',
      'baseFontSize',
      'createMode',
      'defaultNoteWidth',
      'palette',
      'wheelMode',
    ]);
  });

  it('坏 manifest 不毁掉整次导入；.DS_Store 之类静默忽略', async () => {
    const zip = new JSZip();
    zip.file('notes/a.md', serializeNote(note('a')));
    zip.file('manifest.json', '{ 这不是 json');
    zip.file('.DS_Store', 'junk');
    // Finder 重新打包的产物：不能被当成"坏便签"统计
    zip.file('__MACOSX/notes/._a.md', 'resource fork');

    const parsed = await parseBundle(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(parsed.manifest).toBeNull();
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.skipped).toBe(0); // 非 md 文件不算"跳过"，那是噪声不是失败
  });

  it('缺 id 的 md 计入 skipped，而不是猜一个 id 进库', async () => {
    const zip = new JSZip();
    zip.file('notes/a.md', serializeNote(note('a')));
    zip.file('notes/b.md', '# 只是一段正文，没有 frontmatter');

    const parsed = await parseBundle(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(parsed.notes).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
  });
});

describe('planImport（改名与清洗规则）', () => {
  it('没有冲突时 id 原样保留，正文一字不动', () => {
    const parsed = {
      notes: [{ meta: { id: 'a', x: 1, y: 2, width: 260, height: 300, minHeight: 160, z: 3, bgColor: '#fff', createdAt: 1, updatedAt: 2 }, contentMd: '正文' }],
      assets: new Map(),
      manifest: null,
      skipped: 0,
    };
    const plan = planImport({ parsed, existingNoteIds: new Set(), existingAssetIds: new Set() });

    expect(plan.notes[0]?.id).toBe('a');
    expect(plan.notes[0]?.contentMd).toBe('正文');
    expect(plan.renamedNotes).toBe(0);
  });

  it('撞 id 依次改成 -1、-2，不覆盖已有记录', () => {
    const meta = { x: 0, y: 0, width: 260, height: 200, minHeight: 160, z: 1, bgColor: '#fff', createdAt: 1, updatedAt: 1 };
    const parsed = {
      notes: [
        { meta: { ...meta, id: 'a' }, contentMd: '' },
        { meta: { ...meta, id: 'a' }, contentMd: '' },
        { meta: { ...meta, id: 'a-1' }, contentMd: '' },
      ],
      assets: new Map(),
      manifest: null,
      skipped: 0,
    };
    const plan = planImport({ parsed, existingNoteIds: new Set(['a']), existingAssetIds: new Set() });

    // 第三个输入的 'a-1' 已经在本批次里被占用，所以继续退到 'a-1-1'
    expect(plan.notes.map((n) => n.id)).toEqual(['a-1', 'a-2', 'a-1-1']);
    expect(plan.renamedNotes).toBe(3);
  });

  it('资产改名后，正文里的引用同步重写成新 id', () => {
    const parsed = {
      notes: [
        {
          meta: { id: 'a', x: 0, y: 0, width: 260, height: 200, minHeight: 160, z: 1, bgColor: '#fff', createdAt: 1, updatedAt: 1 },
          contentMd: '![x](assets/img.1.png) 和 ![y](assets/img.1.webp)',
        },
      ],
      assets: new Map([
        [
          'assets/img.1.png',
          { path: 'assets/img.1.png', id: 'img.1', ext: 'png', blob: new Blob(['x'], { type: 'image/png' }) },
        ],
      ]),
      manifest: null,
      skipped: 0,
    };
    // 撞的是清理后的 id：'img.1' 里的 '.' 会被 safeId 去掉变成 'img1'
    const plan = planImport({ parsed, existingNoteIds: new Set(), existingAssetIds: new Set(['img1']) });

    expect(plan.assets[0]?.id).toBe('img1-1');
    expect(plan.renamedAssets).toBe(1);
    // 引用是"按 id 前缀"重写的：同一个资产换过扩展名也一起改
    expect(plan.notes[0]?.contentMd).toBe('![x](assets/img1-1.png) 和 ![y](assets/img1-1.webp)');
  });

  it('坏几何被夹进合理区间，坏时间回落到当前时间', () => {
    const parsed = {
      notes: [
        {
          meta: {
            id: '../../etc/passwd',
            x: Number.POSITIVE_INFINITY,
            y: -9_999_999,
            width: 100_000,
            height: 1,
            minHeight: 1,
            z: -5,
            bgColor: '  ',
            createdAt: 0,
            updatedAt: Number.NaN,
          },
          contentMd: '',
        },
      ],
      assets: new Map(),
      manifest: null,
      skipped: 3,
    };
    const plan = planImport({ parsed, existingNoteIds: new Set(), existingAssetIds: new Set() });
    const record = plan.notes[0];

    expect(record?.id).toMatch(/^[A-Za-z0-9_-]+$/); // 路径分隔符被清掉
    expect(record?.x).toBe(0);
    expect(record?.y).toBe(-1_000_000);
    expect(record?.width).toBe(640);
    expect(record?.height).toBe(80);
    expect(record?.z).toBe(0);
    expect(record?.bgColor).toBe('yellow');
    expect(record?.createdAt).toBeGreaterThan(0);
    expect(record?.updatedAt).toBeGreaterThan(0);
    expect(plan.skipped).toBe(3);
  });
});

describe('sanitizeSettings', () => {
  it('只保留认识的字段，并把数值夹到允许范围', () => {
    expect(
      sanitizeSettings({
        background: 'grid',
        palette: 'monet',
        defaultNoteWidth: 9999,
        baseFontSize: 2,
        wheelMode: 'pan',
        createMode: 'fab',
        mobileMode: true,
      } as never),
    ).toEqual({
      background: 'grid',
      palette: 'monet',
      defaultNoteWidth: 480,
      baseFontSize: 12,
      wheelMode: 'pan',
      createMode: 'fab',
    });
  });

  it('全是坏值 / 没有 settings → null（不产生空 patch）', () => {
    expect(sanitizeSettings(undefined)).toBeNull();
    expect(sanitizeSettings({ background: 'nope', palette: 'clown' } as never)).toBeNull();
  });
});

describe('importLibraryBundle（真库 round-trip）', () => {
  // 直接传 Blob：jsdom 的 Blob 还没有 arrayBuffer()，而 importLibraryBundle 本来就收 Blob
  async function makeBundle(): Promise<Blob> {
    const records = [
      note('a', { x: 10, y: 20, z: 5, contentMd: '看这张\n\n![图](assets/img-1.png)' }),
      note('b', { z: 9, contentMd: '纯文本' }),
    ];
    const assets = new Map([['img-1', asset('img-1')]]);
    return buildBundle(records, (id) => assets.get(id), prefs());
  }

  it('空库导入：记录、资产都落库，正文引用仍然有效', async () => {
    const result = await importLibraryBundle(await makeBundle());

    expect(result.added).toBe(2);
    expect(result.renamedNotes).toBe(0);
    expect(store.count()).toBe(2);

    const stored = await repo.loadAssetsAll();
    expect(stored.map((a) => a.id)).toEqual(['img-1']);
    expect(stored[0]?.w).toBe(640);

    const a = store.getNotes().get('a');
    expect(a?.contentMd).toContain('assets/img-1.png');
    expect(a?.z).toBe(5);
  });

  it('同一个包导两次：数量翻倍、id 全部改名、资产引用跟着改名后仍然指得到', async () => {
    const data = await makeBundle();
    await importLibraryBundle(data);
    const second = await importLibraryBundle(data);

    expect(second.added).toBe(2);
    expect(second.renamedNotes).toBe(2);
    expect(store.count()).toBe(4);

    const ids = [...store.getNotes().keys()];
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'a-1', 'b-1']));

    const assetIds = new Set((await repo.loadAssetsAll()).map((a) => a.id));
    expect(assetIds).toEqual(new Set(['img-1', 'img-1-1']));

    // 第二份 a 的正文必须指向改名后的图片，否则刷新后就是裂图
    const copy = store.getNotes().get('a-1');
    expect(copy?.contentMd).toContain('assets/img-1-1.png');
    expect(assetIds.has('img-1-1')).toBe(true);
  });

  it('废纸篓里的 id 也参与冲突判定（它们还是同一条记录）', async () => {
    await repo.putNotes([note('a', { deletedAt: 123 })]);
    const result = await importLibraryBundle(await makeBundle());

    expect(result.renamedNotes).toBe(1);
    // 废纸篓里的 'a' 不在墙上，但它占着这个 id，所以导入的那张必须改名
    expect(store.getNotes().has('a')).toBe(false);
    expect(store.getNotes().has('a-1')).toBe(true);
    expect((await repo.loadTrashed()).map((n) => n.id)).toEqual(['a']);
  });

  it('包里的外观默认不应用；勾选后才回调 onPrefs', async () => {
    const data = await makeBundle();

    const kept = await importLibraryBundle(data);
    expect(kept.hasSettings).toBe(true);
    expect(kept.preferencesApplied).toBe(false);

    const applied: unknown[] = [];
    const result = await importLibraryBundle(data, {
      applyPreferences: true,
      onPrefs: (patch) => applied.push(patch),
    });
    expect(result.preferencesApplied).toBe(true);
    expect(applied).toHaveLength(1);
  });

  it('导入后 zCounter 高于包内最大 z：新建的卡一定在最上层', async () => {
    await importLibraryBundle(await makeBundle());
    expect(nextZ()).toBeGreaterThan(9);
  });

  it('包里没有便签时什么都不写，只回报 skipped', async () => {
    const zip = new JSZip();
    zip.file('notes/bad.md', 'no frontmatter here');
    const result = await importLibraryBundle(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.count()).toBe(0);
  });
});
