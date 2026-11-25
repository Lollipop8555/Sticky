/**
 * 画布手势层：滚轮、单指平移、双指捏合，以及**长按浮起拖卡**。
 *
 * 只有一个 `pointerdown` 入口（impl-02 §1），靠命中判断分流：
 *
 *   [data-grip]         → 立刻浮起（跳过 400ms 的等待，桌面端主要靠它）
 *   [data-no-pan] 控件  → 什么都不做（按钮自己要处理）
 *   [data-note-editor]  → 交给 Tiptap（含编辑区的按下不能变平移）
 *   [data-note-id] 卡片 → 平移 + 排长按计时（拖动超过 6px 就退化为平移）
 *   空白                → 平移
 *
 * 长按为什么也在这儿：长按和"拖动即平移"共用同一段 pointerdown / pointermove。
 * 拆到别的模块去就得两边各存一份按下状态，然后互相打断对方的计时器。
 */

import { commands } from '@/app/commands';
import { getPrefs } from '@/app/prefs';
import { store } from '@/app/store';
import { getLinkingFrom } from '@/link/mode';
import { getEditingId, stopEditing } from '@/note/editing';
import { flush } from '@/storage/writeQueue';

import { createAutoPan } from './autopan';
import { get, panBy, set, toWorld, zoomAt } from './viewport';

/**
 * ctrlKey 的 wheel（触控板捏合就是它）：鼠标一格 deltaY≈100 → ×0.55。
 * 触控板捏合只报 1~10 的小 delta，系数小了根本推不动。
 */
const K_PINCH = 0.006;
/** 显式 `wheelMode: 'zoom'`：普通滚轮缩放，一格只该推一点点 */
const K_WHEEL = 0.0015;
/** deltaMode=1（行）换算成像素；Firefox 滚一格只报 3 行，不换算会慢到像卡住 */
const LINE_HEIGHT = 16;

/**
 * 位移超过它才真正接管指针。
 *
 * 按下就 `setPointerCapture` 看着更"稳"，代价是**后续 mouseup/click/dblclick 的
 * target 全被改写成 viewport**（Chrome 对兼容鼠标事件也做重定向），于是双击卡片
 * 变成"双击空白"—— 凭空多建一张卡。所以捕获推迟到确认是拖动之后。
 */
const PAN_THRESHOLD = 4;

/**
 * 长按开始后，指针移动超过它就认定"用户想拖画布"，撤销长按。
 * 比 PAN_THRESHOLD 大一点：手在触摸屏上按着不动时本来就会抖几个像素。
 */
const MOVE_TOLERANCE = 6;

const LONG_PRESS_DESKTOP = 400;
const LONG_PRESS_MOBILE = 300;

/** 与原版一致的落定动画时长（.is-settling） */
const SETTLE_MS = 140;

export interface GestureOptions {
  /**
   * 滚轮默认行为：平移画布 | 直接缩放（按住 Ctrl/⌘ 与捏合总是缩放）。
   *
   * 不传就读 `prefs.wheelMode` —— 设置里一改必须立刻生效，
   * 而这个层只在 boot 时挂一次，捕获成常量就等于"改完要刷新"。
   */
  wheelMode?: 'pan' | 'zoom';
}

type Mode = 'idle' | 'pan' | 'pinch' | 'locked' | 'drag';

interface Start {
  sx: number;
  sy: number;
  panX: number;
  panY: number;
}

interface Press {
  id: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

interface Drag {
  id: string;
  el: HTMLElement;
  /** 按下点相对卡片左上角的世界偏移；没有它，卡片会在浮起瞬间"跳"到指针中心 */
  grabX: number;
  grabY: number;
  /** 起始坐标：Esc / pointercancel 要能原路退回 */
  originX: number;
  originY: number;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** ±1：同一张卡每次浮起的倾斜方向固定，看起来像"它自己的手感"而不是随机抖动 */
function liftTilt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}

export function attachGestures(
  root: HTMLElement,
  options: GestureOptions = {},
  win: Window = window,
  doc: Document = document,
): () => void {
  const wheelMode = (): 'pan' | 'zoom' => options.wheelMode ?? getPrefs().wheelMode;
  const pointers = new Map<number, { x: number; y: number }>();
  const autopan = createAutoPan();

  let mode: Mode = 'idle';
  let start: Start = { sx: 0, sy: 0, panX: 0, panY: 0 };
  /** 捏合上一帧的两指距离与中点；用增量比值，不用累加，避免舍入堆积 */
  let pinch = { dist: 0, x: 0, y: 0 };
  /** 本次按下是否已接管指针（见 PAN_THRESHOLD 的注释） */
  let captured = false;
  let activePointer: number | null = null;
  /** 最近一次指针屏幕坐标：长按到点时指针早就没再动了，只能靠它 */
  let last = { x: 0, y: 0 };
  let press: Press | null = null;
  let drag: Drag | null = null;
  /** 自动平移的帧循环句柄 */
  let frame = 0;
  let lastFrame = 0;

  function setPanning(on: boolean): void {
    if (on) root.classList.add('is-panning');
    else root.classList.remove('is-panning');
  }

  function capture(pointerId: number): void {
    if (captured) return;
    captured = true;
    activePointer = pointerId;
    try {
      root.setPointerCapture(pointerId);
    } catch {
      // 指针已失效（快速点击后立刻抬起）时某些浏览器会抛，忽略即可
    }
  }

  function releaseCapture(): void {
    const id = activePointer;
    activePointer = null;
    if (id === null) return;
    try {
      if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    } catch {
      // 同上：指针可能已经消失
    }
  }

  function clearPress(): void {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  }

  function reset(): void {
    mode = 'idle';
    pinch = { dist: 0, x: 0, y: 0 };
    captured = false;
    activePointer = null;
    clearPress();
    setPanning(false);
  }

  function startPress(el: HTMLElement, id: string, pointerId: number): void {
    // 连线模式禁拖卡（决策 77）：移动端手指一停就过 400ms，卡片会被拿走，永远点不中目标
    if (getLinkingFrom()) return;
    clearPress();
    const delay = getPrefs().mobileMode ? LONG_PRESS_MOBILE : LONG_PRESS_DESKTOP;
    press = {
      id,
      el,
      timer: setTimeout(() => {
        press = null;
        // 到点时已经不是"单指按着"了：松手、捏合、或者已经开拖
        if (mode !== 'pan' || pointers.size !== 1) return;
        beginDrag(id, el, pointerId);
      }, delay),
    };
  }

  function beginDrag(id: string, el: HTMLElement, pointerId: number): void {
    // 长按计时器可能在"进入连线模式"之前就点着了，到点再挡一次
    if (getLinkingFrom()) return;
    const note = store.getNote(id);
    if (!note) return;

    const editing = getEditingId();
    // 正在编辑的卡不搬：拖它会连 Tiptap 的选区一起拖，看起来像"打字时整张卡乱跑"。
    // 手柄按下也要挡这一层 —— 它绕过了长按判断。
    if (editing === id) return;
    // 编辑中直接拿起另一张卡：先把正在编辑的存了，否则它随 Tiptap 一起销毁
    if (editing !== null) stopEditing();

    clearPress();
    capture(pointerId);
    mode = 'drag';

    const point = toWorld(last.x, last.y);
    drag = {
      id,
      el,
      grabX: point.x - note.x,
      grabY: point.y - note.y,
      originX: note.x,
      originY: note.y,
    };

    // 卡片被"拿起来"了，此刻不该还显示"正在平移画布"的手型
    setPanning(false);
    commands.bringToFront(id);
    store.setState({ draggingId: id });

    el.classList.remove('is-settling');
    el.style.setProperty('--lift-dir', String(liftTilt(id)));
    el.classList.add('is-lifted');

    autopan.update(last.x, last.y);
    if (getPrefs().mobileMode) navigator.vibrate?.(10);
    startLoop();
  }

  function moveDrag(): void {
    if (!drag) return;
    const point = toWorld(last.x, last.y);
    commands.move(drag.id, point.x - drag.grabX, point.y - drag.grabY);
  }

  function endDrag(commit: boolean): void {
    if (!drag) return;
    const { id, el, originX, originY } = drag;
    drag = null;

    stopLoop();
    autopan.stop();
    store.setState({ draggingId: null });
    releaseCapture();

    // Esc / pointercancel 回原位。写队列里最后一次入队的就是原位，
    // 所以"没动过"是自然结果，不必特殊处理持久化（z 提升按规范保留）。
    if (!commit) commands.move(id, originX, originY);

    el.classList.remove('is-lifted');
    el.classList.add('is-settling');
    win.setTimeout(() => el.classList.remove('is-settling'), SETTLE_MS);

    mode = 'idle';
    if (commit) void flush();
  }

  function startLoop(): void {
    if (frame !== 0) return;
    lastFrame = 0;
    const step = (now: number): void => {
      if (mode !== 'drag') {
        frame = 0;
        return;
      }
      // 首帧 dt=0；切回标签页时 dt 可能是几十秒，夹到 50ms，否则一次瞬移几百像素
      const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      // 顺序要紧：先推视野，再按**新** pan 重算卡片位置。
      // 反过来的话卡片永远落后一帧，贴边拖动时看着像"粘在地上又被拽回来"。
      if (autopan.tick(dt)) moveDrag();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function stopLoop(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? LINE_HEIGHT : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    const pinchZoom = event.ctrlKey || event.metaKey;

    if (pinchZoom || wheelMode() === 'zoom') {
      // 指数缩放：放大与缩小对称，来回滚一格误差不累积
      const k = pinchZoom ? K_PINCH : K_WHEEL;
      zoomAt(event.clientX, event.clientY, Math.exp(-dy * k));
      return;
    }
    panBy(-dx, -dy);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (mode === 'drag') return; // 拖着卡时再来一指：不做多选，直接忽略

    last = { x: event.clientX, y: event.clientY };
    const target = event.target instanceof Element ? event.target : null;

    // 手柄必须先于 data-no-pan 判断：手柄就长在工具条里，而工具条整体是 data-no-pan
    const grip = target?.closest<HTMLElement>('[data-grip]');
    if (grip) {
      const noteEl = grip.closest<HTMLElement>('[data-note-id]');
      const id = noteEl?.dataset['noteId'];
      if (noteEl && id) {
        // 手柄上按下不该顺带选中文字或触发兼容鼠标事件
        event.preventDefault();
        beginDrag(id, noteEl, event.pointerId);
      }
      return;
    }

    if (target?.closest('[data-no-pan]')) return;
    if (target?.closest('[data-note-editor]')) return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      const view = get();
      mode = 'pan';
      start = { sx: event.clientX, sy: event.clientY, panX: view.panX, panY: view.panY };
      setPanning(true);

      const noteEl = target?.closest<HTMLElement>('[data-note-id]');
      const id = noteEl?.dataset['noteId'];
      // 编辑中的卡片整个交给 Tiptap：连"编辑器的空白边距"也算内容区
      if (noteEl && id && getEditingId() !== id) startPress(noteEl, id, event.pointerId);
      return;
    }

    if (pointers.size === 2) {
      // 第二指落下：不管是在长按计时中还是在平移，都改判捏合
      clearPress();
      // 捏合没有"确认是拖动"这一步，立刻接管，免得两指移出手势区后丢事件
      capture(event.pointerId);
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      mode = 'pinch';
      pinch = {
        dist: distance(a.x, a.y, b.x, b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    }
  }

  function onPointerMove(event: PointerEvent): void {
    last = { x: event.clientX, y: event.clientY };

    if (mode === 'drag') {
      moveDrag();
      autopan.update(last.x, last.y);
      return;
    }

    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    prev.x = event.clientX;
    prev.y = event.clientY;

    if (mode === 'pan' && pointers.size === 1) {
      const dx = event.clientX - start.sx;
      const dy = event.clientY - start.sy;

      // 长按还没到点就动了：用户想拖画布，撤掉浮起
      if (press && Math.hypot(dx, dy) > MOVE_TOLERANCE) clearPress();

      // 确认是拖动才接管指针：见 PAN_THRESHOLD
      if (!captured && Math.hypot(dx, dy) >= PAN_THRESHOLD) capture(event.pointerId);
      // 绝对锚定（start + 增量）而不是逐次 panBy：丢帧、合并事件都不会累积误差
      set({
        panX: start.panX + dx,
        panY: start.panY + dy,
        scale: get().scale,
      });
      return;
    }

    if (mode === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = distance(a.x, a.y, b.x, b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (pinch.dist > 0 && dist > 0) {
        zoomAt(cx, cy, dist / pinch.dist);
        // 两指一起移动 = 平移，与缩放同一帧发生
        panBy(cx - pinch.x, cy - pinch.y);
      }
      pinch = { dist, x: cx, y: cy };
    }
  }

  function onPointerEnd(event: PointerEvent): void {
    const wasDrag = drag !== null;
    pointers.delete(event.pointerId);

    if (wasDrag) {
      // pointercancel = 浏览器把指针抢走了（系统手势等）：不确认这次移动更安全
      endDrag(event.type !== 'pointercancel');
    }

    if (pointers.size === 0) {
      clearPress();
      if (mode !== 'drag') reset();
      return;
    }
    // 两指捏合里松开一根：剩下的那根继续按平移处理会突然跳一下，所以锁住到全松开
    if (mode === 'pinch') {
      mode = 'locked';
      setPanning(false);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !drag) return;
    // 拖拽与编辑互斥，但别让别处的 Esc 再跑一遍（如未来加的"取消手势"）
    event.stopPropagation();
    endDrag(false);
  }

  function onBlur(): void {
    // 切窗口时 pointerup 可能永远收不到：按"松手落定"收尾，别把卡留在浮起态
    if (drag) endDrag(true);
  }

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('lostpointercapture', onPointerEnd);
  doc.addEventListener('keydown', onKeyDown);
  win.addEventListener('blur', onBlur);

  return () => {
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('lostpointercapture', onPointerEnd);
    doc.removeEventListener('keydown', onKeyDown);
    win.removeEventListener('blur', onBlur);

    stopLoop();
    autopan.stop();
    if (drag) {
      drag.el.classList.remove('is-lifted');
      drag = null;
      store.setState({ draggingId: null });
    }
    pointers.clear();
    reset();
  };
}
