export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
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

export function toFileUrl(localPath: string | null | undefined): string {
  if (!localPath) {
    return ""
  }

  const normalized = localPath.replace(/\\/g, "/")
  const withLeadingSlash = /^[A-Za-z]:/.test(normalized) ? `/${normalized}` : normalized
  return encodeURI(`file://${withLeadingSlash}`)
}
