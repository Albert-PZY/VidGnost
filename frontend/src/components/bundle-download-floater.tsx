import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { TFunction } from 'i18next'
import { Download, GripVertical, LoaderCircle } from 'lucide-react'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

interface BundleDownloadFloaterProps {
  t: TFunction
  bundleArchiveFormat: string
  savingArtifacts: boolean
  onDownloadAllArtifacts: () => void
}

const FLOAT_MARGIN = 16
const MIN_TOP = 96

function clampTop(nextTop: number, panelHeight: number): number {
  if (typeof window === 'undefined') return nextTop
  const maxTop = Math.max(MIN_TOP, window.innerHeight - panelHeight - FLOAT_MARGIN)
  return Math.min(Math.max(MIN_TOP, nextTop), maxTop)
}

export function BundleDownloadFloater({
  t,
  bundleArchiveFormat,
  savingArtifacts,
  onDownloadAllArtifacts,
}: BundleDownloadFloaterProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragOffsetRef = useRef(0)
  const [top, setTop] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncPosition = () => {
      const panelHeight = panelRef.current?.offsetHeight ?? 120
      setTop((current) => {
        const fallbackTop = clampTop(window.innerHeight * 0.34, panelHeight)
        return clampTop(current ?? fallbackTop, panelHeight)
      })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [])

  useEffect(() => {
    if (!dragging || typeof window === 'undefined') return

    const handlePointerMove = (event: PointerEvent) => {
      const panelHeight = panelRef.current?.offsetHeight ?? 120
      setTop(clampTop(event.clientY - dragOffsetRef.current, panelHeight))
    }

    const stopDragging = () => {
      setDragging(false)
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [dragging])

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const panelTop = panelRef.current?.getBoundingClientRect().top ?? top ?? MIN_TOP
    dragOffsetRef.current = event.clientY - panelTop
    setDragging(true)
    event.preventDefault()
  }

  return (
    <div
      className="pointer-events-none fixed right-4 z-40"
      style={top !== null ? { top } : undefined}
    >
      <div
        ref={panelRef}
        className={cn(
          'workbench-floating-card pointer-events-auto w-[232px] rounded-2xl border border-border/80 px-2.5 py-2.5 shadow-[0_16px_34px_rgba(15,23,42,0.14)] transition-shadow',
          dragging && 'shadow-[0_20px_38px_rgba(15,23,42,0.22)]',
        )}
      >
        <div className="mb-2 flex items-start gap-2">
          <button
            type="button"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-bg-base/75 text-text-subtle transition-colors',
              dragging
                ? 'cursor-grabbing bg-accent/10 text-accent'
                : 'cursor-grab hover:bg-surface-muted/80',
            )}
            aria-label={t('bundleDownload.positionHandle', {
              defaultValue: '拖动调整下载浮层位置',
            })}
            onPointerDown={handlePointerDown}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <PreText variant="timestamp" className="text-[11px] leading-4">
              {t('bundleDownload.readyCompact', { defaultValue: '产物已就绪' })}
            </PreText>
            <div className="mt-1 text-[11px] leading-4 text-text-subtle">
              {t('bundleDownload.dragHint', { defaultValue: '右侧吸附，可上下拖动' })}
            </div>
          </div>
        </div>

        <Button
          className="h-10 w-full justify-between rounded-xl px-3"
          onClick={onDownloadAllArtifacts}
          disabled={savingArtifacts}
        >
          <span className="flex items-center">
            {savingArtifacts ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {savingArtifacts
              ? t('runtime.stageD.saving')
              : t('bundleDownload.actionCompact', {
                  defaultValue: '下载 {{format}}',
                  format: bundleArchiveFormat.toUpperCase(),
                })}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">
            {bundleArchiveFormat.toUpperCase()}
          </span>
        </Button>
      </div>
    </div>
  )
}
