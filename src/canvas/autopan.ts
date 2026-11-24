/**
 * 拖卡贴边自动平移（interaction-spec §2.3）。
 *
 * 只做两件事：
 *   1. `edgeVelocity` —— 纯函数，指针位置 → 世界速度（px/s），可以单测；
 *   2. `createAutoPan` —— 记住指针位置，按 rAF 的 `dt` 积分成一次 `panBy`。
 *
 * **不在 pointermove 里改 pan**。指针贴着边缘不动时不会再有 move 事件，
 * 而"贴住就持续平移"正是这个功能的意义 —— 必须由帧循环驱动。
 */

import { panBy, viewportSize } from './viewport';

/** 触发自动平移的边缘带宽（屏幕像素） */
export const EDGE = 80;
/** 贴死边缘时的最大速度（px/s）。再快就追不上卡片了 */
export const MAX_SPEED = 600;

const ZERO = { x: 0, y: 0 };

/**
 * 单轴归一化位移：0 表示不在边缘带内，±1 表示贴死（甚至越出窗口）。
 * 越界要**夹到 1**，否则鼠标甩出窗口后速度会跟着无限增长。
 *
 * 符号是"**内容**往哪边挪"，不是"指针往哪边推"：
 * 贴近左边缘时用户想看更左边的内容，也就是画面整体右移（pan 变大，见 `toScreen`）。
 * 反过来给会在拖卡时把人往反方向送 —— 贴着右边拖，新内容却从左边钻出来。
 */
function axis(value: number, size: number, edge: number): number {
  if (value < edge) return Math.min((edge - value) / edge, 1);
  if (value > size - edge) return -Math.min((value - (size - edge)) / edge, 1);
  return 0;
}

/**
 * 指针 → 速度向量。对角贴角时按向量长度归一化，
 * 否则斜着拖动会比正着快 √2 倍，手感不一致。
 */
export function edgeVelocity(
  sx: number,
  sy: number,
  vw: number,
  vh: number,
  edge: number = EDGE,
): { x: number; y: number } {
  const vx = axis(sx, vw, edge);
  const vy = axis(sy, vh, edge);
  if (vx === 0 && vy === 0) return ZERO;

  const r = Math.hypot(vx, vy);
  // ^1.5：靠内圈温柔、越贴边越快，线性会让 79px 处也窜出去
  const speed = (MAX_SPEED * Math.pow(Math.min(r, 1), 1.5)) / r;
  return { x: vx * speed, y: vy * speed };
}

export interface AutoPan {
  /** 记录指针屏幕坐标（每次 pointermove 调一次，指针不动时沿用上次的值） */
  update(sx: number, sy: number): void;
  /** 按帧推进；真的平移了返回 true（调用方据此用新 pan 重算卡片位置） */
  tick(dtSeconds: number): boolean;
  stop(): void;
}

export function createAutoPan(): AutoPan {
  let sx = 0;
  let sy = 0;
  let active = false;

  return {
    update(x: number, y: number): void {
      sx = x;
      sy = y;
      active = true;
    },

    tick(dtSeconds: number): boolean {
      // dt<=0 出现在首帧与标签页切回：积分一次会把画布瞬移几百像素
      if (!active || dtSeconds <= 0) return false;

      const { width, height } = viewportSize();
      const v = edgeVelocity(sx, sy, width, height);
      if (v.x === 0 && v.y === 0) return false;

      panBy(v.x * dtSeconds, v.y * dtSeconds);
      return true;
    },

    stop(): void {
      active = false;
    },
  };
}
