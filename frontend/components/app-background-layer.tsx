"use client"

import * as React from "react"

import { WebGLBlurCanvas } from "@/components/ui/webgl-blur-canvas"
import type { UISettingsResponse } from "@/lib/types"
import { getImageLayout, normalizeSkinSettings } from "@/lib/ui-skin"

const SKIN_PREVIEW_TRANSITION_MS = 220
const SKIN_PREVIEW_REDUCED_MOTION_MS = 160
const SKIN_PREVIEW_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

type NormalizedSkin = ReturnType<typeof normalizeSkinSettings>

type RenderedBackgroundLayer = {
  id: string
  skin: NormalizedSkin
}

type NaturalSize = {
  width: number
  height: number
}

function hasSameVisualState(current: NormalizedSkin, next: NormalizedSkin) {
  return (
    current.background_image === next.background_image &&
    Math.abs(current.background_image_blur - next.background_image_blur) <= 0.01 &&
    Math.abs(current.background_image_opacity - next.background_image_opacity) <= 0.01 &&
    Math.abs(current.background_image_scale - next.background_image_scale) <= 0.0005 &&
    Math.abs(current.background_image_focus_x - next.background_image_focus_x) <= 0.0005 &&
    Math.abs(current.background_image_focus_y - next.background_image_focus_y) <= 0.0005
  )
}

function useImageNaturalSize(src: string | null) {
  const [naturalSize, setNaturalSize] = React.useState<NaturalSize>({ width: 0, height: 0 })

  React.useEffect(() => {
    if (!src) {
      setNaturalSize({ width: 0, height: 0 })
      return
    }

    let cancelled = false
    const image = new Image()
    image.decoding = "async"
    image.src = src

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
  }, [src])

  return naturalSize
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
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)
  const [baseLayer, setBaseLayer] = React.useState<RenderedBackgroundLayer>(() => ({
    id: "base-0",
    skin: normalizedSkin,
  }))
  const [overlayLayer, setOverlayLayer] = React.useState<RenderedBackgroundLayer | null>(null)
  const [overlayVisible, setOverlayVisible] = React.useState(false)
  const [isAnimatingSkin, setIsAnimatingSkin] = React.useState(false)
  const transitionFrameRef = React.useRef<number | null>(null)
  const transitionTimerRef = React.useRef<number | null>(null)
  const transitionOverlayIdRef = React.useRef<string | null>(null)
  const layerSequenceRef = React.useRef(0)
  const activeSkinRef = React.useRef(normalizedSkin)
  const transitionDurationMs = prefersReducedMotion
    ? SKIN_PREVIEW_REDUCED_MOTION_MS
    : SKIN_PREVIEW_TRANSITION_MS

  const clearSkinTransition = React.useCallback(() => {
    if (transitionFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionFrameRef.current)
      transitionFrameRef.current = null
    }

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }

    transitionOverlayIdRef.current = null
  }, [])

  const baseNaturalSize = useImageNaturalSize(baseLayer.skin.background_image)
  const overlayNaturalSize = useImageNaturalSize(overlayLayer?.skin.background_image ?? null)

  React.useEffect(() => {
    return () => {
      clearSkinTransition()
    }
  }, [clearSkinTransition])

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
    clearSkinTransition()

    const currentSkin = activeSkinRef.current
    if (hasSameVisualState(currentSkin, normalizedSkin)) {
      return
    }

    activeSkinRef.current = normalizedSkin

    const canAnimate =
      Boolean(currentSkin.background_image) &&
      Boolean(normalizedSkin.background_image)

    if (!canAnimate) {
      layerSequenceRef.current += 1
      setBaseLayer({
        id: `base-${layerSequenceRef.current}`,
        skin: normalizedSkin,
      })
      setOverlayLayer(null)
      setOverlayVisible(false)
      setIsAnimatingSkin(false)
      return
    }

    layerSequenceRef.current += 1
    const nextBaseLayer = {
      id: `base-${layerSequenceRef.current}`,
      skin: currentSkin,
    }
    layerSequenceRef.current += 1
    const nextOverlayLayer = {
      id: `overlay-${layerSequenceRef.current}`,
      skin: normalizedSkin,
    }

    setBaseLayer(nextBaseLayer)
    setOverlayLayer(nextOverlayLayer)
    setOverlayVisible(false)
    setIsAnimatingSkin(true)
  }, [clearSkinTransition, normalizedSkin])

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

  const baseImageLayout = React.useMemo(() => {
    if (
      !baseLayer.skin.background_image ||
      baseNaturalSize.width <= 0 ||
      baseNaturalSize.height <= 0
    ) {
      return null
    }

    return getImageLayout({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth: baseNaturalSize.width,
      imageHeight: baseNaturalSize.height,
      scale: baseLayer.skin.background_image_scale,
      focusX: baseLayer.skin.background_image_focus_x,
      focusY: baseLayer.skin.background_image_focus_y,
    })
  }, [
    baseLayer.skin.background_image,
    baseLayer.skin.background_image_focus_x,
    baseLayer.skin.background_image_focus_y,
    baseLayer.skin.background_image_scale,
    baseNaturalSize.height,
    baseNaturalSize.width,
    viewportSize.height,
    viewportSize.width,
  ])

  const overlaySharesBaseSource =
    Boolean(overlayLayer?.skin.background_image) &&
    overlayLayer?.skin.background_image === baseLayer.skin.background_image

  const resolvedOverlayNaturalSize = overlaySharesBaseSource ? baseNaturalSize : overlayNaturalSize

  const overlayImageLayout = React.useMemo(() => {
    if (
      !overlayLayer?.skin.background_image ||
      resolvedOverlayNaturalSize.width <= 0 ||
      resolvedOverlayNaturalSize.height <= 0
    ) {
      return null
    }

    return getImageLayout({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth: resolvedOverlayNaturalSize.width,
      imageHeight: resolvedOverlayNaturalSize.height,
      scale: overlayLayer.skin.background_image_scale,
      focusX: overlayLayer.skin.background_image_focus_x,
      focusY: overlayLayer.skin.background_image_focus_y,
    })
  }, [
    overlayLayer,
    resolvedOverlayNaturalSize.height,
    resolvedOverlayNaturalSize.width,
    viewportSize.height,
    viewportSize.width,
  ])

  const handleOverlayFrameRendered = React.useCallback((overlayId: string) => {
    if (!overlayLayer || overlayLayer.id !== overlayId || transitionOverlayIdRef.current === overlayId) {
      return
    }

    transitionOverlayIdRef.current = overlayId
    transitionFrameRef.current = window.requestAnimationFrame(() => {
      transitionFrameRef.current = null
      setOverlayVisible(true)
      transitionTimerRef.current = window.setTimeout(() => {
        layerSequenceRef.current += 1
        setBaseLayer({
          id: `base-${layerSequenceRef.current}`,
          skin: overlayLayer.skin,
        })
        setOverlayLayer((currentOverlay) =>
          currentOverlay?.id === overlayId ? null : currentOverlay,
        )
        setOverlayVisible(false)
        setIsAnimatingSkin(false)
        transitionOverlayIdRef.current = null
        transitionTimerRef.current = null
      }, transitionDurationMs)
    })
  }, [overlayLayer, transitionDurationMs])

  if (!baseLayer.skin.background_image && !overlayLayer?.skin.background_image) {
    return null
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {baseLayer.skin.background_image && baseImageLayout ? (
        <div className="absolute inset-0">
          <WebGLBlurCanvas
            src={baseLayer.skin.background_image}
            width={viewportSize.width}
            height={viewportSize.height}
            imageRect={baseImageLayout}
            blur={baseLayer.skin.background_image_blur}
            opacity={baseLayer.skin.background_image_opacity / 100}
            className="absolute inset-0 h-full w-full select-none"
            pixelRatioCap={isAnimatingSkin ? 1.02 : 1.28}
            quality="performance"
          />
        </div>
      ) : null}

      {overlayLayer?.skin.background_image && overlayImageLayout ? (
        <div
          className="absolute inset-0"
          style={{
            opacity: overlayVisible ? 1 : 0,
            transition: `opacity ${transitionDurationMs}ms ${SKIN_PREVIEW_EASING}`,
            willChange: "opacity",
          }}
        >
          <WebGLBlurCanvas
            src={overlayLayer.skin.background_image}
            width={viewportSize.width}
            height={viewportSize.height}
            imageRect={overlayImageLayout}
            blur={overlayLayer.skin.background_image_blur}
            opacity={overlayLayer.skin.background_image_opacity / 100}
            className="absolute inset-0 h-full w-full select-none"
            pixelRatioCap={1}
            quality="performance"
            onFrameRendered={() => {
              handleOverlayFrameRendered(overlayLayer.id)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
