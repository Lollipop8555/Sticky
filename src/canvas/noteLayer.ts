/**
 * 便签层：把 store 的变化落到 DOM 上，并按可见性挂载/卸载。
 *
 * 两条独立的输入：
 * 1. `subscribeNotes` 给的"变了哪些" —— 增量 patch，不 diff 全表（拖动一张卡每秒通知几十次）；
 * 2. 每帧一次的剔除 —— 只有视野变了才需要重算，挂在 `onFrame` 上（帧只在有东西动时才被调度）。
 *
 * 剔除与 patch 的配合是关键：**没挂载的卡不需要 patch**。它的记录还在 store 里，
 * 等它滚进视口时 `createNoteEl(record)` 一次性画全，比"先挂上再补差异"更省。
 * 因此 `elements` / `patched` 两张表永远是"已挂载"的子集，同进同出。
 */

import { commands } from '@/app/commands';
import type { AppShell } from '@/app/shell';
import { store } from '@/app/store';
import { applyNoteColors, createNoteEl, destroyNoteEl, patchNoteEl } from '@/note/NoteCard';
import { measureHeight } from '@/note/measure';
import type { NoteRecord } from '@/storage/types';

import { intersects, needsCulling, visibleRect } from './culling';
import { onFrame, scheduleFrame } from './rAF';
import type { Bounds } from './viewport';

const elements = new Map<string, HTMLElement>();
const patched = new Map<string, NoteRecord>();

/**
 * 本会话已经校正过高度的卡。
 * 字体度量与记录里的 `height` 可能差几像素，挂载后量一次修正；
 * 但剔除会让同一张卡反复挂载，若不记住"校正过"，每次滚回来都要强制一次同步布局，
 * 平移时就表现为掉帧。
 */
const corrected = new Set<string>();

export function getMountedNoteEl(id: string): HTMLElement | undefined {
  return elements.get(id);
}

/**
 * 换背景后重刷所有已挂载卡的颜色。
 *
 * 记录里的 `bgColor` 是基色，**显示色是派生的**（tech-design §3.1），所以背景一变
 * 必须整体重算。O(挂载数) 且只在切换材质时发生，未挂载的卡滚回来时自然用新背景。
 */
export function repaintMountedNotes(): void {
  for (const [id, el] of elements) {
    const record = patched.get(id);
    if (record) applyNoteColors(el, record);
  }
}

const MAX_CORRECTION = 2;

export interface NoteLayer {
  detach(): void;
}

export function attachNoteLayer(shell: AppShell): NoteLayer {
  /** 刚挂载、还没量过高度的卡 */
  const pendingCorrection = new Set<string>();
  let correctionHandle = 0;

  /** 正在编辑的卡不参与剔除：卸载就是丢焦点、丢选区，用户会丢掉正在打的字 */
  function isEditing(id: string): boolean {
    return store.getState().editingId === id;
  }

  /** 正在被拖的卡同样不能卸：指针移出窗口时它可能整张在可见带外，卸载就等于"手里一空" */
  function isDragging(id: string): boolean {
    return store.getState().draggingId === id;
  }

  function mount(record: NoteRecord): void {
    const el = createNoteEl(record);
    shell.noteLayer.append(el);
    elements.set(record.id, el);
    patched.set(record.id, record);
    if (!corrected.has(record.id)) pendingCorrection.add(record.id);
    watchImages(record.id, el);
  }

  /**
   * 图片卡的高度是入库时按图比例算的（不含卡内边距），真实高度要等图解码完才定。
   * 图到位后补量一次：差几个像素也写回去，远视角的色块和碰撞框才和实物一致。
   */
  function watchImages(id: string, el: HTMLElement): void {
    const images = el.querySelectorAll<HTMLImageElement>('img.note-img');
    if (images.length === 0) return;

    let waiting = images.length;
    const settle = (): void => {
      waiting -= 1;
      if (waiting > 0) return;
      const live = elements.get(id);
      const record = patched.get(id);
      // 卡可能已经被剔除：那时 patched 里没有它，等下次挂载重来
      if (!live || !record) return;
      commands.setHeight(id, measureHeight(live, record.minHeight), MAX_CORRECTION);
    };

    for (const img of images) {
      // `naturalWidth > 0` 才算真的解码完：只有 data-asset 没有 src 时 complete 也是 true，
      // 这时候量到的是占位块的高度，写回去就把卡片压扁了
      if (img.complete && img.naturalWidth > 0) {
        settle();
        continue;
      }
      img.addEventListener('load', settle, { once: true });
      // **裂图不校正**：错误态的 naturalWidth 是 0，量到的是 48px 占位块。
      // 记录里的高度是入库时按图片真实像素算的，比"量一个加载失败的空框"可信得多；
      // 借错误事件去写高度，等于把一张好端端的图卡永久压成 160（这条路径真的触发过）。
      img.addEventListener(
        'error',
        () => {
          waiting -= 1;
        },
        { once: true },
      );
    }
  }

  function unmount(id: string): void {
    const el = elements.get(id);
    if (!el) return;
    destroyNoteEl(el);
    elements.delete(id);
    patched.delete(id);
    pendingCorrection.delete(id);
  }

  function shouldMount(record: NoteRecord, rect: Bounds | null): boolean {
    if (elements.has(record.id)) return true;
    if (isEditing(record.id) || isDragging(record.id)) return true;
    if (!rect) return true; // 全量路径
    return intersects(rect, record);
  }

  function patch(record: NoteRecord, rect: Bounds | null): void {
    const el = elements.get(record.id);
    if (!el) {
      // 没挂载就不为了 patch 而挂载：等它可见时整张画（见文件头）
      if (shouldMount(record, rect)) mount(record);
      return;
    }
    patchNoteEl(el, record, patched.get(record.id));
    patched.set(record.id, record);
  }

  function mountAll(): void {
    for (const record of store.getNotes().values()) {
      if (elements.has(record.id)) patched.set(record.id, record);
      else mount(record);
    }
  }

  /**
   * 剔除一次。**不重建 DOM**：只做该挂的插入、该卸的移除，
   * 已挂载的卡一个字节都不动 —— 平移时只有进出视口的那几张会触发样式重算。
   *
   * 首帧也走这里：500 张卡时"先全挂上再剔掉"会让启动多出一次 500 个节点的创建。
   */
  function sync(): void {
    const notes = store.getNotes();

    if (!needsCulling(notes.size)) {
      if (elements.size !== notes.size) mountAll(); // 数量回落（清空废纸篓）或首帧
      return;
    }

    const rect = visibleRect();
    for (const record of notes.values()) {
      if (isEditing(record.id) || isDragging(record.id) || intersects(rect, record)) {
        if (!elements.has(record.id)) mount(record);
      } else if (elements.has(record.id)) {
        unmount(record.id);
      }
    }
  }

  /**
   * 图还没到位时量出来的高度是"图还没显示"的高度。
   * 图片便签的高度在**入库那一刻**就按图比例算准了（`imageCardHeight`），
   * 挂载时 blob 还在异步读库、img 还是 0 高，这时测得的值比真值小得多 ——
   * 一旦写回去，卡片就永久缩成一条线，而且越刷新越小。
   */
  function hasPendingImages(el: HTMLElement): boolean {
    for (const img of el.querySelectorAll<HTMLImageElement>('img.note-img')) {
      if (img.dataset['asset'] !== undefined) return true; // 还是 canonical src，没换成 blob URL
      if (!img.complete) return true; // 正在解码
      // `complete && naturalWidth === 0` = 裂图/懒加载还没起来：量到的是占位块，不是内容。
      // 这种卡永远跳过校正，保住入库时按真实像素算好的高度。
      if (img.naturalWidth === 0) return true;
    }
    return false;
  }

  function correctHeights(): void {
    for (const id of pendingCorrection) {
      const el = elements.get(id);
      const record = patched.get(id);
      if (!el || !record) continue;
      if (hasPendingImages(el)) continue; // 图片卡：入库时已经算准，别用半成品布局覆盖它
      // 容差 2px：字体度量差异造成的常数级偏差不值得每次启动都写一遍库
      commands.setHeight(id, measureHeight(el, record.minHeight), MAX_CORRECTION);
      corrected.add(id);
    }
    pendingCorrection.clear();
  }

  /**
   * 量高度会同步触发布局，不能塞进 pointermove 那一帧；
   * 同时一帧内只排一次 —— 平移时每帧都有新卡挂载，不去重就会堆一串 rAF。
   */
  function scheduleCorrection(): void {
    if (pendingCorrection.size === 0 || correctionHandle !== 0) return;
    correctionHandle = requestAnimationFrame(() => {
      correctionHandle = 0;
      correctHeights();
    });
  }

  sync();
  scheduleCorrection();

  const offNotes = store.subscribeNotes((upserts, removed) => {
    for (const id of removed) unmount(id);
    // 一次批量里的可见矩形只算一次：导入 500 张时不该算 500 遍
    const rect = needsCulling(store.count()) ? visibleRect() : null;
    for (const record of upserts) patch(record, rect);
    scheduleCorrection();
  });

  // 剔除排在渲染之后（main.ts 里 attachRender 先于本函数）：它要读**新的** pan/scale
  const offFrame = onFrame(() => {
    sync();
    scheduleCorrection();
  });

  // 编辑态变化会改变"谁免于剔除"，所以要补一帧：退出编辑后那张卡该被剔掉时别拖到下帧
  const offState = store.subscribeState(() => scheduleFrame());

  return {
    detach() {
      offNotes();
      offFrame();
      offState();
      if (correctionHandle !== 0) cancelAnimationFrame(correctionHandle);
      correctionHandle = 0;
      for (const id of [...elements.keys()]) unmount(id);
    },
  };
}
