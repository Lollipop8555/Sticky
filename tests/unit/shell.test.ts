import { describe, expect, it, beforeEach } from 'vitest';

import { queryShell } from '@/app/shell';

const MARKUP = `
  <div class="app" id="app">
    <div class="viewport" id="viewport">
      <div class="world" id="world">
        <div class="note-layer" id="note-layer"></div>
      </div>
    </div>
  </div>
`;

describe('queryShell', () => {
  beforeEach(() => {
    document.body.innerHTML = MARKUP;
  });

  it('返回四层节点', () => {
    const shell = queryShell(document);
    expect(shell.root.id).toBe('app');
    expect(shell.viewport.id).toBe('viewport');
    expect(shell.world.id).toBe('world');
    expect(shell.noteLayer.id).toBe('note-layer');
  });

  it('嵌套关系正确：world 在 viewport 内，noteLayer 在 world 内', () => {
    const shell = queryShell(document);
    expect(shell.viewport.contains(shell.world)).toBe(true);
    expect(shell.world.contains(shell.noteLayer)).toBe(true);
  });

  it('缺节点时立刻抛错，而不是返回 null 留到运行时炸', () => {
    document.body.innerHTML = '<div class="app" id="app"></div>';
    expect(() => queryShell(document)).toThrow(/缺少必需节点/);
  });

  it('缺的节点名要出现在错误信息里，便于定位', () => {
    document.body.innerHTML = MARKUP.replace('id="note-layer"', 'id="nope"');
    expect(() => queryShell(document)).toThrow(/#note-layer/);
  });
});
