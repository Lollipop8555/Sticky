/**
 * 库的读写门面。**只有这里碰 IDB 事务**，上层（store / commands / writeQueue）只调这几个方法。
 *
 * 一条硬规矩：读出来的对象都是**新对象**，不回传缓存引用。
 * IDB 本就按结构化克隆交出副本，这里保持同一语义，避免上层拿到引用后改内存却没入库，
 * 表现为"这行改了但刷新就没了"这种最难查的 bug。
 */

import { isLocale } from '@/i18n';
import { normalizeLinks } from '@/link/links';

import { openDB } from './db';
import {
  DEFAULT_PREFS,
  DEFAULT_SETTINGS,
  DEFAULT_VIEWPORT,
  SCHEMA_VERSION,
  type AssetRecord,
  type LinkPair,
  type NoteRecord,
  type PrefsRecord,
  type SettingsRecord,
  type ViewportRecord,
} from './types';

export const repo = {
  /** 只返回墙上的（deletedAt === null）。全表扫一遍：几百张的量级，比维护索引更省心 */
  async loadNotes(): Promise<NoteRecord[]> {
    const db = await openDB();
    const all = await db.getAll('notes');
    return all.filter((n) => n.deletedAt === null);
  },

  /** 废纸篓：靠 by-deletedAt 索引（null 不入索引，所以这里天然只有已删的） */
  async loadTrashed(): Promise<NoteRecord[]> {
    const db = await openDB();
    return db.getAllFromIndex('notes', 'by-deletedAt');
  },

  async loadAssetsAll(): Promise<AssetRecord[]> {
    const db = await openDB();
    return db.getAll('assets');
  },

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    const db = await openDB();
    return db.get('assets', id);
  },

  /**
   * 三行偏好合并成一个对象，且**逐字段回落默认值**。
   * 老版本库缺字段是常态（加字段时不会回填旧行），不回落就会到处是 undefined。
   */
  async loadPrefs(): Promise<PrefsRecord> {
    const db = await openDB();
    const [settings, viewport, counters, links] = await Promise.all([
      db.get('prefs', 'settings'),
      db.get('prefs', 'viewport'),
      db.get('prefs', 'counters'),
      db.get('prefs', 'links'),
    ]);

    const s = settings?.key === 'settings' ? settings.value : DEFAULT_SETTINGS;
    const v = viewport?.key === 'viewport' ? viewport.value : DEFAULT_VIEWPORT;
    const c = counters?.key === 'counters' ? counters.value : { zCounter: 0 };
    // 老库没有这一行（决策 73：不为一行数据升 SCHEMA_VERSION），读不到就是空边集
    const l = links?.key === 'links' ? links.value : [];

    return {
      ...DEFAULT_SETTINGS,
      ...s,
      // 只种了部分字段的行（老库、测试里的局部 seed）留空时按"已经见过"算：
      // 缺字段就把欢迎卡再塞一遍，比"该有的没出现"更烦人
      onboarded: typeof s.onboarded === 'boolean' ? s.onboarded : true,
      // 老库没有 lang：默认中文，不跟着浏览器语言走（用户没在设置里选过，就不该突然变英文）
      lang: isLocale(s.lang) ? s.lang : DEFAULT_SETTINGS.lang,
      // 逐字段收紧：`...s` 只保证"有"，不保证类型对（手工改过的行、早期版本的坏数据）
      watermarkOn: s.watermarkOn === true,
      watermarkText: typeof s.watermarkText === 'string' ? s.watermarkText.slice(0, 40) : '',
      lastViewport: { ...DEFAULT_VIEWPORT, ...v },
      zCounter: Number.isFinite(c?.zCounter) ? c.zCounter : 0,
      // 逐条校验：库里可能躺着早期版本的坏数据或手工改过的行
      links: normalizeLinks(l),
      schemaVersion: SCHEMA_VERSION,
    };
  },

  async savePrefs(patch: {
    settings?: Partial<SettingsRecord>;
    viewport?: ViewportRecord;
    counters?: { zCounter: number };
    links?: readonly LinkPair[];
  }): Promise<void> {
    const db = await openDB();
    const tx = db.transaction('prefs', 'readwrite');

    // 读-改-写放在同一个事务里：两个 flush 交错时不会互相覆盖（跨标签页的整行覆盖由只读互斥拦）
    if (patch.settings) {
      const row = await tx.store.get('settings');
      const base = row?.key === 'settings' ? row.value : DEFAULT_SETTINGS;
      await tx.store.put({ key: 'settings', value: { ...base, ...patch.settings } });
    }
    if (patch.viewport) {
      await tx.store.put({ key: 'viewport', value: patch.viewport });
    }
    if (patch.counters) {
      await tx.store.put({ key: 'counters', value: patch.counters });
    }
    // 空数组也是"有效值"：清空连线必须能写下去，所以判的是 undefined 而不是 length
    if (patch.links) {
      await tx.store.put({ key: 'links', value: [...patch.links] });
    }

    await tx.done;
  },

  async putNotes(records: NoteRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await openDB();
    // 单事务批量：500 条拆成 500 个事务的话，光调度开销就够卡一帧
    const tx = db.transaction('notes', 'readwrite');
    for (const record of records) await tx.store.put(record);
    await tx.done;
  },

  async delNotes(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await openDB();
    const tx = db.transaction('notes', 'readwrite');
    for (const id of ids) await tx.store.delete(id);
    await tx.done;
  },

  async putAssets(records: AssetRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await openDB();
    const tx = db.transaction('assets', 'readwrite');
    for (const record of records) await tx.store.put(record);
    await tx.done;
  },

  async delAssets(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await openDB();
    const tx = db.transaction('assets', 'readwrite');
    for (const id of ids) await tx.store.delete(id);
    await tx.done;
  },
};

export type Repo = typeof repo;

/** 默认偏好（给 boot 在库不可用时兜底，避免上层到处写 `?? {}`） */
export const FALLBACK_PREFS: PrefsRecord = {
  ...DEFAULT_PREFS,
  lastViewport: { ...DEFAULT_VIEWPORT },
};
