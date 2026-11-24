/**
 * 卡片相关的指针交互：双击建卡、双击进编辑、点空白保存。
 *
 * Esc 不在这里：它要按 dialog → 拖拽 → 编辑 分层，只能有一个入口（`ui/shortcuts.ts`）。
 * 同一个节点上的两个监听器互相 `stopPropagation` 挡不住 —— 留着就会出现"按一次 Esc 关两样"。
 *
 * 单独成文件而不塞进 gestures.ts：gestures 负责"视口怎么动 + 卡片怎么被搬动"（它必须
 * 独占 pointerdown，长按与平移共用同一段按下状态），这里负责"卡片怎么被创建与编辑"。
 * 两者都监听 viewport，但重叠只在一个点上：拖动结束后可能补一个 `click`，
 * 所以下面用按下/抬起的位移把"拖动画布"从"点空白"里排除掉。
 *
 * 为什么用 `click` 判断"点空白"而不是 pointerdown：
 * 指针按下就退出编辑，会让拖动画布时编辑框突然消失；`click` 只在按下+抬起的落点一致时触发，
 * 天然排除了拖动。
 */

import { commands } from '@/app/commands';
import { getPrefs } from '@/app/prefs';
import type { AppShell } from '@/app/shell';
import { t } from '@/i18n';

import { getEditingId, startEditing, stopEditing } from '@/note/editing';
import { openLightbox } from '@/note/lightbox';
import { exportNoteImage } from '@/io/png';

import { restoreNote, trashNote } from '@/trash/trash';
import { toast } from '@/ui/toast';

import { textReadable } from './lod';
import { get as getViewport, toWorld } from './viewport';

/**
 * 撤销窗口 3 秒（决策 13：删除已是"移入废纸篓"的二次确认，撤销只是顺手补救）。
 * 再长就会盖住下一次操作，再短就点不中 —— 所以明确写死，不跟 toast 的默认值走。
 */
const UNDO_MS = 3000;

export function attachInteractions(shell: AppShell): () => void {
  const noteOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('[data-note-id]');
  };

  /**
   * 按下与抬起的落点差超过它就不算"点击"。
   *
   * `click` 本身只保证按下/抬起在同一元素上，但拖动一旦被手势层接管指针，
   * `mouseup` 会被重定向到 viewport，一次真正的拖动画布也会凑出一个 `click`。
   * 所以这里自己再判一次位移，别让拖动顺手把编辑框关掉。
   */
  const CLICK_SLOP = 4;
  let downAt: { x: number; y: number } | null = null;

  const onDblClick = (event: MouseEvent): void => {
    /*
     * 正文看不见的档位（色块 2 / 聚合 3）不进编辑。
     *
     * 这两档的正文是 `visibility: hidden` 的，进去编辑就是把光标塞进一片看不见的
     * 色块里 —— 用户既不知道自己有没有点中，也看不清自己打的字。长按拖动不受影响，
     * 想改字就先放大到能看见内容（0/1 档）。判定与 `render.ts` 共用同一份 `levelFor`，
     * 不在这里再抄一遍阈值。
     */
    const canEdit = textReadable(getViewport().scale);

    const hit = noteOf(event.target);
    if (hit?.dataset['noteId']) {
      event.preventDefault();
      if (!canEdit) return;
      startEditing(hit.dataset['noteId'], { clientX: event.clientX, clientY: event.clientY });
      return;
    }

    // 只有真正落在空白处才建卡：双击卡片边缘的阴影区域建出一张压住旧卡的新卡会让人莫名其妙
    if (event.target !== shell.viewport && event.target !== shell.world && event.target !== shell.noteLayer) {
      return;
    }
    if (getPrefs().createMode !== 'dblclick') return;

    const world = toWorld(event.clientX, event.clientY);
    const note = commands.create({ world });
    // 建完立刻进编辑：新建卡的目的就是写字，多一次双击纯属浪费。
    // 但在看不见正文的档位上同样要弃权 —— 新卡只有二十几像素宽，进去编辑连插入点都找不着；
    // 卡照建（不吞掉用户的操作），放大后双击即可编辑。
    if (canEdit) startEditing(note.id);
  };

  const onPointerDown = (event: PointerEvent): void => {
    downAt = { x: event.clientX, y: event.clientY };
  };

  const onClick = (event: MouseEvent): void => {
    const moved = downAt ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) : 0;
    downAt = null;
    if (moved > CLICK_SLOP) return; // 拖动画布不是"点空白"

    // 非编辑态单击卡内图片 → 开大图。放在"退出编辑"之前：
    // 点的是图片、本来也不会退出编辑，但顺序反了就会先走 stopEditing 白闪一下
    const img = event.target instanceof Element ? event.target.closest<HTMLImageElement>('img.note-img') : null;
    const canonical = img?.dataset['src'];
    if (img && canonical) {
      openLightbox(canonical, img.alt);
      return;
    }

    if (!getEditingId()) return;
    if (noteOf(event.target)) return; // 点在卡上（包括正在编辑的那张）不退出
    stopEditing();
  };

  /**
   * 卡片上的删除按钮。委托到 noteLayer 上而不是在 NoteCard 里逐个挂：
   * 卡片的 DOM 会随着剔除/恢复到视口反复重建，监听器挂在里面等于给漏挂埋雷。
   *
   * `stopPropagation` 是必须的 —— 否则这次点击还会被下面的 `onClick` 当成"点空白"，
   * 而 onPointerDown 已经记下了一个落点，位移检查也拦不住它。
   */
  const onTrashClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const btn = event.target.closest<HTMLElement>('[data-act="trash"]');
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-note-id]')?.dataset['noteId'];
    if (!id) return;
    event.stopPropagation();

    if (!trashNote(id)) return;
    toast(t('toast.trashed'), {
      // 撤销走"原地放回"：3 秒内视野不会动，restoreNote 自然判定为 inView
      action: {
        label: t('toast.undo'),
        run: () => {
          void restoreNote(id)
            .then((result) => {
              if (result === 'missing') toast(t('trash.gone'));
            })
            .catch((error: unknown) => {
              console.error('[trash] 撤销失败', error);
              toast(t('toast.undoFailed'));
            });
        },
      },
      ms: UNDO_MS,
    });
  };

  /** 卡上"复制为图片"：出图要几百毫秒，先把回执做成 toast，别让用户以为没点上 */
  const onCopyClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const btn = event.target.closest<HTMLElement>('[data-act="copy"]');
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-note-id]')?.dataset['noteId'];
    if (!id) return;
    event.stopPropagation(); // 别再被 onClick 当成"点空白/点图片"
    void exportNoteImage(id);
  };

  shell.viewport.addEventListener('pointerdown', onPointerDown);
  shell.viewport.addEventListener('dblclick', onDblClick);
  shell.viewport.addEventListener('click', onClick);
  shell.noteLayer.addEventListener('click', onTrashClick);
  shell.noteLayer.addEventListener('click', onCopyClick);

  return () => {
    shell.viewport.removeEventListener('pointerdown', onPointerDown);
    shell.viewport.removeEventListener('dblclick', onDblClick);
    shell.viewport.removeEventListener('click', onClick);
    shell.noteLayer.removeEventListener('click', onTrashClick);
    shell.noteLayer.removeEventListener('click', onCopyClick);
  };
}
