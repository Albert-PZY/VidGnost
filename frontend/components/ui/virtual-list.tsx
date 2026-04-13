'use client'

import * as React from 'react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'

import { cn } from '@/lib/utils'

type ItemClassNameResolver<T> = (
  item: T,
  index: number,
  virtualItem: VirtualItem,
) => string | undefined

export type VirtualListRenderContext<T> = {
  item: T
  index: number
  virtualItem: VirtualItem
  isScrolling: boolean
}

export type VirtualListProps<T> = {
  items: readonly T[]
  renderItem: (context: VirtualListRenderContext<T>) => React.ReactNode
  estimateSize?: (item: T, index: number) => number
  overscan?: number
  itemKey?: (item: T, index: number) => React.Key
  itemClassName?: string | ItemClassNameResolver<T>
  className?: string
  contentClassName?: string
  emptyClassName?: string
  emptyState?: React.ReactNode
  dynamicSize?: boolean
  style?: React.CSSProperties
}

const DEFAULT_ESTIMATE_SIZE = 72
const DEFAULT_OVERSCAN = 8

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize,
  overscan = DEFAULT_OVERSCAN,
  itemKey,
  itemClassName,
  className,
  contentClassName,
  emptyClassName,
  emptyState,
  dynamicSize = true,
  style,
}: VirtualListProps<T>) {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)

  const estimateSizeByIndex = React.useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) {
        return DEFAULT_ESTIMATE_SIZE
      }
      return estimateSize?.(item, index) ?? DEFAULT_ESTIMATE_SIZE
    },
    [estimateSize, items],
  )

  const getItemKey = React.useCallback(
    (index: number) => {
      const item = items[index]
      if (item === undefined) {
        return index
      }
      return itemKey?.(item, index) ?? index
    },
    [itemKey, items],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateSizeByIndex,
    overscan,
    getItemKey,
    measureElement: dynamicSize
      ? (element) => element.getBoundingClientRect().height
      : undefined,
  })

  const virtualItems = virtualizer.getVirtualItems()

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-md border border-dashed border-white/20 px-4 py-6 text-sm text-white/70',
          emptyClassName,
          className,
        )}
        style={style}
      >
        {emptyState ?? '暂无数据'}
      </div>
    )
  }

  return (
    <div
      ref={scrollContainerRef}
      className={cn('h-full w-full overflow-auto', className)}
      style={style}
    >
      <div
        className={cn('relative w-full', contentClassName)}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index]
          if (item === undefined) {
            return null
          }
          const resolvedItemClassName =
            typeof itemClassName === 'function'
              ? itemClassName(item, virtualItem.index, virtualItem)
              : itemClassName
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={dynamicSize ? virtualizer.measureElement : undefined}
              className={resolvedItemClassName}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem({
                item,
                index: virtualItem.index,
                virtualItem,
                isScrolling: virtualizer.isScrolling,
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

