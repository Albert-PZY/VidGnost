import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 本项目的语义字号类名，取值定义在 `app/src/globals.css`。
 *
 * tailwind-merge 默认不认识它们：`text-note` 会被当成颜色类，
 * 与 `text-text-muted` 冲突后整条被丢掉，组件基类里的 `text-sm leading-none`
 * 就留了下来——字号悄悄回到 14px，中文字形还会被 `leading-none` 裁掉。
 * 注册进 font-size 组后，「调用处覆盖组件基类」这条规则才真正成立。
 */
const FONT_SIZE_TOKENS = ['micro', 'meta', 'note', 'body', 'lead', 'subhead', 'head', 'title', 'page', 'hero']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZE_TOKENS }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
