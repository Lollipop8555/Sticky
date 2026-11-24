/**
 * 帧调度：**按需**跑，不是常驻 60fps。
 *
 * 静态墙上没有任何东西在动，常驻 rAF 会让整个页面永远占一个核。
 * 所以这里是「脏标记 + 一次性帧」：谁改了状态谁 scheduleFrame()，一帧内多次调用只跑一次，
 * 跑完若没人再调度就彻底停下。
 *
 * 需要连续动画的模块（autopan 贴边平移）在自己的帧回调里再调一次 scheduleFrame ——
 * 这就是它自我续命的方式，也让「停」的逻辑只有一个：没人调度就停。
 */

export type FrameFn = (dt: number) => void;

const listeners = new Set<FrameFn>();

let handle = 0;
let last = 0;

/** 单帧最大 dt（秒）：切后台再回来时 dt 会是好几秒，积分会瞬移，必须夹住 */
const MAX_DT = 1 / 30;

function frame(now: number): void {
  handle = 0;
  const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, MAX_DT);
  last = now;

  // 快照：回调里可能 unsubscribe，直接遍历 Set 会漏掉后续项
  for (const fn of [...listeners]) fn(dt);

  if (handle === 0) last = 0; // 队列跑空 → 下次从 1/60 起步
}

/** 幂等：同一帧内多次调用只排一次 */
export function scheduleFrame(): void {
  if (handle !== 0) return;
  if (typeof requestAnimationFrame !== 'function') return; // 非浏览器环境直接不跑
  handle = requestAnimationFrame(frame);
}

export function onFrame(fn: FrameFn): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function stopFrameLoop(): void {
  if (handle !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  handle = 0;
  last = 0;
  listeners.clear();
}
