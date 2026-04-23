export const BILIBILI_COOKIE_WHITELIST = [
  "DedeUserID",
  "DedeUserID__ckMd5",
  "SESSDATA",
  "bili_jct",
  "sid",
] as const

export type BilibiliCookieName = (typeof BILIBILI_COOKIE_WHITELIST)[number]
type BilibiliRequestHeaders = Record<string, string>

export function extractBvid(sourceInput: string): string | null {
  const raw = String(sourceInput || "").trim()
  if (!raw) {
    return null
  }

  const directMatch = /\b(BV[0-9A-Za-z]{10})\b/u.exec(raw)
  if (directMatch) {
    return directMatch[1]
  }

  try {
    const url = new URL(raw)
    const pathMatch = /\/video\/(BV[0-9A-Za-z]{10})/u.exec(url.pathname)
    return pathMatch?.[1] ?? null
  } catch {
    return null
  }
}

export function buildBilibiliCookieHeader(cookies: Record<string, string>): string {
  return BILIBILI_COOKIE_WHITELIST
    .map((name) => [name, String(cookies[name] || "").trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

export function buildBilibiliRequestHeaders(cookieHeader?: string | null): BilibiliRequestHeaders {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    Origin: "https://www.bilibili.com",
    Referer: "https://www.bilibili.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  }
}

export function collectSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().filter(Boolean)
  }

  const raw = response.headers.get("set-cookie") || ""
  if (!raw) {
    return []
  }
  return raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/gu).map((item) => item.trim()).filter(Boolean)
}

export function extractWhitelistedCookies(headers: string[]): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const header of headers) {
    const firstSegment = String(header || "").split(";")[0] || ""
    const separatorIndex = firstSegment.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }
    const name = firstSegment.slice(0, separatorIndex).trim()
    const value = firstSegment.slice(separatorIndex + 1).trim()
    if (!name || !value || !isWhitelistedCookieName(name)) {
      continue
    }
    cookies[name] = value
  }
  return cookies
}

export function normalizeBilibiliSubtitleUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || "").trim()
  if (!trimmed) {
    return ""
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`
  }
  return trimmed
}

export function normalizeLanguage(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

export function baseLanguage(value: unknown): string {
  return normalizeLanguage(value).split(/[-_]/u)[0] || ""
}

export function rankLanguage(value: string, preferredLanguage?: string | null): number {
  const normalized = normalizeLanguage(value)
  const normalizedPreferred = normalizeLanguage(preferredLanguage)
  if (!normalizedPreferred) {
    return 0
  }
  if (normalized === normalizedPreferred) {
    return 0
  }
  if (baseLanguage(normalized) === baseLanguage(normalizedPreferred)) {
    return 1
  }
  return 2
}

export function looksLikeExpiredAuth(status: number, payload: unknown): boolean {
  if (status === 401 || status === 403) {
    return true
  }

  const candidate = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const code = Number(candidate.code ?? 0)
  const message = String(candidate.message || candidate.msg || "").trim()
  return code === -101 || /未登录|登录态|权限|SESSDATA/u.test(message)
}

function isWhitelistedCookieName(value: string): value is BilibiliCookieName {
  return (BILIBILI_COOKIE_WHITELIST as readonly string[]).includes(value)
}
