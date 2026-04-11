"use client"

import * as React from "react"

import { WebGLBlurCanvas } from "@/components/ui/webgl-blur-canvas"
import type { UISettingsResponse } from "@/lib/types"
import { getImageLayout, normalizeSkinSettings } from "@/lib/ui-skin"

export function AppBackgroundLayer({ uiSettings }: { uiSettings: UISettingsResponse }) {
  const normalizedSkin = React.useMemo(
    () => normalizeSkinSettings(uiSettings),
    [
      uiSettings.background_image,
      uiSettings.background_image_blur,
      uiSettings.background_image_focus_x,
      uiSettings.background_image_focus_y,
      uiSettings.background_image_opacity,
      uiSettings.background_image_scale,
    ],
  )
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = React.useState({ width: 0, height: 0 })

  React.useEffect(() => {
    const updateViewport = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => {
      window.removeEventListener("resize", updateViewport)
    }
  }, [])

  React.useEffect(() => {
    if (!normalizedSkin.background_image) {
      setNaturalSize({ width: 0, height: 0 })
      return
    }

    let cancelled = false
    const image = new Image()
    image.decoding = "async"
    image.src = normalizedSkin.background_image

    const updateSize = () => {
      if (cancelled) {
        return
      }
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      updateSize()
      return () => {
        cancelled = true
      }
    }

    image.onload = updateSize
    return () => {
      cancelled = true
    }
  }, [normalizedSkin.background_image])

  const imageLayout = React.useMemo(() => {
    if (!normalizedSkin.background_image || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return null
    }

    return getImageLayout({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth: naturalSize.width,
      imageHeight: naturalSize.height,
      scale: normalizedSkin.background_image_scale,
      focusX: normalizedSkin.background_image_focus_x,
      focusY: normalizedSkin.background_image_focus_y,
    })
  }, [
    naturalSize.height,
    naturalSize.width,
    normalizedSkin.background_image,
    normalizedSkin.background_image_focus_x,
    normalizedSkin.background_image_focus_y,
    normalizedSkin.background_image_scale,
    viewportSize.height,
    viewportSize.width,
  ])

  if (!normalizedSkin.background_image) {
    return null
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <WebGLBlurCanvas
        src={normalizedSkin.background_image}
        width={viewportSize.width}
        height={viewportSize.height}
        imageRect={imageLayout}
        blur={normalizedSkin.background_image_blur}
        opacity={normalizedSkin.background_image_opacity / 100}
        className="absolute inset-0 h-full w-full select-none"
        pixelRatioCap={1.35}
        quality="performance"
      />
    </div>
  )
}
