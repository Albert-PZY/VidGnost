function sanitizeKeyPrefix(rawValue: string): string {
  return String(rawValue)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

export function generateTimeKey(prefix = "", exists?: (candidate: string) => boolean, now = new Date()): string {
  const timestamp = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  ].join("") + `-${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}${now.getSeconds().toString().padStart(2, "0")}`

  const normalizedPrefix = sanitizeKeyPrefix(prefix)
  const base = normalizedPrefix ? `${normalizedPrefix}-${timestamp}` : timestamp
  if (!exists || !exists(base)) {
    return base
  }

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix.toString().padStart(2, "0")}`
    if (!exists(candidate)) {
      return candidate
    }
  }

  throw new Error(`Unable to allocate unique time key for prefix=${normalizedPrefix}`)
}
