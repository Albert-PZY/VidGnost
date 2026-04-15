import type { UISettingsResponse } from "@/lib/types"

type SkinSettingsLike = Pick<
  UISettingsResponse,
  | "background_image"
  | "background_image_opacity"
  | "background_image_blur"
  | "background_image_scale"
  | "background_image_focus_x"
  | "background_image_focus_y"
>

export const APP_SHELL_ASPECT_RATIO = 16 / 10
export const SKIN_SELECTION_RATIO = 0.72
export const MIN_BACKGROUND_SCALE = 1
export const MIN_BACKGROUND_PREVIEW_SCALE = MIN_BACKGROUND_SCALE * SKIN_SELECTION_RATIO
export const MAX_BACKGROUND_SCALE = 4
export const MAX_BACKGROUND_PREVIEW_SCALE = MAX_BACKGROUND_SCALE * SKIN_SELECTION_RATIO

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeSkinSettings(settings: SkinSettingsLike) {
  return {
    background_image: settings.background_image,
    background_image_opacity: clamp(settings.background_image_opacity, 0, 100),
    background_image_blur: clamp(settings.background_image_blur, 0, 40),
    background_image_scale: clamp(settings.background_image_scale, 1, MAX_BACKGROUND_SCALE),
    background_image_focus_x: clamp(settings.background_image_focus_x, 0, 1),
    background_image_focus_y: clamp(settings.background_image_focus_y, 0, 1),
  }
}

export function getSelectionFrameSize(surfaceWidth: number, surfaceHeight: number) {
  const width = Math.min(
    surfaceWidth * SKIN_SELECTION_RATIO,
    surfaceHeight * APP_SHELL_ASPECT_RATIO * SKIN_SELECTION_RATIO,
  )

  return {
    width,
    height: width / APP_SHELL_ASPECT_RATIO,
  }
}

export function getPreviewScaleFromSavedScale(savedScale: number) {
  return clamp(
    savedScale * SKIN_SELECTION_RATIO,
    MIN_BACKGROUND_PREVIEW_SCALE,
    MAX_BACKGROUND_PREVIEW_SCALE,
  )
}

export function getSavedScaleFromPreviewScale(previewScale: number) {
  return clamp(previewScale / SKIN_SELECTION_RATIO, MIN_BACKGROUND_SCALE, MAX_BACKGROUND_SCALE)
}

export function getImageLayout(input: {
  viewportWidth: number
  viewportHeight: number
  imageWidth: number
  imageHeight: number
  scale: number
  focusX: number
  focusY: number
}) {
  const {
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    scale,
    focusX,
    focusY,
  } = input

  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return null
  }

  const coverScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight)
  const renderWidth = imageWidth * coverScale * scale
  const renderHeight = imageHeight * coverScale * scale
  const left = clamp(
    viewportWidth / 2 - renderWidth * focusX,
    viewportWidth - renderWidth,
    0,
  )
  const top = clamp(
    viewportHeight / 2 - renderHeight * focusY,
    viewportHeight - renderHeight,
    0,
  )

  return {
    width: renderWidth,
    height: renderHeight,
    left,
    top,
  }
}
