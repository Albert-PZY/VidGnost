import { describe, expect, it } from "vitest"

import {
  formatBytes,
  formatMegabytesInput,
  parseMegabytesInputToBytes,
} from "../../desktop/src/lib/format.js"

describe("frontend byte formatting", () => {
  it("uses MB as the minimum display unit while preserving GB", () => {
    expect(formatBytes(0)).toBe("0 MB")
    expect(formatBytes(512 * 1024)).toBe("0.5 MB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB")
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB")
  })

  it("converts image size limits between bytes and MB for settings forms", () => {
    expect(formatMegabytesInput(524288)).toBe("0.5")
    expect(formatMegabytesInput(8 * 1024 * 1024)).toBe("8")
    expect(parseMegabytesInputToBytes("0.5", 524288)).toBe(524288)
    expect(parseMegabytesInputToBytes("8", 524288)).toBe(8 * 1024 * 1024)
  })
})
