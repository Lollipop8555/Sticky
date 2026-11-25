/**
 * 连线绘制：一个 SVG 组，世界坐标几何 + 一个 transform。
 *
 * 层级（改之前先看）：`#link-layer` 是 `#viewport` 的直接子元素、`z-index: 1`，
 * 所以线始终在便签之上；`.world` 的 `will-change: transform` 把卡片的 `record.z`
 * 封在自己的层叠上下文里，卡片怎么翻都盖不住线（决策 74）。
 *
 * 为什么每帧全量核对而不是事件驱动增量：
 * 端点变成了一条"记录坐标的函数"，拖动、缩放、剔除、恢复都在改这个函数的输入。
 * 事件驱动要覆盖四条路径才能不漏，而这里每帧按 id 查一次记录（O(1) × 2）就够了，
 * 且写属性前先比对上次的值 —— 静止时没有任何写入。
 */

import type { AppShell } from '@/app/shell';
import { store } from '@/app/store';
import { activeBackground } from '@/app/theme';
import { onFrame, scheduleFrame } from '@/canvas/rAF';
import { get as getViewport, onChange as onViewportChange } from '@/canvas/viewport';
import { displayColor, threadColor } from '@/note/palette';

import { anchorOf, type Point } from './geometry';
import { linkIndex, onLinksChange } from './state';

const NS = 'http://www.w3.org/2000/svg';

/** 圆点半径（世界单位）：随缩放走，和便签一起变小 */
const DOT_R = 4.5;

interface Geom {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c1: string;
  c2: string;
}

interface EdgeView {
  path: SVGPathElement;
  grad: SVGLinearGradientElement;
  stops: readonly [SVGStopElement, SVGStopElement];
  /** 上次写进去的值；相同就整段跳过，静止时零写入 */
  geom: Geom | null;
}

interface DotView {
  circle: SVGCircleElement;
  at: (Point & { fill: string }) | null;
}

function make<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return doc.createElementNS(NS, tag) as SVGElementTagNameMap[K];
}

export function attachLinkPaint(shell: AppShell, doc: Document = document): () => void {
  const svg = shell.linkLayer;
  const found = svg.querySelector<SVGGElement>('g.link-view');
  if (!found) throw new Error('[link] 缺少 <g class="link-view">');
  // 显式标注而不是依赖 CFA：narrowing 不跨闭包，下面的 draw/ createEdge 里会被判回 null
  const group: SVGGElement = found;

  const existing = svg.querySelector<SVGDefsElement>('defs');
  const defs: SVGDefsElement = existing ?? make(doc, 'defs');
  if (!existing) svg.insertBefore(defs, group);

  const edges = new Map<string, EdgeView>();
  const dots = new Map<string, DotView>();
  /** 渐变 id 用自增序号：uuid 里既有 `-` 又有 `|`，不适合直接拼进 url(#…) */
  let seq = 0;

  function createEdge(key: string): EdgeView {
    seq += 1;
    const gradId = `link-grad-${seq}`;

    const grad = make(doc, 'linearGradient');
    grad.id = gradId;
    // 必须 userSpaceOnUse：水平线的 bbox 高度是 0，objectBoundingBox 渐变会整条失效
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    const s1 = make(doc, 'stop');
    s1.setAttribute('offset', '0');
    const s2 = make(doc, 'stop');
    s2.setAttribute('offset', '1');
    grad.append(s1, s2);
    defs.append(grad);

    const path = make(doc, 'path');
    path.setAttribute('class', 'link');
    path.setAttribute('stroke', `url(#${gradId})`);
    // 线画在圆点下面：端点圆要盖住线的端头，否则会看到一个"半圆"
    group.append(path);

    const view: EdgeView = { path, grad, stops: [s1, s2], geom: null };
    edges.set(key, view);
    return view;
  }

  function draw(): void {
    const view = getViewport();
    const transform = `translate(${view.panX} ${view.panY}) scale(${view.scale})`;
    if (group.getAttribute('transform') !== transform) group.setAttribute('transform', transform);

    const bg = activeBackground(doc);
    const live = new Set<string>();
    /** 一张卡一个圆点：两端同色的重复节点视觉完全一样，没必要画两遍 */
    const wantDots = new Map<string, Point & { fill: string }>();

    for (const [a, b] of linkIndex().pairs()) {
      const noteA = store.getNote(a);
      const noteB = store.getNote(b);
      const key = `${a}|${b}`;

      // 软删后记录直接从 store 摘掉（detach），这里读不到就跳过；
      // 节点先留着不拆 —— 恢复便签时下一帧就能亮回来，重建反而要重新分配渐变 id
      if (!noteA || !noteB) {
        edges.get(key)?.path.style.setProperty('display', 'none');
        continue;
      }

      live.add(key);
      const edge = edges.get(key) ?? createEdge(key);
      edge.path.style.removeProperty('display');

      const from = anchorOf(noteA);
      const to = anchorOf(noteB);
      // 两端各取自己卡片的"毛线色"：色相跟着卡片走，线才有渐变；用 textColor 会是同一支墨
      const c1 = threadColor(displayColor(noteA.bgColor, bg), bg);
      const c2 = threadColor(displayColor(noteB.bgColor, bg), bg);

      const last = edge.geom;
      if (
        !last ||
        last.x1 !== from.x ||
        last.y1 !== from.y ||
        last.x2 !== to.x ||
        last.y2 !== to.y ||
        last.c1 !== c1 ||
        last.c2 !== c2
      ) {
        edge.path.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
        edge.grad.setAttribute('x1', String(from.x));
        edge.grad.setAttribute('y1', String(from.y));
        edge.grad.setAttribute('x2', String(to.x));
        edge.grad.setAttribute('y2', String(to.y));
        const [s1, s2] = edge.stops;
        s1.setAttribute('stop-color', c1);
        s2.setAttribute('stop-color', c2);
        edge.geom = { x1: from.x, y1: from.y, x2: to.x, y2: to.y, c1, c2 };
      }

      wantDots.set(a, { ...from, fill: c1 });
      wantDots.set(b, { ...to, fill: c2 });
    }

    // 边被断开 / 两端都没了：拆掉节点与渐变，别留死 defs
    for (const [key, edge] of edges) {
      if (live.has(key)) continue;
      edge.path.remove();
      edge.grad.remove();
      edges.delete(key);
    }

    for (const [id, want] of wantDots) {
      let dot = dots.get(id);
      if (!dot) {
        const circle = make(doc, 'circle');
        circle.setAttribute('class', 'link-dot');
        circle.setAttribute('r', String(DOT_R));
        // 后插：圆点永远压在线上面（DOM 顺序即绘制顺序）
        group.append(circle);
        dot = { circle, at: null };
        dots.set(id, dot);
      }
      const at = dot.at;
      if (!at || at.x !== want.x || at.y !== want.y || at.fill !== want.fill) {
        dot.circle.setAttribute('cx', String(want.x));
        dot.circle.setAttribute('cy', String(want.y));
        dot.circle.setAttribute('fill', want.fill);
        dot.at = { x: want.x, y: want.y, fill: want.fill };
      }
    }

    for (const [id, dot] of dots) {
      if (wantDots.has(id)) continue;
      dot.circle.remove();
      dots.delete(id);
    }
  }

  const offFrame = onFrame(draw);
  // 四类输入：记录坐标（拖动/新建/软删）、视野、边集、以及主题换色后的重绘
  const offNotes = store.subscribeNotes(() => scheduleFrame());
  const offViewport = onViewportChange(() => scheduleFrame());
  const offLinks = onLinksChange(() => scheduleFrame());

  scheduleFrame();

  return () => {
    offFrame();
    offNotes();
    offViewport();
    offLinks();
  };
}
