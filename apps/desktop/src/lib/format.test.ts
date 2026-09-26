import { describe, expect, it } from "vitest"

import { formatBytes, formatDurationCn, formatRelativeTime, formatTimecode, platformLabel, statusLabel } from "./format"

describe("formatTimecode", () => {
  it("formats under an hour as mm:ss", () => {
    expect(formatTimecode(0)).toBe("00:00")
    expect(formatTimecode(65)).toBe("01:05")
  })

  it("formats over an hour as h:mm:ss", () => {
    expect(formatTimecode(3725)).toBe("1:02:05")
  })

  it("is defensive about empty values", () => {
    expect(formatTimecode(undefined)).toBe("00:00")
    expect(formatTimecode(null)).toBe("00:00")
    expect(formatTimecode(-5)).toBe("00:00")
  })
})

describe("formatDurationCn", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDurationCn(45)).toBe("45 秒")
    expect(formatDurationCn(150)).toBe("2 分 30 秒")
    expect(formatDurationCn(3600)).toBe("1 小时 0 分")
  })
})

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})

describe("formatRelativeTime", () => {
  it("handles recent and old timestamps", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("刚刚")
    expect(formatRelativeTime("2000-01-01T00:00:00.000Z")).toMatch(/\d{2}\/\d{2}/)
  })

  it("returns a placeholder for invalid input", () => {
    expect(formatRelativeTime(undefined)).toBe("—")
    expect(formatRelativeTime("not-a-date")).toBe("—")
  })
})

describe("platformLabel", () => {
  it("maps known platforms to Chinese labels", () => {
    expect(platformLabel("local")).toBe("本地文件")
    expect(platformLabel("bilibili")).toBe("Bilibili")
    expect(platformLabel("unknown-platform")).toBe("未知来源")
  })
})

describe("statusLabel", () => {
  it("maps task statuses", () => {
    expect(statusLabel("succeeded")).toBe("已完成")
    expect(statusLabel("running")).toBe("处理中")
    expect(statusLabel("weird")).toBe("未知")
  })
})
