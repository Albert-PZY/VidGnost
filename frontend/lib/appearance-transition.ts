const APPEARANCE_TRANSITION_STATE_ATTR = "data-appearance-transition"
const APPEARANCE_TRANSITION_KIND_ATTR = "data-appearance-transition-kind"
const THEME_TRANSITION_FREEZE_STYLE_ATTR = "data-appearance-transition-freeze"
const THEME_TRANSITION_MS = 220
const HUE_TRANSITION_MS = 220
const REDUCED_MOTION_TRANSITION_MS = 160
const APPEARANCE_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const THEME_FADE_OPACITY = 0.92
const THEME_FADE_OPACITY_WITH_WALLPAPER = 0.22
const THEME_FADE_ENTER_RATIO = 0.38
const THEME_FADE_ENTER_MIN_MS = 68
const THEME_FADE_ENTER_MAX_MS = 96

type AppearanceTransitionKind = "theme" | "hue"

let clearAppearanceTransitionTimer: number | null = null
let activeThemeTransitionCleanup: (() => void) | null = null

function getAppearanceRoot() {
  return typeof document !== "undefined" ? document.documentElement : null
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function getTransitionDurationMs() {
  return prefersReducedMotion() ? REDUCED_MOTION_TRANSITION_MS : THEME_TRANSITION_MS
}

function getThemeFadeEnterDurationMs(durationMs: number) {
  return Math.min(
    THEME_FADE_ENTER_MAX_MS,
    Math.max(THEME_FADE_ENTER_MIN_MS, Math.round(durationMs * THEME_FADE_ENTER_RATIO)),
  )
}

function applyAppearanceTransitionState(kind: AppearanceTransitionKind, durationMs: number) {
  const root = getAppearanceRoot()
  if (!root) {
    return
  }

  if (clearAppearanceTransitionTimer !== null) {
    window.clearTimeout(clearAppearanceTransitionTimer)
    clearAppearanceTransitionTimer = null
  }

  root.setAttribute(APPEARANCE_TRANSITION_STATE_ATTR, "active")
  root.setAttribute(APPEARANCE_TRANSITION_KIND_ATTR, kind)
  root.style.setProperty(
    "--appearance-active-transition-duration",
    `${Math.max(1, Math.round(durationMs))}ms`,
  )

  clearAppearanceTransitionTimer = window.setTimeout(() => {
    root.removeAttribute(APPEARANCE_TRANSITION_STATE_ATTR)
    root.removeAttribute(APPEARANCE_TRANSITION_KIND_ATTR)
    root.style.removeProperty("--appearance-active-transition-duration")
    clearAppearanceTransitionTimer = null
  }, durationMs + 34)
}

export function pulseHueAppearanceTransition() {
  if (typeof window === "undefined") {
    return
  }

  const durationMs = prefersReducedMotion() ? REDUCED_MOTION_TRANSITION_MS : HUE_TRANSITION_MS
  applyAppearanceTransitionState("hue", durationMs)
}

function createThemeTransitionFreezeStyle() {
  if (typeof document === "undefined") {
    return null
  }

  const style = document.createElement("style")
  style.setAttribute(THEME_TRANSITION_FREEZE_STYLE_ATTR, "theme")
  style.textContent = `
body *,
body *::before,
body *::after {
  transition-property: none !important;
  animation: none !important;
}
`
  document.head.appendChild(style)

  return {
    cleanup: () => {
      style.remove()
    },
  }
}

function createThemeFadeLayer(durationMs: number) {
  if (typeof document === "undefined") {
    return null
  }

  const root = document.documentElement
  const body = document.body
  const bodyStyle = window.getComputedStyle(body)
  const rootStyle = window.getComputedStyle(root)
  const hasWallpaper = body.dataset.appBackgroundActive === "true"
  const overlay = document.createElement("div")
  const targetOpacity = hasWallpaper
    ? THEME_FADE_OPACITY_WITH_WALLPAPER
    : THEME_FADE_OPACITY
  const overlayBackground = bodyStyle.backgroundColor || rootStyle.backgroundColor

  overlay.setAttribute("aria-hidden", "true")
  overlay.style.position = "fixed"
  overlay.style.inset = "0"
  overlay.style.pointerEvents = "none"
  overlay.style.zIndex = "2147483647"
  overlay.style.opacity = "0"
  overlay.style.background = overlayBackground
  overlay.style.transition = `opacity ${durationMs}ms ${APPEARANCE_TRANSITION_EASING}`
  overlay.style.willChange = "opacity"
  overlay.style.contain = "strict"
  overlay.style.transform = "translate3d(0, 0, 0)"
  overlay.style.backfaceVisibility = "hidden"
  root.appendChild(overlay)

  const cleanup = () => {
    overlay.remove()
  }

  return {
    overlay,
    cleanup,
    targetOpacity,
  }
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function waitForDuration(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

export async function runThemeAppearanceTransition(update: () => void | Promise<void>) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    await update()
    return
  }

  activeThemeTransitionCleanup?.()
  activeThemeTransitionCleanup = null

  const durationMs = getTransitionDurationMs()
  const enterDurationMs = getThemeFadeEnterDurationMs(durationMs)
  const freezeStyle = createThemeTransitionFreezeStyle()
  const fadeLayer = createThemeFadeLayer(durationMs)

  if (!fadeLayer) {
    freezeStyle?.cleanup()
    await update()
    return
  }

  applyAppearanceTransitionState("theme", enterDurationMs + durationMs)

  const cleanup = () => {
    freezeStyle?.cleanup()
    fadeLayer.cleanup()
  }

  activeThemeTransitionCleanup = cleanup

  try {
    await nextAnimationFrame()
    fadeLayer.overlay.style.opacity = String(fadeLayer.targetOpacity)
    await waitForDuration(enterDurationMs)
    await update()
    await nextAnimationFrame()
    await nextAnimationFrame()
    fadeLayer.overlay.style.opacity = "0"
    await waitForDuration(durationMs + 24)
  } finally {
    if (activeThemeTransitionCleanup === cleanup) {
      activeThemeTransitionCleanup = null
    }
    cleanup()
  }
}
