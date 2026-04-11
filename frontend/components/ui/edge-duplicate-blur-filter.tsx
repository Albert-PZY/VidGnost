"use client"

import * as React from "react"

interface EdgeDuplicateBlurFilterProps {
  id: string
  blur: number
}

export function useEdgeDuplicateBlurFilterId(prefix: string) {
  const rawId = React.useId()
  return React.useMemo(
    () => `${prefix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [prefix, rawId],
  )
}

export function getEdgeDuplicateBlurFilterValue(id: string, blur: number) {
  return blur > 0 ? `url(#${id})` : undefined
}

export function EdgeDuplicateBlurFilter(props: EdgeDuplicateBlurFilterProps) {
  const { id, blur } = props
  const normalizedBlur = Math.max(0, blur)

  if (normalizedBlur <= 0) {
    return null
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
    >
      <defs>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={normalizedBlur} edgeMode="duplicate" />
        </filter>
      </defs>
    </svg>
  )
}
