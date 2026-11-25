/**
 * 连线模式的 HUD（决策 77 改版）：底部"完成"按钮 + 源便签离屏时的边缘方位指引。
 *
 * 不再做底部预览卡：墙上那张源便签留在原地、灰化并发光，本身就是"我在连哪张"。
 * 但它被平移出视口后会连 DOM 一起被剔除；这时候靠 compass 告诉用户
 * "它在那个方向"——箭头指方向，同色圆点用来认卡（和灰化后的卡走同一条配色派生链）。
 */

import type { AppShell } from '@/app/shell';
import { get as getViewport, viewportSize } from '@/canvas/viewport';
import { onLocaleChange, setAria, setText, t } from '@/i18n';
import { applyNoteColors } from '@/note/NoteCard';
import type { NoteRecord } from '@/storage/types';
import { lineIcon } from '@/ui/icons';

/** 指引贴边的内缩：避开左下废纸篓 / 右下控件 / 底部 toast */
const EDGE_INSET = 56;
/** 刚离屏不立刻弹指引：贴边平移时会反复进出，延时压掉这种抖动 */
const SHOW_DELAY_MS = 200;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export interface LinkHud {
  show(note: NoteRecord): void;
  update(note: NoteRecord): void;
  hide(): void;
  /** 每帧更新指引位置；只在模式激活时由 mode.ts 调用 */
  frame(note: NoteRecord): void;
  dispose(): void;
}

export function mountLinkHud(shell: AppShell, onDone: () => void): LinkHud {
  const doc = shell.root.ownerDocument;

  const bar = doc.createElement('div');
  bar.className = 'link-hud';
  bar.dataset['active'] = 'false';
  const hint = doc.createElement('p');
  hint.className = 'link-hud-hint';
  hint.textContent = t('link.modeHint');
  const done = doc.createElement('button');
  done.type = 'button';
  done.className = 'link-hud-done';
  done.append(lineIcon(['M5 13l4 4L19 7']));
  const label = doc.createElement('span');
  setText(label, 'io.done');
  done.append(label);
  setAria(done, 'link.modeDone');
  done.addEventListener('click', onDone);
  bar.append(hint, done);

  const compass = doc.createElement('div');
  compass.className = 'link-compass';
  compass.dataset['active'] = 'false';
  compass.setAttribute('aria-hidden', 'true');
  const arrow = doc.createElement('span');
  arrow.className = 'link-compass-arrow';
  const dot = doc.createElement('span');
  dot.className = 'link-compass-dot';
  compass.append(arrow, dot);

  doc.body.append(bar, compass);

  let active = false;
  let shown = false;
  let timer = 0;

  function cancelPending(): void {
    if (timer === 0) return;
    clearTimeout(timer);
    timer = 0;
  }

  function setShown(next: boolean): void {
    if (shown === next) return;
    shown = next;
    compass.classList.toggle('is-visible', next);
  }

  function fill(note: NoteRecord): void {
    hint.textContent = t('link.modeHint');
    applyNoteColors(dot, note);
  }

  let note: NoteRecord | null = null;
  const offLocale = onLocaleChange(() => {
    const current = note;
    if (active && current) fill(current);
  });

  return {
    show(n) {
      note = n;
      active = true;
      bar.dataset['active'] = 'true';
      compass.dataset['active'] = 'true';
      fill(n);
    },
    update(n) {
      note = n;
      if (active) fill(n);
    },
    frame(n) {
      if (!active) return;

      const { panX, panY, scale } = getViewport();
      const { width: vw, height: vh } = viewportSize();
      const left = n.x * scale + panX;
      const top = n.y * scale + panY;
      const right = left + n.width * scale;
      const bottom = top + n.height * scale;

      const onScreen = left < vw && right > 0 && top < vh && bottom > 0;
      if (onScreen) {
        cancelPending();
        setShown(false);
        return;
      }

      if (!shown && timer === 0) {
        timer = window.setTimeout(() => {
          timer = 0;
          setShown(true);
        }, SHOW_DELAY_MS);
      }

      // 从视口中心朝便签中心射一条线，与内缩矩形求交，得到贴边位置
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const ox = vw / 2;
      const oy = vh / 2;
      let dx = cx - ox;
      let dy = cy - oy;
      if (dx === 0 && dy === 0) dx = 1;

      const minX = EDGE_INSET;
      const maxX = vw - EDGE_INSET;
      const minY = EDGE_INSET;
      const maxY = vh - EDGE_INSET;
      let hit = Infinity;
      if (dx > 0) hit = Math.min(hit, (maxX - ox) / dx);
      else if (dx < 0) hit = Math.min(hit, (minX - ox) / dx);
      if (dy > 0) hit = Math.min(hit, (maxY - oy) / dy);
      else if (dy < 0) hit = Math.min(hit, (minY - oy) / dy);

      compass.style.left = `${clamp(ox + dx * hit, minX, maxX)}px`;
      compass.style.top = `${clamp(oy + dy * hit, minY, maxY)}px`;
      compass.style.setProperty('--angle', `${(Math.atan2(dy, dx) * 180) / Math.PI + 90}deg`);
    },
    hide() {
      cancelPending();
      note = null;
      active = false;
      setShown(false);
      bar.dataset['active'] = 'false';
      compass.dataset['active'] = 'false';
    },
    dispose() {
      cancelPending();
      offLocale();
      bar.remove();
      compass.remove();
    },
  };
}
