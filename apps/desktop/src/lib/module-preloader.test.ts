import { describe, expect, it, vi } from "vitest"

import { createCachedModulePreloader } from "./module-preloader"

describe("createCachedModulePreloader", () => {
  it("runs each loader only once across repeated preload calls", async () => {
    const firstLoader = vi.fn().mockResolvedValue({ default: "first" })
    const secondLoader = vi.fn().mockResolvedValue({ default: "second" })
    const preload = createCachedModulePreloader([firstLoader, secondLoader])

    await Promise.all([preload(), preload(), preload()])

    expect(firstLoader).toHaveBeenCalledTimes(1)
    expect(secondLoader).toHaveBeenCalledTimes(1)
  })

  it("allows retrying after a failed preload attempt", async () => {
    const flakyLoader = vi
      .fn<() => Promise<{ default: string }>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ default: "ok" })
    const stableLoader = vi.fn().mockResolvedValue({ default: "stable" })
    const preload = createCachedModulePreloader([flakyLoader, stableLoader])

    await expect(preload()).rejects.toThrow("boom")
    await expect(preload()).resolves.toBeUndefined()

    expect(flakyLoader).toHaveBeenCalledTimes(2)
    expect(stableLoader).toHaveBeenCalledTimes(2)
  })
})
