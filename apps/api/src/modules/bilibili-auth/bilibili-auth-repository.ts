import path from "node:path"
import { rm } from "node:fs/promises"

import type { BilibiliAccount, BilibiliAuthStatus } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"
import { BILIBILI_COOKIE_WHITELIST } from "./bilibili-source.js"

export interface BilibiliPendingLogin {
  expires_at: string | null
  poll_interval_ms: number
  qr_image_data_url: string
  qrcode_key: string
  qrcode_url: string
}

export interface BilibiliAuthSnapshot {
  account: BilibiliAccount | null
  cookies: Record<string, string>
  expires_at: string | null
  last_error: string | null
  last_validated_at: string | null
  pending_login: BilibiliPendingLogin | null
  status: BilibiliAuthStatus
  updated_at: string
}

interface SaveActiveSessionInput {
  account: BilibiliAccount | null
  cookies: Record<string, string>
  last_validated_at: string
}

export class BilibiliAuthRepository {
  readonly #path: string

  constructor(config: AppConfig) {
    this.#path = path.join(config.storageDir, "config", "bilibili-auth.json")
  }

  async get(): Promise<BilibiliAuthSnapshot> {
    if (!(await pathExists(this.#path))) {
      return buildDefaultSnapshot()
    }
    return normalizeSnapshot(await readJsonFile<Partial<BilibiliAuthSnapshot>>(this.#path, buildDefaultSnapshot()))
  }

  async savePendingLogin(input: BilibiliPendingLogin): Promise<BilibiliAuthSnapshot> {
    const current = await this.get()
    const now = new Date().toISOString()
    const nextValue = normalizeSnapshot({
      ...current,
      expires_at: input.expires_at,
      last_error: null,
      pending_login: {
        expires_at: input.expires_at,
        poll_interval_ms: normalizePollIntervalMs(input.poll_interval_ms),
        qr_image_data_url: String(input.qr_image_data_url || "").trim(),
        qrcode_key: String(input.qrcode_key || "").trim(),
        qrcode_url: String(input.qrcode_url || "").trim(),
      },
      status: "pending",
      updated_at: now,
    })
    await writeJsonFile(this.#path, nextValue)
    return nextValue
  }

  async saveActiveSession(input: SaveActiveSessionInput): Promise<BilibiliAuthSnapshot> {
    const current = await this.get()
    const now = new Date().toISOString()
    const cookies = normalizeCookies(input.cookies)
    const nextValue = normalizeSnapshot({
      ...current,
      account: normalizeAccount(input.account),
      cookies,
      expires_at: null,
      last_error: null,
      last_validated_at: String(input.last_validated_at || "").trim() || now,
      pending_login: null,
      status: "active",
      updated_at: now,
    })
    await writeJsonFile(this.#path, nextValue)
    return nextValue
  }

  async markExpired(message: string): Promise<BilibiliAuthSnapshot> {
    const current = await this.get()
    const now = new Date().toISOString()
    const nextValue = normalizeSnapshot({
      ...current,
      cookies: {},
      expires_at: now,
      last_error: String(message || "").trim() || "Bilibili auth expired",
      pending_login: null,
      status: "expired",
      updated_at: now,
    })
    await writeJsonFile(this.#path, nextValue)
    return nextValue
  }

  async clearSession(): Promise<void> {
    if (!(await pathExists(this.#path))) {
      return
    }
    await rm(this.#path, { force: true })
  }
}

function buildDefaultSnapshot(): BilibiliAuthSnapshot {
  return {
    account: null,
    cookies: {},
    expires_at: null,
    last_error: null,
    last_validated_at: null,
    pending_login: null,
    status: "missing",
    updated_at: new Date().toISOString(),
  }
}

function normalizeSnapshot(payload: Partial<BilibiliAuthSnapshot>): BilibiliAuthSnapshot {
  const updatedAt = String(payload.updated_at || "").trim() || new Date().toISOString()
  const cookies = normalizeCookies(payload.cookies)
  const pendingLogin = payload.pending_login
    ? {
        expires_at: normalizeNullableString(payload.pending_login.expires_at),
        poll_interval_ms: normalizePollIntervalMs(payload.pending_login.poll_interval_ms),
        qr_image_data_url: String(payload.pending_login.qr_image_data_url || "").trim(),
        qrcode_key: String(payload.pending_login.qrcode_key || "").trim(),
        qrcode_url: String(payload.pending_login.qrcode_url || "").trim(),
      }
    : null

  return {
    account: normalizeAccount(payload.account),
    cookies,
    expires_at: normalizeNullableString(payload.expires_at),
    last_error: normalizeNullableString(payload.last_error),
    last_validated_at: normalizeNullableString(payload.last_validated_at),
    pending_login: pendingLogin && pendingLogin.qrcode_key && pendingLogin.qrcode_url ? pendingLogin : null,
    status: normalizeStatus(payload.status, pendingLogin, cookies),
    updated_at: updatedAt,
  }
}

function normalizeStatus(
  value: unknown,
  pendingLogin: BilibiliPendingLogin | null,
  cookies: Record<string, string>,
): BilibiliAuthStatus {
  const candidate = String(value || "").trim().toLowerCase()
  if (candidate === "expired") {
    return "expired"
  }
  if (candidate === "active" && Object.keys(cookies).length > 0) {
    return "active"
  }
  if ((candidate === "pending" || pendingLogin) && pendingLogin) {
    return "pending"
  }
  return Object.keys(cookies).length > 0 ? "active" : "missing"
}

function normalizeCookies(payload: unknown): Record<string, string> {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  return Object.fromEntries(
    BILIBILI_COOKIE_WHITELIST
      .map((name) => [name, String(raw[name] || "").trim()] as const)
      .filter(([, value]) => Boolean(value)),
  )
}

function normalizeAccount(value: unknown): BilibiliAccount | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const mid = String(candidate.mid || "").trim()
  const uname = String(candidate.uname || "").trim()
  if (!mid || !uname) {
    return null
  }
  return {
    mid,
    uname,
  }
}

function normalizeNullableString(value: unknown): string | null {
  const candidate = String(value || "").trim()
  return candidate || null
}

function normalizePollIntervalMs(value: unknown): number {
  const parsed = Number.parseInt(String(value || 1500), 10)
  if (!Number.isFinite(parsed)) {
    return 1500
  }
  return Math.max(500, Math.min(10_000, parsed))
}
