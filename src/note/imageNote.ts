/**
 * 拖进来 / 非编辑态粘贴一张图 → **直接建一张图片便签**（interaction-spec §7.2）。
 *
 * 三条硬规矩：
 * 1. 图片卡不进编辑态、不弹键盘（决策 22/23）：落点就是用户放下的地方，多一步"再点进编辑"是骚扰。
 * 2. 高度按图比例**一次算准**（`卡片宽 * h / w`）：先给 160 再让挂载测量回填，
 *    首帧会看到卡片从一条线弹开；而图片卡的高度在入库那一刻就已经确定了。
 * 3. 编辑中拖图 / 粘贴图**不进这里**：那是"给已有便签插图"，走编辑器自己的 handleDrop/handlePaste。
 */

import { commands } from '@/app/commands';
import { getPrefs } from '@/app/prefs';
import { ingestImageFile } from '@/assets/ingest';
import { toWorld, viewportSize } from '@/canvas/viewport';
import { getEditingId } from '@/note/editing';
import { toast } from '@/ui/toast';

/**
 * 所有便签同宽（决策 23）：图片卡也守这条，宽度跟着偏好走（决策 64 起默认 320），
 * 不按图片比例改宽度 —— 半墙 320、半墙 260 的"同样大小的卡片"会让布局显得很随便。
 */
export function cardWidth(): number {
  return getPrefs().defaultNoteWidth;
}

/** 竖长图的上限：一张 1:5 的长截图不该把墙撑出两屏 */
const IMAGE_CARD_MAX_HEIGHT = 720;
const MIN_CARD_HEIGHT = 160;
/** 一次拖进来的图超过这么多张就先只处理前几张 —— 压缩是串行的，几十张会让页面像卡死 */
const MAX_PER_DROP = 8;
/** 多张图错开落点，避免完全重叠成一张 */
const STACK_OFFSET = 28;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function imageFilesOf(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile).slice(0, MAX_PER_DROP);
}

/** 按比例算卡高：落库的 height 就是最终高度，不靠事后测量 */
export function imageCardHeight(w: number, h: number, width = cardWidth()): number {
  if (!(w > 0) || !(h > 0)) return MIN_CARD_HEIGHT;
  // 上限随宽度走：宽卡放一张 1:2 的竖图不该被裁成 720 以下的两截观感
  const maxHeight = Math.max(IMAGE_CARD_MAX_HEIGHT, width);
  const raw = Math.round((width * h) / w);
  return Math.min(maxHeight, Math.max(MIN_CARD_HEIGHT, raw));
}

/** 逐张入库再建卡。串行是为了保住顺序（并行时谁先压完谁先出现，用户会以为图被换了） */
export async function createImageNotes(files: File[], at: (index: number) => { x: number; y: number }): Promise<number> {
  let created = 0;

  for (const [index, file] of files.entries()) {
    if (index >= MAX_PER_DROP) break;
    try {
      const asset = await ingestImageFile(file);
      const width = cardWidth();
      commands.create({
        world: at(index),
        contentMd: `![](${asset.src})`,
        width,
        height: imageCardHeight(asset.w, asset.h, width),
      });
      created += 1;
    } catch (error) {
      console.error('[image] 建卡失败', error);
      toast(error instanceof Error ? `图片处理失败：${error.message}` : '图片处理失败');
    }
  }

  return created;
}

/**
 * 拖进来的到底是不是文件？—— `dragover` 阶段**必须**看 `dataTransfer.items`：
 * 真实的操作系统拖拽在这一刻 `dataTransfer.files` 是空表（Chrome/Safari/Firefox 一致），
 * 只有 `items` 里能看到 `kind: 'file'` 与 MIME。合成事件的 DataTransfer 两样都有，
 * 所以早先"只读 files"的写法在 e2e 里永远是绿的，真人拖图才暴露：dragover 从不
 * preventDefault，浏览器就把窗口导航成了那个图片文件本身。
 */
function isFileDrag(event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  const items = Array.from(dt.items ?? []);
  if (items.some((item) => item.kind === 'file')) return true;
  if (dt.files.length > 0) return true;
  // 有的浏览器在 dragover 里只给 types（连 kind 都不给），宁可先接住：
  // 真正的过滤放在 drop —— 那时 files 一定是全的。
  return Array.from(dt.types ?? []).includes('Files');
}

function hasImages(event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  const items = Array.from(dt.items ?? []);
  if (items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true;
  if (imageFilesOf(dt.files).length > 0) return true;
  // dragover 里拿不到 MIME 时先按"可能是图"处理（视觉反馈早一点出现不伤任何人）
  return Array.from(dt.types ?? []).includes('Files') && items.every((item) => item.kind !== 'string');
}

/**
 * 接管三件事：往窗口拖图、非编辑态粘贴、拖入时的视觉反馈。
 *
 * 监听挂在 **window** 而不是 #viewport 上：`#viewport` 之外还有控件条、废纸篓锚点、
 * toast 这些浮层，图落在那儿以前既不 preventDefault、也收不到 drop —— 松手就把整个
 * 应用导航走了。拖拽的目标判定不能按 DOM 分家。
 *
 * 返回 detach —— 没有全局单例可躲，测试里换一张页面就该干净地摘掉。
 */
export function attachImageDrop(shell: { root: HTMLElement }): () => void {
  const app = shell.root;

  const onDragOver = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    // 有文件就必须拦住：不 preventDefault 浏览器会拒绝 drop，松手时改成打开这个文件
    event.preventDefault();
    // 编辑中的便签里拖图交给编辑器（handleDrop），画布只负责别让浏览器抢走
    if (getEditingId() !== null) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (hasImages(event)) app.classList.add('is-dropping');
  };

  const onDragLeave = (event: DragEvent): void => {
    // 只有真的离开窗口（relatedTarget 为 null）才收掉反馈；窗口内换目标不算
    if (event.relatedTarget instanceof Node) return;
    app.classList.remove('is-dropping');
  };

  const onDrop = (event: DragEvent): void => {
    app.classList.remove('is-dropping');
    const dt = event.dataTransfer;
    if (!dt) return;
    // 编辑器自己接住了（Tiptap handleDrop 里 preventDefault）→ 不再重复建卡
    if (event.defaultPrevented) return;

    const files = imageFilesOf(dt.files);
    if (files.length === 0) {
      // 不是图片也接住：否则浏览器会把窗口变成这个文件的预览页，墙上的东西全没了
      if (dt.files.length > 0 || Array.from(dt.items ?? []).length > 0) event.preventDefault();
      return;
    }
    event.preventDefault();

    // 编辑态里落在编辑器外面：接住但不建卡（决策 29 只给了"编辑态内插图"与"非编辑态建卡"两条路）
    if (getEditingId() !== null) return;
    // 废纸篓面板是模态的，卡片建在它背后等于凭空消失
    if (event.target instanceof Element && event.target.closest('dialog[open]')) return;

    const origin = toWorld(event.clientX, event.clientY);
    void createImageNotes(files, (index) => ({
      x: origin.x + index * STACK_OFFSET,
      y: origin.y + index * STACK_OFFSET,
    }));
  };

  const onPaste = (event: ClipboardEvent): void => {
    // 编辑态粘贴由编辑器处理；这里只管"在画布上按了 cmd+V"
    if (getEditingId() !== null) return;
    const files = imageFilesOf(event.clipboardData?.files);
    if (files.length === 0) return;
    event.preventDefault();

    // 落点取视口中心：粘贴没有指针位置，中心最符合"我刚复制的东西出现了"
    const size = viewportSize();
    const center = toWorld(size.width / 2, size.height / 2);
    void createImageNotes(files, (index) => ({
      x: center.x + index * STACK_OFFSET,
      y: center.y + index * STACK_OFFSET,
    }));
  };

  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
  document.addEventListener('paste', onPaste);

  return () => {
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
    document.removeEventListener('paste', onPaste);
    app.classList.remove('is-dropping');
  };
}
