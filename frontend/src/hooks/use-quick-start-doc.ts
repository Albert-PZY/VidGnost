import { useEffect, useState } from 'react'

import type { MainViewMode, UILocale } from '../app/workbench-config'

type QuickStartDocModule = { default: string }

const quickStartDocLoaders: Record<UILocale, () => Promise<QuickStartDocModule>> = {
  'zh-CN': () => import('../docs/quick-start.zh-CN.md?raw'),
  en: () => import('../docs/quick-start.en.md?raw'),
}

const quickStartDocCache: Partial<Record<UILocale, string>> = {}

export function useQuickStartDoc(params: { mainView: MainViewMode; locale: UILocale }): string {
  const { mainView, locale } = params
  const [markdown, setMarkdown] = useState('')

  useEffect(() => {
    if (mainView !== 'quickstart') return
    const cached = quickStartDocCache[locale]
    if (cached) {
      setMarkdown(cached)
      return
    }
    let cancelled = false
    setMarkdown('')
    void quickStartDocLoaders[locale]().then((module) => {
      if (cancelled) return
      quickStartDocCache[locale] = module.default
      setMarkdown(module.default)
    })
    return () => {
      cancelled = true
    }
  }, [locale, mainView])

  return markdown
}
