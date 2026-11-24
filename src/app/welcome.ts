/**
 * 首访的示例便签（决策 A6 / 65）。
 *
 * 空画布对新用户是零信息：没有任何可点的东西，也没告诉你怎么开始。所以第一次打开时
 * 在**视口正中**放一张写着操作说明的便签，看完随手删掉即可。
 *
 * 只放一次：`prefs.onboarded` 落库。用户把它删了、或者自己清空了墙，都不该再冒出来
 * （每次开空墙都塞一张提示卡，等于把"我删干净了"这件事一直撤销）。
 */

import { store } from '@/app/store';
import { toWorld, viewportSize } from '@/canvas/viewport';

import { commands } from './commands';
import { getPrefs, updatePrefs } from './prefs';

/**
 * 内容只用 md 里**确定支持**的语法（粗体 / 行内代码 / 有序无序列表）：
 * 标题、引用、代码块都不在 schema 里，写进去会整卡退化成纯文本（见 `note/markdown.ts`）。
 * 列表项之间不能有空行 —— 那就成了"松散列表"，一张卡能多占一屏。
 */
export const WELCOME_MD = `**欢迎来到便签墙**

- **双击空白处**：新建一张便签
- **双击便签**：编辑文字
- **长按便签再拖**：挪动位置
- **拖空白处 / 滚轮**：平移画布
- **⌘ + 滚轮 / 双指捏合**：缩放
- 右下角 \`+\` 新建，**概览** 一次看全，**设置** 换材质与配色

这张便签看完就可以删掉。`;

/**
 * 需要时建一张示例便签，返回它（不需要时返回 null）。
 *
 * 调用点必须在 `store.hydrate` 之后、`restoreViewport` 之前：
 * 视野要按"墙上有这张卡"来恢复，否则先按空墙定视野、卡片随后才出现，首帧会跳一下。
 */
export function maybeCreateWelcomeNote(): ReturnType<typeof commands.create> | null {
  const prefs = getPrefs();
  // 已经见过就别再放。注意：老库没有这个字段时 `loadPrefs` 会兜成 true，
  // 所以走不到这里 —— "升级后凭空多一张卡"被挡在库那一层。
  if (prefs.onboarded) return null;

  // 墙上有东西（导入的库、另一个标签页刚建的卡）就不是新用户，只把标记补上
  if (store.count() > 0) {
    updatePrefs({ onboarded: true });
    return null;
  }

  const { width, height } = viewportSize();
  const note = commands.create({
    world: toWorld(width / 2, height / 2),
    contentMd: WELCOME_MD,
  });
  // 与建卡同一个节拍落库：用户看到卡就立刻关页面，下次不该再来一张
  updatePrefs({ onboarded: true });
  return note;
}
