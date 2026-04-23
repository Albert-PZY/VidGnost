import type { TranscriptSegment } from "@vidgnost/contracts"

import { buildTranscriptText, parseJsonSubtitleSegments } from "../asr/transcript-segment-normalizer.js"
import { BilibiliAuthRepository } from "./bilibili-auth-repository.js"
import {
  baseLanguage,
  buildBilibiliCookieHeader,
  buildBilibiliRequestHeaders,
  extractBvid,
  looksLikeExpiredAuth,
  normalizeBilibiliSubtitleUrl,
  normalizeLanguage,
  rankLanguage,
} from "./bilibili-source.js"

interface BilibiliSubtitleClientDependencies {
  fetch?: typeof fetch
}

interface BilibiliSubtitleTrack {
  ext: string
  label: string
  language: string
  subtitle_url: string
}

export interface ResolvedBilibiliSubtitle {
  language: string
  raw_subtitle_json: string
  segments: TranscriptSegment[]
  source: "bilibili-auth"
  subtitle_url: string
  text: string
  track: BilibiliSubtitleTrack
}

export class BilibiliSubtitleClient {
  private readonly fetchImpl?: typeof fetch

  constructor(
    private readonly repository: BilibiliAuthRepository,
    dependencies: BilibiliSubtitleClientDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch
  }

  async fetchBestSubtitle(input: {
    preferredLanguage?: string | null
    signal?: AbortSignal
    sourceInput: string
  }): Promise<ResolvedBilibiliSubtitle | null> {
    const snapshot = await this.repository.get()
    if (snapshot.status !== "active" || Object.keys(snapshot.cookies).length === 0) {
      return null
    }

    const bvid = extractBvid(input.sourceInput)
    if (!bvid) {
      return null
    }

    const cookieHeader = buildBilibiliCookieHeader(snapshot.cookies)
    const viewPayload = await this.fetchJson<{
      code?: number
      data?: {
        aid?: number | string
        cid?: number | string
        pages?: Array<{ cid?: number | string }>
      }
      message?: string
    }>(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      headers: buildBilibiliRequestHeaders(),
      method: "GET",
      signal: input.signal,
    })
    const aid = String(viewPayload.data?.aid || "").trim()
    const cid = String(viewPayload.data?.cid || viewPayload.data?.pages?.[0]?.cid || "").trim()
    if (!aid || !cid) {
      return null
    }

    const playerResponse = await this.fetchResponse(
      `https://api.bilibili.com/x/player/wbi/v2?aid=${encodeURIComponent(aid)}&cid=${encodeURIComponent(cid)}`,
      {
        headers: buildBilibiliRequestHeaders(cookieHeader),
        method: "GET",
        signal: input.signal,
      },
    )
    const playerBody = await playerResponse.text()
    const playerPayload = tryParseJson(playerBody) as {
      code?: number
      data?: {
        subtitle?: {
          subtitles?: Array<{
            lang?: string
            lan?: string
            lan_doc?: string
            subtitle_url?: string
          }>
        }
      }
      message?: string
    } | null
    if (looksLikeExpiredAuth(playerResponse.status, playerPayload)) {
      await this.repository.markExpired(String(playerPayload?.message || "").trim() || "Bilibili 登录态已失效")
      return null
    }
    if (!playerPayload) {
      return null
    }

    const track = selectBestTrack(playerPayload.data?.subtitle?.subtitles, input.preferredLanguage)
    if (!track) {
      return null
    }

    const subtitleResponse = await this.fetchResponse(track.subtitle_url, {
      headers: buildBilibiliRequestHeaders(cookieHeader),
      method: "GET",
      signal: input.signal,
    })
    const rawSubtitleJson = await subtitleResponse.text()
    const subtitlePayload = tryParseJson(rawSubtitleJson)
    if (looksLikeExpiredAuth(subtitleResponse.status, subtitlePayload)) {
      await this.repository.markExpired("Bilibili 登录态已失效")
      return null
    }
    const segments = parseJsonSubtitleSegments(rawSubtitleJson)
    const text = buildTranscriptText(segments)
    if (!segments.length || !text) {
      return null
    }

    return {
      language: track.language,
      raw_subtitle_json: rawSubtitleJson,
      segments,
      source: "bilibili-auth",
      subtitle_url: track.subtitle_url,
      text,
      track,
    }
  }

  private async fetchJson<T>(input: string, init: RequestInit): Promise<T> {
    const response = await this.fetchResponse(input, init)
    return parseJsonPayload<T>(response)
  }

  private async fetchResponse(input: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl ? this.fetchImpl(input, init) : fetch(input, init)
  }
}

function selectBestTrack(
  payload: Array<{
    lang?: string
    lan?: string
    lan_doc?: string
    subtitle_url?: string
  }> | undefined,
  preferredLanguage?: string | null,
): BilibiliSubtitleTrack | null {
  const tracks = (payload || [])
    .map((item) => ({
      ext: "json",
      label: String(item.lan_doc || item.lan || item.lang || "").trim(),
      language: normalizeLanguage(item.lan || item.lang),
      subtitle_url: normalizeBilibiliSubtitleUrl(item.subtitle_url || ""),
    }))
    .filter((item) => Boolean(item.language) && Boolean(item.subtitle_url))
  if (tracks.length === 0) {
    return null
  }

  return [...tracks].sort((left, right) => {
    const languageRank = rankLanguage(left.language, preferredLanguage) - rankLanguage(right.language, preferredLanguage)
    if (languageRank !== 0) {
      return languageRank
    }
    const baseRank =
      Number(baseLanguage(left.language) !== baseLanguage(preferredLanguage)) -
      Number(baseLanguage(right.language) !== baseLanguage(preferredLanguage))
    if (baseRank !== 0) {
      return baseRank
    }
    return left.language.localeCompare(right.language)
  })[0] || null
}

async function parseJsonPayload<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
