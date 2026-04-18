export type BlurRenderMode = "webgl" | "static"

export interface ResolveBlurRenderModeInput {
  blur: number
  width: number
  height: number
  devicePixelRatio?: number | null
  isDesktopShell?: boolean
  platform?: string | null
  hardwareConcurrency?: number | null
  deviceMemory?: number | null
}

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function resolveBlurRenderMode(input: ResolveBlurRenderModeInput): BlurRenderMode {
  const blur = Number.isFinite(input.blur) ? Math.max(0, input.blur) : 0
  if (blur <= 0) {
    return "static"
  }

  const platform = String(input.platform || "").trim().toLowerCase()
  if (input.isDesktopShell && platform.startsWith("win")) {
    return "static"
  }

  const devicePixelRatio = clamp(
    Number.isFinite(input.devicePixelRatio) ? Number(input.devicePixelRatio) : 1,
    1,
    2,
  )
  const viewportWidth = Math.max(0, Math.round(input.width || 0))
  const viewportHeight = Math.max(0, Math.round(input.height || 0))
  const weightedSurface = viewportWidth * viewportHeight * devicePixelRatio

  const hardwareConcurrency =
    Number.isFinite(input.hardwareConcurrency) && Number(input.hardwareConcurrency) > 0
      ? Number(input.hardwareConcurrency)
      : null
  const deviceMemory =
    Number.isFinite(input.deviceMemory) && Number(input.deviceMemory) > 0
      ? Number(input.deviceMemory)
      : null

  const lowCpu = hardwareConcurrency !== null && hardwareConcurrency <= 4
  const lowMemory = deviceMemory !== null && deviceMemory <= 4

  if ((lowCpu || lowMemory) && weightedSurface >= 1_800_000) {
    return "static"
  }

  if (weightedSurface >= 3_000_000 && blur >= 12) {
    return "static"
  }

  return "webgl"
}

export function resolveBlurRenderModeFromWindowState(options: {
  blur: number
  width: number
  height: number
}): BlurRenderMode {
  if (typeof window === "undefined") {
    return "static"
  }

  const navigatorValue = window.navigator as NavigatorWithDeviceMemory
  return resolveBlurRenderMode({
    ...options,
    devicePixelRatio: window.devicePixelRatio,
    isDesktopShell: Boolean(window.vidGnostDesktop),
    platform: navigatorValue.platform || navigatorValue.userAgent || "",
    hardwareConcurrency: navigatorValue.hardwareConcurrency,
    deviceMemory: navigatorValue.deviceMemory,
  })
}
