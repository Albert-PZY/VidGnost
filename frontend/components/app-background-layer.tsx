"use client"

import * as React from "react"

import { WebGLBlurCanvas } from "@/components/ui/webgl-blur-canvas"
import type { UISettingsResponse } from "@/lib/types"
import { getImageLayout, normalizeSkinSettings } from "@/lib/ui-skin"

const SKIN_PREVIEW_TRANSITION_MS = 168

function easeOutQuint(value: number) {
  return 1 - (1 - value) ** 5
}

function interpolate(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

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
  const [displaySkin, setDisplaySkin] = React.useState(() => normalizedSkin)
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)
  const [isAnimatingSkin, setIsAnimatingSkin] = React.useState(false)
  const animationFrameRef = React.useRef<number | null>(null)
  const displaySkinRef = React.useRef(displaySkin)

  React.useEffect(() => {
    displaySkinRef.current = displaySkin
  }, [displaySkin])

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = () => {
      setPrefersReducedMotion(mediaQuery.matches)
    }

    handleChange()
    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  React.useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    const currentSkin = displaySkinRef.current
    const shouldAnimate =
      !prefersReducedMotion &&
      Boolean(currentSkin.background_image) &&
      currentSkin.background_image === normalizedSkin.background_image

    if (!shouldAnimate) {
      setIsAnimatingSkin(false)
      setDisplaySkin(normalizedSkin)
      return
    }

    const startSkin = currentSkin
    const targetSkin = normalizedSkin
    const hasVisualDelta =
      Math.abs(startSkin.background_image_blur - targetSkin.background_image_blur) > 0.01 ||
      Math.abs(startSkin.background_image_opacity - targetSkin.background_image_opacity) > 0.01 ||
      Math.abs(startSkin.background_image_scale - targetSkin.background_image_scale) > 0.0005 ||
      Math.abs(startSkin.background_image_focus_x - targetSkin.background_image_focus_x) > 0.0005 ||
      Math.abs(startSkin.background_image_focus_y - targetSkin.background_image_focus_y) > 0.0005

    if (!hasVisualDelta) {
      setIsAnimatingSkin(false)
      setDisplaySkin(normalizedSkin)
      return
    }

    setIsAnimatingSkin(true)
    const startAt = performance.now()

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startAt) / SKIN_PREVIEW_TRANSITION_MS)
      const eased = easeOutQuint(progress)

      setDisplaySkin({
        ...targetSkin,
        background_image_blur: interpolate(
          startSkin.background_image_blur,
          targetSkin.background_image_blur,
          eased,
        ),
        background_image_opacity: interpolate(
          startSkin.background_image_opacity,
          targetSkin.background_image_opacity,
          eased,
        ),
        background_image_scale: interpolate(
          startSkin.background_image_scale,
          targetSkin.background_image_scale,
          eased,
        ),
        background_image_focus_x: interpolate(
          startSkin.background_image_focus_x,
          targetSkin.background_image_focus_x,
          eased,
        ),
        background_image_focus_y: interpolate(
          startSkin.background_image_focus_y,
          targetSkin.background_image_focus_y,
          eased,
        ),
      })

      if (progress >= 1) {
        animationFrameRef.current = null
        setIsAnimatingSkin(false)
        return
      }

      animationFrameRef.current = window.requestAnimationFrame(animate)
    }

    animationFrameRef.current = window.requestAnimationFrame(animate)
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [
    normalizedSkin,
    normalizedSkin.background_image,
    normalizedSkin.background_image_blur,
    normalizedSkin.background_image_focus_x,
    normalizedSkin.background_image_focus_y,
    normalizedSkin.background_image_opacity,
    normalizedSkin.background_image_scale,
    prefersReducedMotion,
  ])

  React.useEffect(() => {
    let frameId: number | null = null

    const commitViewport = () => {
      frameId = null
      const nextWidth = window.innerWidth
      const nextHeight = window.innerHeight
      setViewportSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return {
          width: nextWidth,
          height: nextHeight,
        }
      })
    }

    const scheduleViewportUpdate = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(commitViewport)
    }

    commitViewport()
    window.addEventListener("resize", scheduleViewportUpdate, { passive: true })
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      window.removeEventListener("resize", scheduleViewportUpdate)
    }
  }, [])

  React.useEffect(() => {
    if (!displaySkin.background_image) {
      setNaturalSize({ width: 0, height: 0 })
      return
    }

    let cancelled = false
    const image = new Image()
    image.decoding = "async"
    image.src = displaySkin.background_image

    const updateSize = () => {
      if (cancelled) {
        return
      }
      setNaturalSize((current) => {
        if (current.width === image.naturalWidth && current.height === image.naturalHeight) {
          return current
        }
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
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
      image.onload = null
      image.onerror = null
    }
  }, [displaySkin.background_image])

  const imageLayout = React.useMemo(() => {
    if (!displaySkin.background_image || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return null
    }

    return getImageLayout({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth: naturalSize.width,
      imageHeight: naturalSize.height,
      scale: displaySkin.background_image_scale,
      focusX: displaySkin.background_image_focus_x,
      focusY: displaySkin.background_image_focus_y,
    })
  }, [
    displaySkin.background_image,
    displaySkin.background_image_focus_x,
    displaySkin.background_image_focus_y,
    displaySkin.background_image_scale,
    naturalSize.height,
    naturalSize.width,
    viewportSize.height,
    viewportSize.width,
  ])

  if (!displaySkin.background_image) {
    return null
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <WebGLBlurCanvas
        src={displaySkin.background_image}
        width={viewportSize.width}
        height={viewportSize.height}
        imageRect={imageLayout}
        blur={displaySkin.background_image_blur}
        opacity={displaySkin.background_image_opacity / 100}
        className="absolute inset-0 h-full w-full select-none"
        pixelRatioCap={isAnimatingSkin ? 1.08 : 1.35}
        quality="performance"
      />
    </div>
  )
}
