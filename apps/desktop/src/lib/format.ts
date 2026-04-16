const BYTES_PER_MEGABYTE = 1024 ** 2
const BYTES_PER_GIGABYTE = 1024 ** 3
const BYTES_PER_TERABYTE = 1024 ** 4

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB"
  }

  if (bytes >= BYTES_PER_TERABYTE) {
    return `${formatUnitValue(bytes / BYTES_PER_TERABYTE)} TB`
  }

  if (bytes >= BYTES_PER_GIGABYTE) {
    return `${formatUnitValue(bytes / BYTES_PER_GIGABYTE)} GB`
  }

  return `${formatUnitValue(bytes / BYTES_PER_MEGABYTE)} MB`
}

export function formatMegabytesInput(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0"
  }

  return formatUnitValue(bytes / BYTES_PER_MEGABYTE)
}

export function parseMegabytesInputToBytes(value: string, fallbackBytes: number): number {
  const parsedMegabytes = Number.parseFloat(String(value || "").trim())
  if (!Number.isFinite(parsedMegabytes) || parsedMegabytes <= 0) {
    return fallbackBytes
  }

  return Math.round(parsedMegabytes * BYTES_PER_MEGABYTE)
}

function formatUnitValue(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3
  return stripTrailingZeros(value.toFixed(digits))
}

function stripTrailingZeros(value: string): string {
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1")
}

export function formatSecondsAsClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function formatDurationSeconds(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds <= 0) {
    return "--:--"
  }

  return formatSecondsAsClock(totalSeconds)
}

export function formatDateTime(value: string): string {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.round(diffMs / 60000)

  if (Math.abs(diffMinutes) < 1) {
    return "刚刚"
  }

  if (Math.abs(diffMinutes) < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return `${diffHours} 小时前`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} 天前`
}
