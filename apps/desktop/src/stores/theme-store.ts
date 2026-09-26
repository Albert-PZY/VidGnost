import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** 与 `index.html` 中的首屏脚本保持一致，避免主题闪烁。 */
export const THEME_STORAGE_KEY = 'vidgnost.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system'
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
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

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  /** 在浅色与深色之间直接切换；由「跟随系统」切换时会落到当前解析结果的相反值。 */
  toggle: () => void
  /** 监听系统主题变化，仅在 `system` 模式下生效。 */
  watchSystem: () => () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStoredMode(),
  resolved: resolveTheme(readStoredMode()),

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

/** 首屏脚本已经写过一次 class，这里只需同步一次状态，保证 store 与 DOM 一致。 */
export function initTheme(): () => void {
  const mode = readStoredMode()
  const resolved = resolveTheme(mode)
  applyTheme(resolved)
  useThemeStore.setState({ mode, resolved })
  return useThemeStore.getState().watchSystem()
}
