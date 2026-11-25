import { describe, expect, it } from 'vitest';

import { ANCHOR_INSET, anchorOf } from '@/link/geometry';

/**
 * 锚点必须是"卡片内左上角定点"：只依赖 x/y，
 * 否则正文变长会把所有关联线的端点一起拽走（每改一个字重算一遍）。
 */

describe('anchorOf', () => {
  it('锚点在卡片左上角内缩固定像素处', () => {
    expect(anchorOf({ x: 100, y: 200 })).toEqual({
      x: 100 + ANCHOR_INSET,
      y: 200 + ANCHOR_INSET,
    });
  });

  it('负坐标与小数原样平移，不做取整（取整会让线在缩放下抖）', () => {
    expect(anchorOf({ x: -40.5, y: -12.25 })).toEqual({
      x: -40.5 + ANCHOR_INSET,
      y: -12.25 + ANCHOR_INSET,
    });
  });

  it('只读 x/y：高度与内容怎么变都不影响锚点', () => {
    const at = anchorOf({ x: 0, y: 0 });

    expect(at).toEqual({ x: ANCHOR_INSET, y: ANCHOR_INSET });
  });
});
