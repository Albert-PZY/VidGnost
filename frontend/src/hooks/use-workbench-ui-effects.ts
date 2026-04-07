import { useEffect } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { MainViewMode, SidebarPanelKey } from '../app/workbench-config'

interface UseWorkbenchUiEffectsOptions {
  isDark: boolean
  mainView: MainViewMode
  activeSidebarPanel: SidebarPanelKey
  setMenuPortalTarget: Dispatch<SetStateAction<HTMLElement | null>>
  setHeaderGlass: Dispatch<SetStateAction<boolean>>
  setActiveSidebarPanel: Dispatch<SetStateAction<SidebarPanelKey>>
  transcriptPanelRef: RefObject<HTMLDivElement | null>
  notesPanelRef: RefObject<HTMLDivElement | null>
  mindmapMarkdownPanelRef: RefObject<HTMLTextAreaElement | null>
  transcriptStream: string
  notesStream: string
  mindmapStream: string
  canEditStageDMarkdown: boolean
}

function resolveNotesEditorTextarea(container: HTMLDivElement | null): HTMLTextAreaElement | null {
  if (!container) return null
  return (
    container.querySelector<HTMLTextAreaElement>('.w-md-editor-text-input') ??
    container.querySelector<HTMLTextAreaElement>('textarea')
  )
}

export function useWorkbenchUiEffects({
  isDark,
  mainView,
  activeSidebarPanel,
  setMenuPortalTarget,
  setHeaderGlass,
  setActiveSidebarPanel,
  transcriptPanelRef,
  notesPanelRef,
  mindmapMarkdownPanelRef,
  transcriptStream,
  notesStream,
  mindmapStream,
  canEditStageDMarkdown,
}: UseWorkbenchUiEffectsOptions) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    setMenuPortalTarget(document.body)
  }, [setMenuPortalTarget])

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const shouldReduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!shouldReduceMotion) {
      root.classList.add('theme-transitioning')
    }
    const themeMode = isDark ? 'dark' : 'light'
    root.setAttribute('data-theme', themeMode)
    root.setAttribute('data-color-mode', themeMode)
    body.setAttribute('data-color-mode', themeMode)
    localStorage.setItem('vidgnost-theme', isDark ? 'dark' : 'light')

    if (shouldReduceMotion) {
      return
    }

    const timer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning')
    }, 380)

    return () => {
      window.clearTimeout(timer)
      root.classList.remove('theme-transitioning')
    }
  }, [isDark])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    if (document.documentElement) {
      document.documentElement.scrollTop = 0
    }
    if (document.body) {
      document.body.scrollTop = 0
    }
  }, [mainView])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (transcriptPanelRef.current) {
        transcriptPanelRef.current.scrollTop = transcriptPanelRef.current.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [transcriptPanelRef, transcriptStream])

  useEffect(() => {
    if (canEditStageDMarkdown) return
    const frame = window.requestAnimationFrame(() => {
      const notesEditor = resolveNotesEditorTextarea(notesPanelRef.current)
      if (notesEditor) {
        notesEditor.scrollTop = notesEditor.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canEditStageDMarkdown, notesPanelRef, notesStream])

  useEffect(() => {
    if (canEditStageDMarkdown) return
    const frame = window.requestAnimationFrame(() => {
      if (mindmapMarkdownPanelRef.current) {
        mindmapMarkdownPanelRef.current.scrollTop = mindmapMarkdownPanelRef.current.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canEditStageDMarkdown, mindmapMarkdownPanelRef, mindmapStream])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let raf = 0

    const updateHeaderState = () => {
      const next = window.scrollY > 20
      setHeaderGlass((prev) => (prev === next ? prev : next))
      raf = 0
    }

    const onScroll = () => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(updateHeaderState)
    }

    updateHeaderState()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf)
      }
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [setHeaderGlass])

  useEffect(() => {
    if (!activeSidebarPanel) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveSidebarPanel(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSidebarPanel, setActiveSidebarPanel])

  useEffect(() => {
    if (mainView !== 'quickstart') return
    setActiveSidebarPanel(null)
  }, [mainView, setActiveSidebarPanel])

  useEffect(() => {
    if (!activeSidebarPanel) return
    const body = document.body
    const html = document.documentElement
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const previousHtmlOverflow = html.style.overflow
    const scrollbarWidth = window.innerWidth - html.clientWidth

    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
      html.style.overflow = previousHtmlOverflow
    }
  }, [activeSidebarPanel])
}
