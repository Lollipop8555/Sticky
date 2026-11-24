/**
 * IndexedDB 打开与版本升级。
 *
 * openDB 是**幂等单例**：boot 调一次，repo 内部也调，拿到的永远同一个连接。
 * 反复 open 会多出一条连接，升级时就会自己 block 自己（表现为永久卡住）。
 */

import { openDB as idbOpen, type DBSchema, type IDBPDatabase } from 'idb';

import {
  DEFAULT_SETTINGS,
  DEFAULT_VIEWPORT,
  SCHEMA_VERSION,
  type AssetRecord,
  type NoteRecord,
  type PrefsRow,
} from './types';

export const DB_NAME = 'sticky-wall';

/**
 * prefs 用 keyPath 'key' 存三行；notes 的 deletedAt 索引刻意不带 null：
 * IDB 索引不容纳 null，所以 `index('by-deletedAt').getAll()` 天然只拿到废纸篓里的记录。
 */
export interface StickyDB extends DBSchema {
  notes: {
    key: string;
    value: NoteRecord;
    indexes: { 'by-deletedAt': number; 'by-updatedAt': number };
  };
  assets: {
    key: string;
    value: AssetRecord;
    indexes: { 'by-createdAt': number };
  };
  prefs: {
    key: string;
    value: PrefsRow;
  };
}

let singleton: Promise<IDBPDatabase<StickyDB>> | null = null;

export function openDB(name: string = DB_NAME): Promise<IDBPDatabase<StickyDB>> {
  if (singleton) return singleton;

  singleton = idbOpen<StickyDB>(name, SCHEMA_VERSION, {
    upgrade(db) {
      // v1 是首版：建表即迁移。以后加字段/索引在 oldVersion 分支里补，不要重建表。
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('by-deletedAt', 'deletedAt');
        notes.createIndex('by-updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('assets')) {
        const assets = db.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('by-createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs', { keyPath: 'key' });
      }
    },
    blocked() {
      // 另一个标签页还开着旧版本：不弹窗、不重试，否则会在这里打转
      console.warn('[db] 升级被其它标签页阻塞，请关闭其它窗口后刷新');
    },
    blocking() {
      // 本页是"旧版本"占着连接：主动关掉，让新页能升级
      void closeDB();
    },
  });

  // 打开失败不要把失败的 promise 留在单例里，否则后续调用永远拿到同一个失败
  singleton.catch(() => {
    singleton = null;
  });

  return singleton;
}

/**
 * 迁移入口。v1 是首版，所以这里没有真正的迁移代码，只做一件事：
 * **把缺失的 prefs 行补齐**（首次打开时库里是空的）。
 *
 * 为什么值得单独做：补完之后 DevTools 里永远能看到三行完整的偏好，
 * 排查"设置没生效"时可以直接看库，而不用猜是不是读到了默认值。
 */
export async function migrate(db: IDBPDatabase<StickyDB>): Promise<void> {
  const tx = db.transaction('prefs', 'readwrite');
  const store = tx.objectStore('prefs');

  const row = await store.get('settings');
  const settings = row?.key === 'settings' ? row.value : null;
  if (!settings) {
    // 没有 settings 行 = 全新库：`onboarded` 保持默认 false，首访才有示例便签（决策 65）
    await store.put({ key: 'settings', value: { ...DEFAULT_SETTINGS } });
  } else if (typeof settings.onboarded !== 'boolean') {
    // 老库（本字段出现之前建的）：当成"已经见过"。否则升级后空墙上会凭空多一张欢迎卡
    await store.put({ key: 'settings', value: { ...settings, onboarded: true } });
  }
  if (!(await store.get('viewport'))) {
    await store.put({ key: 'viewport', value: { ...DEFAULT_VIEWPORT } });
  }
  if (!(await store.get('counters'))) {
    await store.put({ key: 'counters', value: { zCounter: 0 } });
  }

  await tx.done;
}

export async function closeDB(): Promise<void> {
  const pending = singleton;
  singleton = null;
  if (!pending) return;
  try {
    const db = await pending;
    db.close();
  } catch {
    // 本来就没打开成功，无需处理
  }
}
