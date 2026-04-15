import path from "node:path"

import { API_VERSION, DEFAULT_API_HOST, DEFAULT_API_PORT, DEFAULT_API_PREFIX, DEFAULT_APP_NAME } from "@vidgnost/shared"

export interface AppConfig {
  appName: string
  apiPrefix: string
  host: string
  port: number
  storageDir: string
  version: string
}

export function resolveConfig(): AppConfig {
  return {
    appName: process.env.VIDGNOST_APP_NAME?.trim() || DEFAULT_APP_NAME,
    apiPrefix: process.env.VIDGNOST_API_PREFIX?.trim() || DEFAULT_API_PREFIX,
    host: process.env.VIDGNOST_API_HOST?.trim() || DEFAULT_API_HOST,
    port: parsePort(process.env.VIDGNOST_API_PORT, DEFAULT_API_PORT),
    storageDir: resolvePath(process.env.VIDGNOST_STORAGE_DIR, ["backend", "storage"]),
    version: process.env.VIDGNOST_APP_VERSION?.trim() || API_VERSION,
  }
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  const candidate = Number.parseInt(String(rawValue || "").trim(), 10)
  if (!Number.isFinite(candidate) || candidate <= 0 || candidate > 65535) {
    return fallback
  }
  return candidate
}

function resolvePath(rawValue: string | undefined, fallbackSegments: string[]): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return path.resolve(process.cwd(), ...fallbackSegments)
  }
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(process.cwd(), candidate)
}
