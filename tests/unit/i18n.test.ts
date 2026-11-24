import { afterEach, describe, expect, it } from 'vitest';

import {
  applyLocale,
  getLocale,
  htmlLang,
  onLocaleChange,
  setAria,
  setPlaceholder,
  setText,
  setTitle,
  t,
  __resetLocale,
} from '@/i18n';
import { EN, ZH } from '@/i18n/messages';

/**
 * 双语表与运行时（决策 69）。
 *
 * 单测关心的不是"英文翻得对不对"（那要靠人看），而是**结构不会悄悄坏**：
 * 漏键、占位符对不上、英文里夹着中文、切语言把节点换了 —— 这四种都是上线后
 * 只有用户看得见的 bug，编译期抓不到。
 */

afterEach(() => {
  __resetLocale();
  document.body.replaceChildren();
  document.documentElement.lang = '';
  delete document.documentElement.dataset['locale'];
});

const keysOf = (dict: Record<string, string>): string[] => Object.keys(dict).sort();

/** `{n}` 这类占位符的"形状"：中英两版必须一致，否则某一边会原样显示 `{n}` */
const placeholders = (value: string): string =>
  [...value.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');

describe('文案表', () => {
  it('中英键集合完全一致', () => {
    expect(keysOf(EN)).toEqual(keysOf(ZH));
  });

  it('每条文案都有内容，且中英占位符一一对应', () => {
    for (const [key, zh] of Object.entries(ZH)) {
      expect(zh.trim(), key).not.toBe('');
      expect(placeholders(EN[key as keyof typeof EN]), key).toBe(placeholders(zh));
    }
  });

  it('英文里不夹中文（否则说明这条根本没翻）', () => {
    const cjk = /[\u4e00-\u9fff]/;
    const leftovers = Object.entries(EN).filter(([, value]) => cjk.test(value));
    expect(leftovers).toEqual([]);
  });
});

describe('t()', () => {
  it('默认中文', () => {
    expect(getLocale()).toBe('zh');
    expect(t('ctl.settings')).toBe('设置');
  });

  it('按名字插值', () => {
    expect(t('ctl.overviewAria', { n: 3 })).toBe('查看全部（3 张便签）');
    expect(t('toast.exported', { n: 12 })).toBe('已导出 12 张便签');
  });

  it('缺参数时保留占位符，而不是显示 undefined', () => {
    expect(t('ctl.overviewAria')).toBe('查看全部（{n} 张便签）');
  });
});

describe('applyLocale', () => {
  it('切到英文：html lang / data-locale / title 一起走', () => {
    applyLocale('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dataset['locale']).toBe('en');
    expect(document.title).toBe('Sticky Wall');
    expect(htmlLang('zh')).toBe('zh-CN');
  });

  it('已挂载的节点就地换文案：不重建、不丢监听与焦点', () => {
    const button = document.createElement('button');
    setText(button, 'ctl.settings');
    setAria(button, 'ctl.settings');
    setTitle(button, 'ctl.settings');
    const input = document.createElement('input');
    setPlaceholder(input, 'note.placeholder');
    document.body.append(button, input);

    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    applyLocale('en');

    expect(button.textContent).toBe('Settings');
    expect(button.getAttribute('aria-label')).toBe('Settings');
    expect(button.title).toBe('Settings');
    expect(input.placeholder).toBe('Double-click to type…');

    // 还是同一个节点：所以上面挂的监听器仍然有效
    expect(document.body.firstElementChild).toBe(button);
    button.click();
    expect(clicks).toBe(1);

    applyLocale('zh');
    expect(button.textContent).toBe('设置');
    expect(input.placeholder).toBe('双击输入…');
  });

  it('订阅者在每次切换时被调用，解绑后不再调用', () => {
    let calls = 0;
    const off = onLocaleChange(() => {
      calls += 1;
    });

    applyLocale('en');
    expect(calls).toBe(1);

    off();
    applyLocale('zh');
    expect(calls).toBe(1);
  });
});
