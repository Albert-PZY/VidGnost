"use client"

import * as React from "react"

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

  const blurCompensation = normalizedSkin.background_image_blur > 0
    ? 1 + normalizedSkin.background_image_blur / 120
    : 1

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <img
        alt=""
        src={normalizedSkin.background_image}
        decoding="async"
        draggable={false}
        className="absolute max-w-none select-none"
        onLoad={(event) => {
          const target = event.currentTarget
          setNaturalSize({
            width: target.naturalWidth,
            height: target.naturalHeight,
          })
        }}
        style={
          imageLayout
            ? {
                left: `${imageLayout.left}px`,
                top: `${imageLayout.top}px`,
                width: `${imageLayout.width}px`,
                height: `${imageLayout.height}px`,
                opacity: normalizedSkin.background_image_opacity / 100,
                filter: `blur(${normalizedSkin.background_image_blur}px)`,
                transform: `scale(${blurCompensation})`,
                transformOrigin: "center center",
              }
            : { opacity: 0 }
        }
      />
    </div>
  )
}
