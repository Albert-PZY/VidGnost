"use client"

import * as React from "react"
import { ImagePlus, RotateCcw, Sparkles, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import type { UISettingsResponse } from "@/lib/types"
import { formatBytes } from "@/lib/format"
import {
  MAX_BACKGROUND_PREVIEW_SCALE,
  MIN_BACKGROUND_PREVIEW_SCALE,
  clamp,
  getImageLayout,
  getPreviewScaleFromSavedScale,
  getSavedScaleFromPreviewScale,
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
  frameWidth: number
  frameHeight: number
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
  const [draftSizeBytes, setDraftSizeBytes] = React.useState<number | undefined>(undefined)
  const [opacity, setOpacity] = React.useState([uiSettings.background_image_opacity])
  const [blur, setBlur] = React.useState([uiSettings.background_image_blur])
  const [previewScale, setPreviewScale] = React.useState([
    getPreviewScaleFromSavedScale(uiSettings.background_image_scale),
  ])
  const [focus, setFocus] = React.useState({
    x: uiSettings.background_image_focus_x,
    y: uiSettings.background_image_focus_y,
  })
  const [dragState, setDragState] = React.useState<{
    pointerId: number
    startX: number
    startY: number
    startCenterX: number
      startCenterY: number
      geometry: SurfaceGeometry
  } | null>(null)

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
    setDraftFileName(
      pickedImage?.fileName ?? (uiSettings.background_image ? "已保存换肤" : ""),
    )
    setDraftSizeBytes(pickedImage?.sizeBytes)
    setOpacity([uiSettings.background_image_opacity])
    setBlur([uiSettings.background_image_blur])
    setPreviewScale([
      getPreviewScaleFromSavedScale(pickedImage ? 1 : uiSettings.background_image_scale),
    ])
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
    uiSettings.background_image,
    uiSettings.background_image_blur,
    uiSettings.background_image_focus_x,
    uiSettings.background_image_focus_y,
    uiSettings.background_image_opacity,
    uiSettings.background_image_scale,
    pickedImage,
  ])

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
    if (surfaceSize.width <= 0 || surfaceSize.height <= 0 || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return null
    }

    const coverScale = Math.max(
      surfaceSize.width / naturalSize.width,
      surfaceSize.height / naturalSize.height,
    )
    const imageWidth = naturalSize.width * coverScale * previewScale[0]
    const imageHeight = naturalSize.height * coverScale * previewScale[0]
    const imageLeft = (surfaceSize.width - imageWidth) / 2
    const imageTop = (surfaceSize.height - imageHeight) / 2
    const { width: frameWidth, height: frameHeight } = getSelectionFrameSize(
      surfaceSize.width,
      surfaceSize.height,
    )
    const frameCenterX = clamp(
      imageLeft + imageWidth * focus.x,
      frameWidth / 2,
      surfaceSize.width - frameWidth / 2,
    )
    const frameCenterY = clamp(
      imageTop + imageHeight * focus.y,
      frameHeight / 2,
      surfaceSize.height - frameHeight / 2,
    )

    return {
      imageWidth,
      imageHeight,
      imageLeft,
      imageTop,
      frameWidth,
      frameHeight,
      frameCenterX,
      frameCenterY,
    }
  }, [
    focus.x,
    focus.y,
    naturalSize.height,
    naturalSize.width,
    previewScale,
    surfaceSize.height,
    surfaceSize.width,
  ])

  const previewPatch = React.useMemo<Partial<UISettingsResponse>>(
    () => ({
      background_image: draftImage,
      background_image_opacity: opacity[0],
      background_image_blur: blur[0],
      background_image_scale: getSavedScaleFromPreviewScale(previewScale[0]),
      background_image_focus_x: focus.x,
      background_image_focus_y: focus.y,
      background_image_fill_mode: "cover",
    }),
    [blur, draftImage, focus.x, focus.y, opacity, previewScale],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    onPreviewChange(previewPatch)
  }, [onPreviewChange, open, previewPatch])

  React.useEffect(() => {
    if (!dragState || !cropGeometry) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const nextCenterX = clamp(
        dragState.startCenterX + (event.clientX - dragState.startX),
        dragState.geometry.frameWidth / 2,
        surfaceSize.width - dragState.geometry.frameWidth / 2,
      )
      const nextCenterY = clamp(
        dragState.startCenterY + (event.clientY - dragState.startY),
        dragState.geometry.frameHeight / 2,
        surfaceSize.height - dragState.geometry.frameHeight / 2,
      )

      setFocus({
        x: clamp(
          (nextCenterX - dragState.geometry.imageLeft) / dragState.geometry.imageWidth,
          0,
          1,
        ),
        y: clamp(
          (nextCenterY - dragState.geometry.imageTop) / dragState.geometry.imageHeight,
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
  }, [cropGeometry, dragState, surfaceSize.height, surfaceSize.width])

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onPreviewChange(null)
      setDragState(null)
    }
    onOpenChange(nextOpen)
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!cropGeometry) {
      return
    }

    event.preventDefault()
    const nextPreviewScale = clamp(
      previewScale[0] + (event.deltaY < 0 ? 0.08 : -0.08),
      MIN_BACKGROUND_PREVIEW_SCALE,
      MAX_BACKGROUND_PREVIEW_SCALE,
    )

    if (nextPreviewScale === previewScale[0]) {
      return
    }

    const coverScale = Math.max(
      surfaceSize.width / naturalSize.width,
      surfaceSize.height / naturalSize.height,
    )
    const nextImageWidth = naturalSize.width * coverScale * nextPreviewScale
    const nextImageHeight = naturalSize.height * coverScale * nextPreviewScale
    const nextImageLeft = (surfaceSize.width - nextImageWidth) / 2
    const nextImageTop = (surfaceSize.height - nextImageHeight) / 2

    setPreviewScale([nextPreviewScale])
    setFocus({
      x: clamp((cropGeometry.frameCenterX - nextImageLeft) / nextImageWidth, 0, 1),
      y: clamp((cropGeometry.frameCenterY - nextImageTop) / nextImageHeight, 0, 1),
    })
  }

  const handleResetView = () => {
    setPreviewScale([getPreviewScaleFromSavedScale(1)])
    setFocus({ x: 0.5, y: 0.5 })
    setBlur([0])
    setOpacity([uiSettings.background_image_opacity])
  }

  const handlePickImage = async () => {
    const picked = await onRequestPickImage()
    if (!picked) {
      return
    }
    setDraftImage(picked.dataUrl)
    setDraftFileName(picked.fileName)
    setDraftSizeBytes(picked.sizeBytes)
    setPreviewScale([getPreviewScaleFromSavedScale(1)])
    setFocus({ x: 0.5, y: 0.5 })
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
        left: `${cropGeometry.frameCenterX - cropGeometry.frameWidth / 2}px`,
        top: `${cropGeometry.frameCenterY - cropGeometry.frameHeight / 2}px`,
        width: `${cropGeometry.frameWidth}px`,
        height: `${cropGeometry.frameHeight}px`,
      } as React.CSSProperties,
    }
  }, [blur, cropGeometry, draftImage, opacity])

  const miniPreviewLayout = React.useMemo(() => {
    if (!draftImage || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return null
    }

    return getImageLayout({
      viewportWidth: 288,
      viewportHeight: 180,
      imageWidth: naturalSize.width,
      imageHeight: naturalSize.height,
      scale: getSavedScaleFromPreviewScale(previewScale[0]),
      focusX: focus.x,
      focusY: focus.y,
    })
  }, [draftImage, focus.x, focus.y, naturalSize.height, naturalSize.width, previewScale])

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-w-[76rem] gap-0 overflow-hidden p-0 sm:max-w-[76rem]">
        <div className="flex max-h-[88vh] flex-col">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle className="text-base font-semibold leading-tight">自定义换肤</DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  直接从系统资源管理器选择图片，拖动展示框确定显示区域，滚轮缩放画面，主界面会实时同步预览。
                </DialogDescription>
              </div>
              <div className="rounded-lg border border-primary/25 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">
                当前 UI 已实时预览
              </div>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1.2fr)_22rem]">
            <div className="min-h-0 p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-tight">换肤取景区</p>
                    <p className="text-xs text-muted-foreground">
                      拖动方框选择展示区域，滚轮快速缩放画面。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void handlePickImage()} disabled={isSaving}>
                      <ImagePlus className="mr-2 h-4 w-4" />
                      重新选择
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isSaving || !draftImage}
                      onClick={() => {
                        setDraftImage(null)
                        setDraftFileName("")
                        setDraftSizeBytes(undefined)
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      移除换肤
                    </Button>
                  </div>
                </div>

                <div
                  ref={surfaceRef}
                  className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border bg-muted/20"
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
                      <div className="absolute inset-0 bg-black/18" />
                      {surfacePreviewLayout && cropGeometry ? (
                        <button
                          type="button"
                          className="absolute rounded-xl border border-white/80 bg-transparent shadow-[0_0_0_9999px_rgba(8,13,20,0.46)] ring-1 ring-white/20 backdrop-blur-[1px] transition-[border-color,box-shadow] hover:border-primary/85 active:cursor-grabbing"
                          style={surfacePreviewLayout.frameStyle}
                          onPointerDown={(event) => {
                            if (!cropGeometry) {
                              return
                            }
                            event.preventDefault()
                            setDragState({
                              pointerId: event.pointerId,
                              startX: event.clientX,
                              startY: event.clientY,
                              startCenterX: cropGeometry.frameCenterX,
                              startCenterY: cropGeometry.frameCenterY,
                              geometry: cropGeometry,
                            })
                          }}
                        >
                          <div className="absolute inset-x-3 top-3 flex items-center justify-between text-[11px] font-medium tracking-[0.08em] text-white/92">
                            <span>展示区域</span>
                            <span>{Math.round(getSavedScaleFromPreviewScale(previewScale[0]) * 100)}%</span>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/16 bg-black/16 px-3 py-2 text-[11px] text-white/84">
                            <span>拖动调整构图</span>
                            <span>滚轮缩放</span>
                          </div>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                      <Sparkles className="h-5 w-5 text-primary" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">当前未设置换肤</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          选择一张图片后，这里会直接进入裁剪和缩放预览。
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void handlePickImage()} disabled={isSaving}>
                        <ImagePlus className="mr-2 h-4 w-4" />
                        选择图片
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="themed-thin-scrollbar min-h-0 overflow-y-auto border-t bg-muted/12 p-5 lg:border-t-0 lg:border-l">
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-sm font-medium">当前资源</p>
                  <div className="rounded-xl border bg-card px-4 py-3">
                    <p className="truncate text-sm font-medium">{draftFileName || "未选择图片"}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {draftSizeBytes ? <span>{formatBytes(draftSizeBytes)}</span> : null}
                      {naturalSize.width > 0 && naturalSize.height > 0 ? (
                        <span>{naturalSize.width} × {naturalSize.height}</span>
                      ) : null}
                      {draftImage ? (
                        <span>缩放 {Math.round(getSavedScaleFromPreviewScale(previewScale[0]) * 100)}%</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>透明度</Label>
                    <span className="text-xs text-muted-foreground">{opacity[0]}%</span>
                  </div>
                  <Slider
                    value={opacity}
                    onValueChange={setOpacity}
                    min={0}
                    max={100}
                    step={1}
                    disabled={isSaving || !draftImage}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>模糊度</Label>
                    <span className="text-xs text-muted-foreground">{blur[0]}px</span>
                  </div>
                  <Slider
                    value={blur}
                    onValueChange={setBlur}
                    min={0}
                    max={24}
                    step={1}
                    disabled={isSaving || !draftImage}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>缩放</Label>
                    <span className="text-xs text-muted-foreground">{Math.round(getSavedScaleFromPreviewScale(previewScale[0]) * 100)}%</span>
                  </div>
                  <Slider
                    value={previewScale}
                    onValueChange={(value) => {
                      setPreviewScale(value)
                    }}
                    min={MIN_BACKGROUND_PREVIEW_SCALE}
                    max={MAX_BACKGROUND_PREVIEW_SCALE}
                    step={0.01}
                    disabled={isSaving || !draftImage}
                  />
                  <p className="text-xs text-muted-foreground">
                    鼠标滚轮也可以直接调整缩放。
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">界面预览</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-xs"
                      onClick={handleResetView}
                      disabled={isSaving || !draftImage}
                    >
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      重置视角
                    </Button>
                  </div>
                  <div className="relative h-[180px] overflow-hidden rounded-xl border bg-background/80">
                    {draftImage && miniPreviewLayout ? (
                      <>
                        <img
                          alt=""
                          src={draftImage}
                          className="absolute max-w-none"
                          style={{
                            left: `${miniPreviewLayout.left}px`,
                            top: `${miniPreviewLayout.top}px`,
                            width: `${miniPreviewLayout.width}px`,
                            height: `${miniPreviewLayout.height}px`,
                            opacity: opacity[0] / 100,
                            filter: `blur(${blur[0]}px)`,
                          }}
                        />
                        <div className="absolute inset-0 border-y border-white/14 bg-background/42" />
                        <div className="absolute inset-x-4 top-4 h-9 rounded-md border border-white/14 bg-card/72" />
                        <div className="absolute inset-y-[4.25rem] left-4 w-[4.6rem] rounded-lg border border-white/12 bg-sidebar/78" />
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        选择图片后显示界面预览
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-5 py-4">
            <Button variant="outline" onClick={() => handleDialogChange(false)} disabled={isSaving}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              保存换肤
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
