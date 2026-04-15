"use client"

import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "@/lib/utils"

interface VirtualizedListProps<TItem> {
  items: TItem[]
  renderItem: (item: TItem, index: number) => React.ReactNode
  getItemKey?: (item: TItem, index: number) => React.Key
  estimateSize?: (index: number) => number
  overscan?: number
  className?: string
  viewportClassName?: string
  contentClassName?: string
  emptyState?: React.ReactNode
  paddingStart?: number
  paddingEnd?: number
  viewportRef?: React.Ref<HTMLDivElement>
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>
}

export function VirtualizedList<TItem>({
  items,
  renderItem,
  getItemKey,
  estimateSize,
  overscan = 8,
  className,
  viewportClassName,
  contentClassName,
  emptyState = null,
  paddingStart = 0,
  paddingEnd = 0,
  viewportRef,
  onViewportScroll,
}: VirtualizedListProps<TItem>) {
  const parentRef = React.useRef<HTMLDivElement | null>(null)
  const handleViewportRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      parentRef.current = node
      if (!viewportRef) {
        return
      }
      if (typeof viewportRef === "function") {
        viewportRef(node)
        return
      }
      ;(viewportRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    },
    [viewportRef],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateSize?.(index) ?? 160,
    getItemKey: (index) => {
      const item = items[index]
      return getItemKey ? getItemKey(item, index) : index
    },
    overscan,
    paddingStart,
    paddingEnd,
  })

  const virtualItems = virtualizer.getVirtualItems()

  if (items.length === 0) {
    return <div className={className}>{emptyState}</div>
  }

  return (
    <div
      ref={handleViewportRef}
      className={cn("h-full min-h-0 overflow-y-auto", className, viewportClassName)}
      onScroll={onViewportScroll}
    >
      <div
        className={cn("relative w-full", contentClassName)}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
