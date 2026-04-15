const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv"] as const

const SUPPORTED_VIDEO_EXTENSION_SET = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS)

export const SUPPORTED_VIDEO_ACCEPT = SUPPORTED_VIDEO_EXTENSIONS.join(",")
export const SUPPORTED_VIDEO_LABEL = "MP4、MOV、AVI、MKV"

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return ""
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`
}

export function getVideoExtension(value: string): string {
  const normalized = value.trim()
  const lastDotIndex = normalized.lastIndexOf(".")
  if (lastDotIndex < 0) {
    return ""
  }
  return normalizeExtension(normalized.slice(lastDotIndex))
}

export function isSupportedVideoExtension(value: string): boolean {
  return SUPPORTED_VIDEO_EXTENSION_SET.has(normalizeExtension(value))
}

export function isSupportedVideoFileName(value: string): boolean {
  return isSupportedVideoExtension(getVideoExtension(value))
}

export function getUnsupportedVideoNames<T extends { name: string }>(items: readonly T[]): string[] {
  return items.filter((item) => !isSupportedVideoFileName(item.name)).map((item) => item.name)
}

export { SUPPORTED_VIDEO_EXTENSIONS }
