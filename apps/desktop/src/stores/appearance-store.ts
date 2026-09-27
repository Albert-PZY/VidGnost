import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** 界面字号：直接选正文的像素值，界面其余部分按同一比例缩放。 */
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 26
/** 阶梯基准：这个值对应的缩放比例是 1，也就是界面原始设计的字号。 */
export const FONT_SIZE_BASE = 14
export const DEFAULT_FONT_SIZE = 14

export const FONT_SIZE_STEPS: number[] = Array.from(
  { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
  (_, index) => FONT_SIZE_MIN + index,
)

/** 存储键与取值必须与 `index.html` 的首屏脚本保持一致，否则会出现闪烁。 */
export const THEME_STORAGE_KEY = 'vidgnost.theme'
export const FONT_SIZE_STORAGE_KEY = 'vidgnost.fontSize'

/**
 * 选定字号 → 根字号缩放比例。
 *
 * 正文字号是 `--size-body`（0.875rem），根字号是 `16px × 比例`，
 * 因此比例为 选定值 / 14 时正文正好等于用户选的那个像素值，其余字号按同比例跟着变。
 */
export function scaleForFontSize(fontSize: number): number {
  return fontSize / FONT_SIZE_BASE
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * 存储值的归一化。`index.html` 的首屏脚本用的是同一套规则，
 * 因此这里改动时要同步改那边，否则首屏与 store 会给出不同的结果。
 */
export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** 越界值夹到区间内，无法解析时回到默认值；不因一个坏值渲染出不可读的字号。 */
export function normalizeFontSize(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FONT_SIZE
  }
  return Math.min(Math.max(Math.round(parsed), FONT_SIZE_MIN), FONT_SIZE_MAX)
}

export function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system'
  }
  return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
}

export function readStoredFontSize(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_FONT_SIZE
  }
  return normalizeFontSize(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY))
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') {
    return mode
  }
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
}

function applyFontSize(fontSize: number): void {
  if (typeof document === 'undefined') {
    return
  }
  // 写成 html 的内联样式：`:root` 里的默认值是无层样式，写在层里的档位规则会被它压住。
  document.documentElement.style.setProperty('--font-scale', String(scaleForFontSize(fontSize)))
  document.documentElement.dataset.fontSize = String(fontSize)
}

interface AppearanceState {
  fontSize: number
  mode: ThemeMode
  resolved: ResolvedTheme
  setFontSize: (size: number) => void
  setMode: (mode: ThemeMode) => void
  /** 在浅色与深色之间直接切换；由「跟随系统」切换时会落到当前解析结果的相反值。 */
  toggle: () => void
  /** 监听系统主题变化，仅在 `system` 模式下生效。 */
  watchSystem: () => () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  fontSize: readStoredFontSize(),
  mode: readStoredMode(),
  resolved: resolveTheme(readStoredMode()),

  setFontSize: (size) => {
    const fontSize = normalizeFontSize(size)
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize))
    applyFontSize(fontSize)
    set({ fontSize })
  },

  setMode: (mode) => {
    const resolved = resolveTheme(mode)
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    applyTheme(resolved)
    set({ mode, resolved })
  },

  toggle: () => {
    const next: ThemeMode = get().resolved === 'dark' ? 'light' : 'dark'
    get().setMode(next)
  },

  watchSystem: () => {
    const query = window.matchMedia(DARK_QUERY)
    const listener = () => {
      if (get().mode !== 'system') {
        return
      }
      const resolved = resolveTheme('system')
      applyTheme(resolved)
      set({ resolved })
    }
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  },
}))

/** 首屏脚本已经写过一次主题与字号，这里只需同步状态，保证 store 与 DOM 一致。 */
export function initAppearance(): () => void {
  const mode = readStoredMode()
  const fontSize = readStoredFontSize()
  applyTheme(resolveTheme(mode))
  applyFontSize(fontSize)
  useAppearanceStore.setState({ mode, resolved: resolveTheme(mode), fontSize })
  return useAppearanceStore.getState().watchSystem()
}
