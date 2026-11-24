import './styles/reset.css';
import './styles/tokens.css';
import './styles/layers.css';
import './styles/note.css';
import './styles/ui.css';

import { commands } from '@/app/commands';
import {
  getPrefs,
  initPrefs,
  rememberSettings,
  rememberViewport,
  setZCounter,
  updatePrefs,
} from '@/app/prefs';
import { resetLocalDataIfRequested } from '@/app/reset';
import { queryShell } from '@/app/shell';
import { store } from '@/app/store';
import { applyBackground, applyPalette, isBackground, isPaletteId } from '@/app/theme';
import { maybeCreateWelcomeNote } from '@/app/welcome';
import { attachGestures } from '@/canvas/gestures';
import { attachInteractions } from '@/canvas/interactions';
import { attachImageDrop } from '@/note/imageNote';
import { attachNoteLayer, repaintMountedNotes } from '@/canvas/noteLayer';
import { attachRender, paint } from '@/canvas/render';
import { fitAll, onChange, restoreViewport, toWorld, viewportSize } from '@/canvas/viewport';
import { parseBundle } from '@/io/bundle';
import {
  describeImportError,
  exportLibraryBundle,
  importLibraryBundle,
  libraryCounts,
  sanitizeSettings,
} from '@/io/importFlow';
import { exportWallPng } from '@/io/png';
import { getEditingId, startEditing, stopEditing } from '@/note/editing';
import { registerServiceWorker, requestPersistentStorage } from '@/pwa';
import { migrate, openDB } from '@/storage/db';
import { FALLBACK_PREFS, repo } from '@/storage/repo';
import type { PrefsRecord, SettingsRecord } from '@/storage/types';
import { attachFlushTriggers, configureWriteQueue } from '@/storage/writeQueue';
import { mountControls, type Controls } from '@/ui/controls';
import { askApplyPrefs, confirmExport, pickZipFile, showImportSummary } from '@/ui/ioDialogs';
import { isTouchDevice, maybeAskMobileMode } from '@/ui/mobilePrompt';
import { mountSettings } from '@/ui/settings';
import { attachShortcuts } from '@/ui/shortcuts';
import { toast } from '@/ui/toast';
import { mountTrashPanel } from '@/ui/trashPanel';

/**
 * boot 序列（impl-00 §7）：
 *   打开库 → 读偏好 → 点主题 → 读便签 → 恢复视野 → 挂渲染/手势/卡片
 *
 * 顺序固定，三个理由：
 * 1. 主题必须在首帧之前定，否则会先闪一下默认底色；
 * 2. 视野必须在 attachRender 之前恢复，否则先画 (0,0) 再跳到目标位置，刷新时能看见一次跳动；
 * 3. 卡片必须在 attachInteractions 之前挂好，否则"双击进编辑"可能打在还不存在的元素上。
 *
 * 整个 boot 是异步的，且每一步都可能失败（Safari 无痕模式、配额已满、库被降级）。
 * 存储不可用不是白屏的理由：降级成内存模式，功能照常，只是不落库。
 */

/** 开发期用 ?bg=blackboard 预览材质；正式的主题切换走设置面板（S7） */
function readOverridesFromUrl(): { bg?: string; palette?: string } {
  const params = new URLSearchParams(window.location.search);
  const bg = params.get('bg');
  const palette = params.get('palette');
  return {
    ...(bg === null ? {} : { bg }),
    ...(palette === null ? {} : { palette }),
  };
}

/**
 * `data-mobile` 同时挂在 `<html>` 和 `#app` 上：
 * - `<html>`：控件与 toast 挂在 body 上（不在 #app 里），选择器必须能一路匹配下来；
 *   `data-background` 也在 `<html>` 上，两者保持同一层，CSS 不用写 `body:has(...)` 这种绕法；
 * - `#app`：记录应用状态本身，e2e 与将来的布局逻辑读它。
 */
function applyMobileFlag(root: HTMLElement): void {
  const flag = getPrefs().mobileMode ? '1' : '0';
  root.dataset['mobile'] = flag;
  document.documentElement.dataset['mobile'] = flag;
}

async function loadPrefsFromDB(): Promise<PrefsRecord> {
  try {
    const db = await openDB();
    await migrate(db);
    return await repo.loadPrefs();
  } catch (error) {
    console.error('[boot] 存储不可用，本次改动不会保存', error);
    return FALLBACK_PREFS;
  }
}

async function boot(): Promise<void> {
  const shell = queryShell();

  // `?reset=1` 必须排在最前：删库要在任何 openDB 之前，否则连接一开就是"删不掉"（决策 66）
  if ((await resetLocalDataIfRequested()) !== 'none') return;

  initPrefs(await loadPrefsFromDB());

  // 写队列必须**先于任何 prefs 写入**就绪：下面的移动模式询问会立刻写 prefs，
  // 而 `updatePrefs` 一律经 markPrefsDirty —— 队列还没配置就会抛错，首次触屏访问直接白屏。
  configureWriteQueue(
    {
      putNotes: (records) => repo.putNotes(records),
      delNotes: (ids) => repo.delNotes(ids),
      savePrefs: () =>
        repo.savePrefs({
          settings: rememberSettings(),
          viewport: getPrefs().lastViewport,
          counters: { zCounter: getPrefs().zCounter },
        }),
    },
    {
      onError: ({ kind, error }) => {
        console.error(`[boot] 写库失败（${kind}）`, error);
        // 静默失败是最糟的一种：用户以为存住了，关掉页面就没了
        toast(kind === 'quota' ? '存储空间已满，最近的改动没能保存' : '保存失败，最近的改动可能丢失');
      },
      // 真的写进去过，才去申请持久化存储（浏览器不会主动给，不申请就可能被清）
      onFlushed: () => requestPersistentStorage(),
    },
  );
  attachFlushTriggers();

  // 移动兼容模式要在**挂载画布之前**问完：先渲染一版桌面尺寸再跳成移动尺寸，用户看到的是闪一下。
  // 只问一次（mobilePromptSeen 落库），桌面设备直接跳过。
  await maybeAskMobileMode(getPrefs(), isTouchDevice());
  applyMobileFlag(shell.root);

  // 预览口只是临时覆盖，不写进 prefs（否则访问一次 ?bg=grid 就永久改了用户设置）
  const overrides = readOverridesFromUrl();
  if (isBackground(overrides.bg)) applyBackground(overrides.bg);
  if (isPaletteId(overrides.palette)) applyPalette(overrides.palette);

  let notes: Awaited<ReturnType<typeof repo.loadNotes>> = [];
  try {
    notes = await repo.loadNotes();
  } catch (error) {
    console.error('[boot] 读取便签失败，按空墙处理', error);
  }

  store.hydrate(notes);
  // zCounter 可能与现有卡片的 z 脱节（导入的库、上个版本没存）：取最大值，
  // 否则"置于顶层"会给出一张比现有卡还低的 z，表现为点了没反应
  for (const note of notes) setZCounter(note.z);

  // 新用户第一次打开：先给一张写着操作说明的示例便签（决策 A6/65）。
  // 必须在 restoreViewport 之前建 —— 视野要按"墙上有这张卡"恢复，
  // 否则先按空墙定下视野、卡片随后才出现，首帧会跳一下。
  maybeCreateWelcomeNote();

  // 先定视野再挂渲染：否则首帧是 (0,0)，随后再跳到恢复位置，能看见一次跳动
  restoreViewport(getPrefs().lastViewport, store.getNotes().values());

  attachRender(shell);
  attachGestures(shell.viewport); // wheelMode 由手势层实时读 prefs，不传快照
  attachNoteLayer(shell); // 卡片落地 + 视口剔除；必须排在 attachRender 之后（剔除要读新视野）
  attachInteractions(shell);
  // 拖图 / 非编辑态粘贴 → 直接建图片便签（编辑中的情况由编辑器自己接）
  attachImageDrop(shell);

  // ---- 控件层（S7）----
  let controls: Controls | null = null;

  /** 设置面板的每次 change 都走这里：先落 prefs，再做只有 main 知道的副作用 */
  function applyPrefPatch(patch: Partial<SettingsRecord>): void {
    const visualChanged = updatePrefs(patch);

    if ('mobileMode' in patch) {
      // 切模式顺手收掉编辑：抽屉式布局会把 Tiptap 的浮动工具顶出屏幕
      if (getEditingId() !== null) stopEditing();
      applyMobileFlag(shell.root);
    }
    // 背景变了，已挂载卡的显示色是派生的，必须整体重算（记录本身不动）
    if (visualChanged) {
      repaintMountedNotes();
      // 网格的对齐变量只在 grid 材质下写（`paint` 里的早退）。切**进** grid 时必须补一帧，
      // 否则格子停在切走时的老位置，直到用户再拖一下才对齐。
      paint(shell);
    }
    controls?.sync();
  }

  /** 导出整库：先确认（说清废纸篓不导出），再打包下载 */
  async function runExport(): Promise<void> {
    settings.close();
    const counts = await libraryCounts();
    if (counts.notes === 0) {
      toast('墙上还没有便签');
      return;
    }
    if (!(await confirmExport(counts))) return;
    await exportLibraryBundle();
  }

  /**
   * 导入整库：先解析（只为看 manifest 里有没有外观设置），再问偏好，最后落库。
   * 三步都可能在用户手里被打断（取消选文件 / 取消询问），所以每一步都显式 return。
   */
  async function runImport(): Promise<void> {
    settings.close();
    const file = await pickZipFile();
    if (!file) return;

    try {
      const parsed = await parseBundle(await file.arrayBuffer());
      const patch = sanitizeSettings(parsed.manifest?.preferences);
      let applyPreferences = false;
      if (patch) {
        const answer = await askApplyPrefs(patch);
        if (answer === null) return; // 关掉询问框 = 放弃导入
        applyPreferences = answer;
      }
      const result = await importLibraryBundle(parsed, { applyPreferences, onPrefs: applyPrefPatch });
      showImportSummary(result);
    } catch (error) {
      console.error('[io] 导入失败', error);
      toast(describeImportError(error));
    }
  }

  const settings = mountSettings({
    getPrefs,
    onPrefs: applyPrefPatch,
    onExportBundle: () => void runExport(),
    onImportBundle: () => void runImport(),
    onExportWall: () => {
      settings.close();
      void exportWallPng();
    },
  });
  // 面板自己读库、自己恢复，main 不需要知道它里面发生了什么
  const trash = mountTrashPanel();

  controls = mountControls(document.body, {
    onCreate: () => {
      const { width, height } = viewportSize();
      const note = commands.create({ world: toWorld(width / 2, height / 2) });
      startEditing(note.id);
    },
    onOverview: () => fitAll(store.getNotes().values()),
    onSettings: () => settings.open(),
    onTrash: () => trash.open(),
  });

  // Esc 只有一个入口：dialog → 拖拽 → 编辑（ui/shortcuts.ts）
  attachShortcuts();

  // 视野变化逐帧发生，落库由 writeQueue 的节流兜住
  onChange((vp) => rememberViewport({ panX: vp.panX, panY: vp.panY, scale: vp.scale }));

  // e2e 用来确认「模块真的执行过」，而不是只渲染了静态 HTML
  shell.root.dataset['booted'] = 'true';
  shell.root.dataset['notes'] = String(store.count());

  // SW 放在最后注册：首屏优先级永远高于"让下次能离线打开"。
  // 失败也不影响本次使用（不是 https / 被策略禁用 / 无痕模式都会失败）。
  registerServiceWorker();
}

boot().catch((error: unknown) => {
  // boot 崩了也要把标记打上：否则 e2e 会一直等 data-booted，报"超时"而不是真正的原因
  console.error('[boot] 启动失败', error);
  document.querySelector('#app')?.setAttribute('data-booted', 'error');
});
