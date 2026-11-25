/**
 * 静态骨架引用。
 * index.html 里已经有这三层，这里只做一次查询 + 存在性校验：
 * 缺节点属于「构建/模板被改坏」，应当立刻抛错，而不是留到后面各模块各自 querySelector 拿到 null。
 */

export interface AppShell {
  root: HTMLElement;
  viewport: HTMLElement;
  world: HTMLElement;
  noteLayer: HTMLElement;
  /** 连线叠加层：必须是 #viewport 的直接子元素（层序前提见 layers.css / link.css） */
  linkLayer: SVGSVGElement;
}

const REQUIRED = {
  root: '#app',
  viewport: '#viewport',
  world: '#world',
  noteLayer: '#note-layer',
  linkLayer: '#link-layer',
} as const;

function must<T extends Element>(doc: ParentNode, selector: string): T {
  const el = doc.querySelector<T>(selector);
  if (!el) throw new Error(`[shell] 缺少必需节点 ${selector}`);
  return el;
}

export function queryShell(doc: Document = document): AppShell {
  return {
    root: must<HTMLElement>(doc, REQUIRED.root),
    viewport: must<HTMLElement>(doc, REQUIRED.viewport),
    world: must<HTMLElement>(doc, REQUIRED.world),
    noteLayer: must<HTMLElement>(doc, REQUIRED.noteLayer),
    linkLayer: must<SVGSVGElement>(doc, REQUIRED.linkLayer),
  };
}
