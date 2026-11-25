/**
 * 便签出图（roadmap M3）：单张 → 剪贴板（失败降级下载），整面墙 → 一张大图下载。
 *
 * 两条关键设计：
 * 1. **按 100% 自然比例出图**（interaction-spec §7.3）：画布是按 scale 缩放的，
 *    直接对屏幕上的元素快照会得到"用户当前看到的像素"；这里另起一个离屏舞台，
 *    卡片按 record 的宽度摆好、缩放重置为 1，出图尺寸只跟便签尺寸有关。
 * 2. `modern-screenshot` 走**动态 import**：它只在点"复制为图片"时才被下载，
 *    首屏包不该为一个月用一次的功能付 30KB。
 */

import { getPrefs } from '@/app/prefs';
import { store } from '@/app/store';
import { activeBackground, CANVAS_THEME_COLOR } from '@/app/theme';
import { settleImages } from '@/assets/inline';
import { t } from '@/i18n';
import { copyPngWhenReady, downloadBlob, safeFileName } from '@/io/clipboard';
import { appendWatermark } from '@/io/watermark';
import { createNoteEl, renderNoteBody } from '@/note/NoteCard';
import { displayColor, textColor } from '@/note/palette';
import { trashSummary } from '@/trash/summary';
import type { NoteRecord } from '@/storage/types';
import { toast } from '@/ui/toast';

/** 导出分辨率：2 倍刚好在 Retina 上不糊，再高剪贴板里会被不少应用二次压缩 */
const PIXEL_RATIO = 2;
/** 整墙出图的单边上限：超过这个尺寸，很多看图软件会直接打不开 */
const MAX_SIDE = 4096;
/** 墙四周留白：卡片贴着边裁看起来像被切掉了 */
const WALL_PADDING = 48;

interface Staged {
  node: HTMLElement;
  width: number;
  height: number;
  dispose: () => void;
}

/**
 * 水印文案（决策 88）：关着就返回 null，调用方据此决定铺不铺。
 * 开关打开但文字空着，回落到应用名 —— 否则"开了水印却什么都没出现"更像坏了。
 */
function watermarkText(): string | null {
  const prefs = getPrefs();
  if (!prefs.watermarkOn) return null;
  return prefs.watermarkText.trim() || t('watermark.fallback');
}

/** 离屏舞台：卡片必须在文档里才有布局（getBoundingClientRect / 字体 / CSS 变量才生效） */
function makeStage(): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'export-stage';
  document.body.append(stage);
  return stage;
}

async function snapshot(node: HTMLElement, width: number, height: number, scale: number, background: string | null): Promise<Blob> {
  const { domToBlob } = await import('modern-screenshot');
  const blob = await domToBlob(node, {
    width,
    height,
    scale,
    backgroundColor: background,
    // 卡片圆角之外的区域保持透明：贴进文档里不会带一个白底板
    type: 'image/png',
  });
  if (!blob) throw new Error('snapshot returned nothing');
  return blob;
}

/** 单张：另起舞台，保证与画布缩放无关 */
async function stageNote(note: NoteRecord): Promise<Staged & { blob: () => Promise<Blob> }> {
  const stage = makeStage();
  const el = createNoteEl(note);
  el.classList.add('note-export');
  // 定位归零：舞台里只应该有这一张卡，保留 --x/--y 会把它推到几千像素外
  el.style.setProperty('--x', '0');
  el.style.setProperty('--y', '0');
  renderNoteBody(el, note.contentMd);
  stage.append(el);

  await settleImages(el);

  // 出图尺寸取实测：md 渲染出来的内容高度才是"这张卡真实的长相"
  const width = Math.max(60, Math.ceil(el.offsetWidth) || note.width);
  const height = Math.max(60, Math.ceil(el.offsetHeight) || note.height);

  // 水印叠在卡内最上层（z-index 2 > 格式条的 1）：单卡图就是这张卡，圆角外不该有字
  const mark = watermarkText();
  if (mark) {
    appendWatermark(
      el,
      { text: mark, width, height, ink: textColor(displayColor(note.bgColor, activeBackground())) },
      2,
    );
  }

  return {
    node: el,
    width,
    height,
    dispose: () => stage.remove(),
    blob: () => snapshot(el, width, height, PIXEL_RATIO, null),
  };
}

export async function noteToPng(note: NoteRecord): Promise<Blob> {
  const staged = await stageNote(note);
  try {
    return await staged.blob();
  } finally {
    staged.dispose();
  }
}

/** 卡上的"复制为图片"：先试剪贴板，不行就下载 —— 两条路都要给用户一个明确的回执 */
export async function exportNoteImage(noteId: string): Promise<void> {
  const note = store.getNote(noteId);
  if (!note) return;

  // 先把 promise 交出去再 await：复制图片必须在手势有效期内发起（见 copyPngWhenReady）
  const pending = noteToPng(note);
  pending.catch(() => undefined); // 剪贴板路径失败时这里没人接，先兜住

  if (await copyPngWhenReady(pending)) {
    toast(t('toast.copied'));
    return;
  }

  try {
    const blob = await pending;
    const fallback = t('file.noteFallback');
    downloadBlob(blob, `${safeFileName(trashSummary(note.contentMd)[0] ?? '', fallback)}.png`);
    toast(t('toast.copiedFallback'));
  } catch (error) {
    console.error('[png] 出图失败', error);
    toast(t('toast.renderFailed'));
  }
}

/** 整面墙一张图：按所有便签的包围盒摆一遍，超过上限就等比缩小 */
export async function exportWallPng(): Promise<void> {
  const notes = [...store.getNotes().values()];
  if (notes.length === 0) {
    toast(t('toast.wallEmpty'));
    return;
  }

  const minX = Math.min(...notes.map((n) => n.x));
  const minY = Math.min(...notes.map((n) => n.y));
  const maxX = Math.max(...notes.map((n) => n.x + n.width));
  const maxY = Math.max(...notes.map((n) => n.y + n.height));
  const contentWidth = maxX - minX + WALL_PADDING * 2;
  const contentHeight = maxY - minY + WALL_PADDING * 2;

  const stage = makeStage();
  const wall = document.createElement('div');
  wall.className = 'export-wall';
  stage.append(wall);

  try {
    for (const note of notes) {
      const el = createNoteEl(note);
      el.classList.add('note-export');
      el.style.setProperty('--x', String(Math.round(note.x - minX + WALL_PADDING)));
      el.style.setProperty('--y', String(Math.round(note.y - minY + WALL_PADDING)));
      renderNoteBody(el, note.contentMd);
      wall.append(el);
    }

    await settleImages(wall);

    // 背景色跟着当前主题走：深色主题下导出白底拼贴图会很刺眼
    const background = getComputedStyle(document.body).backgroundColor || '#f7f5f1';
    const scale = Math.min(PIXEL_RATIO, MAX_SIDE / Math.max(contentWidth, contentHeight));

    // 整墙图一刀切地铺满：墨色按"画布背景"算（卡片颜色各异，跟着单卡会花），
    // z-index 必须压过所有卡片的内联 z（最大几千），不能指望 DOM 顺序
    const mark = watermarkText();
    if (mark) {
      const maxZ = notes.reduce((top, n) => Math.max(top, n.z), 0);
      appendWatermark(
        wall,
        {
          text: mark,
          width: contentWidth,
          height: contentHeight,
          ink: textColor(CANVAS_THEME_COLOR[activeBackground()]),
        },
        maxZ + 1,
      );
    }
    const blob = await snapshot(wall, contentWidth, contentHeight, scale, background);
    downloadBlob(blob, `${t('file.wall')}-${new Date().toISOString().slice(0, 10)}.png`);
    toast(t('toast.exported', { n: notes.length }));
  } catch (error) {
    console.error('[png] 整墙出图失败', error);
    toast(t('toast.renderFailed'));
  } finally {
    stage.remove();
  }
}
