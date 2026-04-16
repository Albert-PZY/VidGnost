export function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}

export function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseFloat(String(value ?? "").trim())
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}
