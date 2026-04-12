const APPEARANCE_TRANSITION_STATE_ATTR = "data-appearance-transition"
const APPEARANCE_TRANSITION_KIND_ATTR = "data-appearance-transition-kind"
const THEME_TRANSITION_MS = 300
const HUE_TRANSITION_MS = 220
const REDUCED_MOTION_TRANSITION_MS = 120

type AppearanceTransitionKind = "theme" | "hue"

type ViewTransitionLike = {
  finished: Promise<void>
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike
}

let clearAppearanceTransitionTimer: number | null = null

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

export async function runThemeAppearanceTransition(update: () => void | Promise<void>) {
  if (typeof document === "undefined") {
    await update()
    return
  }

  const durationMs = getTransitionDurationMs()
  applyAppearanceTransitionState("theme", durationMs)

  const doc = document as DocumentWithViewTransition
  if (typeof doc.startViewTransition === "function" && !prefersReducedMotion()) {
    try {
      const transition = doc.startViewTransition(() => {
        void update()
      })
      await transition.finished
      return
    } catch {
      // Fall back to CSS-only transition when the View Transition API is unavailable at runtime.
    }
  }

  await update()
}
