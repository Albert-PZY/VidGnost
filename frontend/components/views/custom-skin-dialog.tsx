"use client"

import * as React from "react"
import { RotateCcw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import type { UISettingsResponse } from "@/lib/types"
import {
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_SCALE,
  clamp,
  getSelectionFrameSize,
} from "@/lib/ui-skin"

type PickedSkinImage = {
  dataUrl: string
  fileName: string
  sizeBytes?: number
}

interface CustomSkinDialogProps {
  open: boolean
  uiSettings: UISettingsResponse
  pickedImage: PickedSkinImage | null
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onPreviewChange: (patch: Partial<UISettingsResponse> | null) => void
  onRequestPickImage: () => Promise<PickedSkinImage | null>
  onSave: (patch: Partial<UISettingsResponse>) => Promise<void>
}

type SurfaceGeometry = {
  imageWidth: number
  imageHeight: number
  imageLeft: number
  imageTop: number
  minImageLeft: number
  maxImageLeft: number
  minImageTop: number
  maxImageTop: number
  frameWidth: number
  frameHeight: number
  frameLeft: number
  frameTop: number
  frameCenterX: number
  frameCenterY: number
}

export function CustomSkinDialog(props: CustomSkinDialogProps) {
  const {
    open,
    uiSettings,
    pickedImage,
    isSaving,
    onOpenChange,
    onPreviewChange,
    onRequestPickImage,
    onSave,
  } = props

  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const [surfaceSize, setSurfaceSize] = React.useState({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = React.useState({ width: 0, height: 0 })
  const [draftImage, setDraftImage] = React.useState<string | null>(uiSettings.background_image)
  const [draftFileName, setDraftFileName] = React.useState<string>(
    uiSettings.background_image ? "已保存换肤" : "",
  )
  const [opacity, setOpacity] = React.useState([uiSettings.background_image_opacity])
  const [blur, setBlur] = React.useState([uiSettings.background_image_blur])
  const [scale, setScale] = React.useState([uiSettings.background_image_scale])
  const [focus, setFocus] = React.useState({
    x: uiSettings.background_image_focus_x,
    y: uiSettings.background_image_focus_y,
  })
  const [dragState, setDragState] = React.useState<{
    pointerId: number
    startX: number
    startY: number
    startImageLeft: number
    startImageTop: number
    geometry: SurfaceGeometry
  } | null>(null)

  const currentScalePercent = Math.round(scale[0] * 100)

  const measureSurfaceSize = React.useCallback(() => {
    if (!surfaceRef.current) {
      return
    }

    const rect = surfaceRef.current.getBoundingClientRect()
    setSurfaceSize({
      width: rect.width,
      height: rect.height,
    })
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }

    setDraftImage(pickedImage?.dataUrl ?? uiSettings.background_image)
    setDraftFileName(pickedImage?.fileName ?? (uiSettings.background_image ? "已保存换肤" : ""))
    setOpacity([uiSettings.background_image_opacity])
    setBlur([uiSettings.background_image_blur])
    setScale([pickedImage ? 1 : uiSettings.background_image_scale])
    setFocus(
      pickedImage
        ? { x: 0.5, y: 0.5 }
        : {
            x: uiSettings.background_image_focus_x,
            y: uiSettings.background_image_focus_y,
          },
    )
  }, [
    open,
    pickedImage,
    uiSettings.background_image,
    uiSettings.background_image_blur,
    uiSettings.background_image_focus_x,
    uiSettings.background_image_focus_y,
    uiSettings.background_image_opacity,
    uiSettings.background_image_scale,
  ])

  React.useEffect(() => {
    if (!draftImage) {
      setNaturalSize({ width: 0, height: 0 })
    }
  }, [draftImage])

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    measureSurfaceSize()
    const timeoutId = window.setTimeout(measureSurfaceSize, 180)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [measureSurfaceSize, open])

  React.useEffect(() => {
    if (!open || !surfaceRef.current || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const nextRect = entries[0]?.contentRect
      if (!nextRect) {
        return
      }

      setSurfaceSize({
        width: nextRect.width,
        height: nextRect.height,
      })
    })

    measureSurfaceSize()
    const frameId = window.requestAnimationFrame(measureSurfaceSize)
    observer.observe(surfaceRef.current)
    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [measureSurfaceSize, open])

  const cropGeometry = React.useMemo<SurfaceGeometry | null>(() => {
    if (
      surfaceSize.width <= 0 ||
      surfaceSize.height <= 0 ||
      naturalSize.width <= 0 ||
      naturalSize.height <= 0
    ) {
      return null
    }

    const { width: frameWidth, height: frameHeight } = getSelectionFrameSize(
      surfaceSize.width,
      surfaceSize.height,
    )
    const frameLeft = (surfaceSize.width - frameWidth) / 2
    const frameTop = (surfaceSize.height - frameHeight) / 2
    const frameCenterX = frameLeft + frameWidth / 2
    const frameCenterY = frameTop + frameHeight / 2

    const coverScale = Math.max(frameWidth / naturalSize.width, frameHeight / naturalSize.height)
    const imageWidth = naturalSize.width * coverScale * scale[0]
    const imageHeight = naturalSize.height * coverScale * scale[0]

    const minImageLeft = frameLeft + frameWidth - imageWidth
    const maxImageLeft = frameLeft
    const minImageTop = frameTop + frameHeight - imageHeight
    const maxImageTop = frameTop

    const imageLeft = clamp(
      frameCenterX - imageWidth * focus.x,
      minImageLeft,
      maxImageLeft,
    )
    const imageTop = clamp(
      frameCenterY - imageHeight * focus.y,
      minImageTop,
      maxImageTop,
    )

    return {
      imageWidth,
      imageHeight,
      imageLeft,
      imageTop,
      minImageLeft,
      maxImageLeft,
      minImageTop,
      maxImageTop,
      frameWidth,
      frameHeight,
      frameLeft,
      frameTop,
      frameCenterX,
      frameCenterY,
    }
  }, [
    focus.x,
    focus.y,
    naturalSize.height,
    naturalSize.width,
    scale,
    surfaceSize.height,
    surfaceSize.width,
  ])

  const previewPatch = React.useMemo<Partial<UISettingsResponse>>(
    () => ({
      background_image: draftImage,
      background_image_opacity: opacity[0],
      background_image_blur: blur[0],
      background_image_scale: scale[0],
      background_image_focus_x: focus.x,
      background_image_focus_y: focus.y,
      background_image_fill_mode: "cover",
    }),
    [blur, draftImage, focus.x, focus.y, opacity, scale],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }

    onPreviewChange(previewPatch)
  }, [onPreviewChange, open, previewPatch])

  React.useEffect(() => {
    if (!dragState) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const nextImageLeft = clamp(
        dragState.startImageLeft + (event.clientX - dragState.startX),
        dragState.geometry.minImageLeft,
        dragState.geometry.maxImageLeft,
      )
      const nextImageTop = clamp(
        dragState.startImageTop + (event.clientY - dragState.startY),
        dragState.geometry.minImageTop,
        dragState.geometry.maxImageTop,
      )

      setFocus({
        x: clamp(
          (dragState.geometry.frameCenterX - nextImageLeft) / dragState.geometry.imageWidth,
          0,
          1,
        ),
        y: clamp(
          (dragState.geometry.frameCenterY - nextImageTop) / dragState.geometry.imageHeight,
          0,
          1,
        ),
      })
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerId) {
        setDragState(null)
      }
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [dragState])

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onPreviewChange(null)
      setDragState(null)
    }
    onOpenChange(nextOpen)
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!draftImage) {
      return
    }

    event.preventDefault()
    setScale((current) => [
      clamp(
        current[0] + (event.deltaY < 0 ? 0.08 : -0.08),
        MIN_BACKGROUND_SCALE,
        MAX_BACKGROUND_SCALE,
      ),
    ])
  }

  const handleResetView = () => {
    setScale([1])
    setFocus({ x: 0.5, y: 0.5 })
    setBlur([uiSettings.background_image_blur])
    setOpacity([uiSettings.background_image_opacity])
  }

  const handlePickImage = async () => {
    const picked = await onRequestPickImage()
    if (!picked) {
      return
    }

    setDraftImage(picked.dataUrl)
    setDraftFileName(picked.fileName)
    setScale([1])
    setFocus({ x: 0.5, y: 0.5 })
  }

  const handleClearImage = () => {
    setDraftImage(null)
    setDraftFileName("")
    setScale([1])
    setFocus({ x: 0.5, y: 0.5 })
    setNaturalSize({ width: 0, height: 0 })
  }

  const handleSave = async () => {
    await onSave(previewPatch)
    onPreviewChange(null)
    onOpenChange(false)
  }

  const surfacePreviewLayout = React.useMemo(() => {
    if (!draftImage || !cropGeometry) {
      return null
    }

    return {
      imageStyle: {
        left: `${cropGeometry.imageLeft}px`,
        top: `${cropGeometry.imageTop}px`,
        width: `${cropGeometry.imageWidth}px`,
        height: `${cropGeometry.imageHeight}px`,
        filter: `blur(${blur[0]}px)`,
        opacity: opacity[0] / 100,
      } as React.CSSProperties,
      frameStyle: {
        left: `${cropGeometry.frameLeft}px`,
        top: `${cropGeometry.frameTop}px`,
        width: `${cropGeometry.frameWidth}px`,
        height: `${cropGeometry.frameHeight}px`,
      } as React.CSSProperties,
    }
  }, [blur, cropGeometry, draftImage, opacity])

  const sliderClassName = "[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-white/18 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-white/70 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-[0_10px_24px_rgba(0,0,0,0.28)] [&_[data-slot=slider-thumb]]:transition-transform [&_[data-slot=slider-thumb]:hover]:scale-105 [&_[data-slot=slider-thumb]:focus-visible]:ring-4 [&_[data-slot=slider-thumb]:focus-visible]:ring-white/18"

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[29rem] border-none bg-transparent p-0 shadow-none sm:max-w-[29rem]"
      >
        <div className="overflow-hidden rounded-[1.65rem] bg-[linear-gradient(180deg,#323443_0%,#2d2f3d_100%)] text-white shadow-[0_24px_72px_rgba(9,10,18,0.54)] ring-1 ring-white/6">
          <DialogHeader className="relative px-5 pb-1 pt-4 text-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-2.5 size-8 rounded-full text-white/56 hover:bg-white/8 hover:text-white"
              onClick={() => handleDialogChange(false)}
            >
              <X className="size-[18px]" />
            </Button>
            <DialogTitle className="text-[1.35rem] font-semibold tracking-tight text-white">
              自定义换肤
            </DialogTitle>
            <DialogDescription className="sr-only">
              固定取景框，拖动图片和缩放图片，并实时预览换肤效果。
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 pb-5 pt-3.5">
            <div
              ref={surfaceRef}
              className="relative aspect-[1.14/1] w-full overflow-hidden rounded-[1rem] bg-[#242632] touch-none"
              onWheel={handleWheel}
            >
              {draftImage ? (
                <>
                  <img
                    alt=""
                    src={draftImage}
                    draggable={false}
                    decoding="async"
                    className="absolute max-w-none select-none"
                    style={surfacePreviewLayout?.imageStyle}
                    onLoad={(event) => {
                      setNaturalSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                      measureSurfaceSize()
                    }}
                  />
                  <div className="absolute inset-0 bg-black/16" />
                  {surfacePreviewLayout && cropGeometry ? (
                    <button
                    type="button"
                    className="absolute rounded-[0.8rem] border border-white/32 bg-transparent shadow-[0_0_0_9999px_rgba(8,10,18,0.42)] transition-colors hover:border-white/48 active:cursor-grabbing"
                    style={surfacePreviewLayout.frameStyle}
                    onPointerDown={(event) => {
                        event.preventDefault()
                        setDragState({
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          startImageLeft: cropGeometry.imageLeft,
                          startImageTop: cropGeometry.imageTop,
                          geometry: cropGeometry,
                        })
                      }}
                    >
                      <span className="sr-only">拖动图片位置</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                  <p className="text-base font-medium text-white/88">当前未选择换肤图片</p>
                  <p className="max-w-xs text-sm leading-relaxed text-white/44">
                    选择图片后即可在固定取景框内拖动图片，并直接预览最终展示区域。
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 rounded-full border border-white/10 bg-white/4 px-5 text-sm text-white/88 hover:bg-white/8"
                    onClick={() => void handlePickImage()}
                    disabled={isSaving}
                  >
                    选择图片
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-white/40">
              <div className="min-w-0 truncate">
                {draftFileName || "未选择图片"}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  className="transition-colors hover:text-white/84"
                  onClick={() => void handlePickImage()}
                  disabled={isSaving}
                >
                  更换图片
                </button>
                <button
                  type="button"
                  className="transition-colors hover:text-white/84 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={handleClearImage}
                  disabled={isSaving || !draftImage}
                >
                  清除
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-[1.125rem]">
              <div className="grid grid-cols-[4.3rem_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-sm text-white/56">图片缩放</span>
                <Slider
                  value={scale}
                  onValueChange={setScale}
                  min={MIN_BACKGROUND_SCALE}
                  max={MAX_BACKGROUND_SCALE}
                  step={0.01}
                  disabled={isSaving || !draftImage}
                  className={sliderClassName}
                />
                <div className="flex items-center gap-2">
                  <span className="w-11 text-right text-sm font-medium text-white/82">{currentScalePercent}%</span>
                  <button
                    type="button"
                    className="text-white/42 transition-colors hover:text-white/84 disabled:opacity-30"
                    onClick={handleResetView}
                    disabled={isSaving || !draftImage}
                    aria-label="重置换肤视角"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[4.3rem_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-sm text-white/56">透明度</span>
                <Slider
                  value={opacity}
                  onValueChange={setOpacity}
                  min={0}
                  max={100}
                  step={1}
                  disabled={isSaving || !draftImage}
                  className={sliderClassName}
                />
                <span className="w-11 text-right text-sm font-medium text-white/82">{opacity[0]}%</span>
              </div>

              <div className="grid grid-cols-[4.3rem_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-sm text-white/56">模糊度</span>
                <Slider
                  value={blur}
                  onValueChange={setBlur}
                  min={0}
                  max={24}
                  step={1}
                  disabled={isSaving || !draftImage}
                  className={sliderClassName}
                />
                <span className="w-11 text-right text-sm font-medium text-white/82">{blur[0]}px</span>
              </div>
            </div>

            <p className="mt-6 text-[13px] text-white/38">
              在取景框内拖动图片即可调整展示区域，鼠标滚轮可以快速缩放，主界面会实时同步预览。
            </p>

            <div className="mt-6 flex items-center gap-3.5">
              <Button
                type="button"
                variant="ghost"
                className="h-11 flex-1 rounded-full border border-white/10 bg-transparent text-[15px] font-medium text-white/88 hover:bg-white/6"
                onClick={() => handleDialogChange(false)}
                disabled={isSaving}
              >
                取消
              </Button>
              <Button
                type="button"
                className="h-11 flex-1 rounded-full border border-[#eec0b1]/70 bg-[#efb9a9] text-[15px] font-medium text-[#fff8f5] shadow-[0_14px_28px_rgba(239,185,169,0.18)] hover:bg-[#f2c2b4]"
                onClick={() => void handleSave()}
                disabled={isSaving}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
