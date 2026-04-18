import { describe, expect, it } from "vitest"

import { resolveBlurRenderMode } from "./background-render-mode"

describe("background-render-mode", () => {
  it("prefers static blur in Electron on Windows to avoid GPU renderer instability", () => {
    expect(
      resolveBlurRenderMode({
        blur: 14,
        width: 1920,
        height: 1080,
        devicePixelRatio: 1.5,
        isDesktopShell: true,
        platform: "Win32",
        hardwareConcurrency: 12,
        deviceMemory: 16,
      }),
    ).toBe("static")
  })

  it("keeps WebGL blur for capable browser environments", () => {
    expect(
      resolveBlurRenderMode({
        blur: 12,
        width: 1440,
        height: 900,
        devicePixelRatio: 1.25,
        isDesktopShell: false,
        platform: "MacIntel",
        hardwareConcurrency: 10,
        deviceMemory: 8,
      }),
    ).toBe("webgl")
  })

  it("falls back to static blur on low-end devices with large surfaces", () => {
    expect(
      resolveBlurRenderMode({
        blur: 16,
        width: 1680,
        height: 1050,
        devicePixelRatio: 1.5,
        isDesktopShell: false,
        platform: "Linux x86_64",
        hardwareConcurrency: 4,
        deviceMemory: 4,
      }),
    ).toBe("static")
  })
})
