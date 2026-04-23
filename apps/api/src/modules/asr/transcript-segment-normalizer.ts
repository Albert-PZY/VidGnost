import type { TranscriptSegment } from "@vidgnost/contracts"

export function parseWhisperSrtSegments(rawSrt: string): TranscriptSegment[] {
  return parseSrtSegments(rawSrt)
}

export function parseSrtSegments(rawSrt: string): TranscriptSegment[] {
  return String(rawSrt || "")
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
      const timestampLine = lines.find((line) => line.includes("-->")) || ""
      const textLines = lines.filter((line) => line !== timestampLine && !/^\d+$/u.test(line) && !looksLikeCueMetadata(line))
      const [startText, endText] = timestampLine.split("-->").map((item) => item.trim())
      return {
        start: parseSubtitleTimestamp(startText),
        end: parseSubtitleTimestamp(endText),
        text: normalizeTranscriptText(stripCueTags(textLines.join(" "))),
      }
    })
    .filter((segment) => segment.text.length > 0)
}

export function parseVttSegments(rawVtt: string): TranscriptSegment[] {
  return String(rawVtt || "")
    .replace(/^\uFEFF?WEBVTT[^\r\n]*\r?\n/u, "")
    .split(/\r?\n\r?\n/u)
    .map((block) => block.trim())
    .filter((block) => Boolean(block) && !/^(NOTE|STYLE|REGION)\b/u.test(block))
    .map((block) => {
      const lines = block
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
      const timestampIndex = lines.findIndex((line) => line.includes("-->"))
      if (timestampIndex < 0) {
        return null
      }
      const timestampLine = lines[timestampIndex]
      const textLines = lines
        .slice(timestampIndex + 1)
        .filter((line) => !looksLikeCueMetadata(line))
      const [startText, endText] = timestampLine.split("-->").map((item) => item.trim())
      return {
        start: parseSubtitleTimestamp(startText),
        end: parseSubtitleTimestamp(endText),
        text: normalizeTranscriptText(stripCueTags(textLines.join(" "))),
      }
    })
    .filter((segment): segment is TranscriptSegment => Boolean(segment && segment.text.length > 0))
}

export function parseJson3Segments(rawJson: string): TranscriptSegment[] {
  return parseJsonSubtitleSegments(rawJson)
}

export function parseJsonSubtitleSegments(rawJson: string): TranscriptSegment[] {
  try {
    const payload = JSON.parse(String(rawJson || "")) as {
      body?: Array<{
        content?: string
        from?: number
        to?: number
      }>
      events?: Array<{
        dDurationMs?: number
        segs?: Array<{ utf8?: string }>
        tStartMs?: number
      }>
    }
    if (Array.isArray(payload.body)) {
      return payload.body
        .map((segment) => ({
          start: Number(segment.from) || 0,
          end: Number(segment.to) || 0,
          text: normalizeTranscriptText(String(segment.content || "")),
        }))
        .filter((segment) => segment.text.length > 0)
    }
    return (payload.events || [])
      .map((event) => {
        const start = Number(event.tStartMs) / 1000 || 0
        const duration = Math.max(0, Number(event.dDurationMs) / 1000 || 0)
        const text = normalizeTranscriptText(
          (event.segs || [])
            .map((segment) => String(segment.utf8 || ""))
            .join("")
            .replace(/\r?\n+/gu, " "),
        )
        return {
          start,
          end: Number((start + duration).toFixed(3)),
          text,
        }
      })
      .filter((segment) => segment.text.length > 0)
  } catch {
    return []
  }
}

export function parseCaptionXmlSegments(rawXml: string): TranscriptSegment[] {
  const xml = String(rawXml || "")
  const segments: TranscriptSegment[] = []
  const pushSegment = (start: number, duration: number, text: string) => {
    const normalizedText = normalizeTranscriptText(stripCueTags(decodeHtmlEntities(text).replace(/\r?\n+/gu, " ")))
    if (!normalizedText) {
      return
    }
    segments.push({
      start: Number(start.toFixed(3)),
      end: Number((start + Math.max(0, duration)).toFixed(3)),
      text: normalizedText,
    })
  }

  const paragraphPattern = /<p\s+t="([^"]*)"(?:\s+d="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/gu
  let foundParagraph = false
  let match: RegExpExecArray | null = null
  while ((match = paragraphPattern.exec(xml)) !== null) {
    foundParagraph = true
    pushSegment((Number(match[1]) || 0) / 1000, (Number(match[2]) || 0) / 1000, match[3] || "")
  }
  if (foundParagraph) {
    return segments
  }

  const textPattern = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/gu
  while ((match = textPattern.exec(xml)) !== null) {
    pushSegment(Number(match[1]) || 0, Number(match[2]) || 0, match[3] || "")
  }
  return segments
}

export function normalizeRemoteSegments(
  segments: Array<{
    end: number
    start: number
    text: string
  }>,
): TranscriptSegment[] {
  return (segments || [])
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: normalizeTranscriptText(segment.text),
    }))
    .filter((segment) => segment.text.length > 0)
}

export function hasInvalidSegmentTimestamps(
  segments: Array<{
    end: number
    start: number
    text: string
  }>,
): boolean {
  return (segments || []).some((segment) => {
    const text = normalizeTranscriptText(segment.text)
    if (!text) {
      return false
    }
    const start = Number(segment.start)
    const end = Number(segment.end)
    return !Number.isFinite(start) || !Number.isFinite(end) || end < start
  })
}

export function buildTranscriptText(segments: TranscriptSegment[]): string {
  return (segments || [])
    .map((segment) => normalizeTranscriptText(segment.text))
    .filter(Boolean)
    .join("\n")
    .trim()
}

export function normalizeTranscriptText(value: string): string {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?，。！？；：])/gu, "$1")
    .replace(/([,.;:!?，。！？；：])(?![\s"'）】》])/gu, "$1 ")
    .replace(/ {2,}/gu, " ")
    .trim()
}

function parseSubtitleTimestamp(value: string | undefined): number {
  const match = /^(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})/u.exec(String(value || "").trim())
  if (!match) {
    return 0
  }
  const hours = Number(match[1]) || 0
  const minutes = Number(match[2]) || 0
  const seconds = Number(match[3]) || 0
  const milliseconds = Number(match[4]) || 0
  return Number((hours * 3600 + minutes * 60 + seconds + milliseconds / 1000).toFixed(3))
}

function stripCueTags(value: string): string {
  return String(value || "")
    .replace(/<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/gu, " ")
    .replace(/<\/?[^>]+>/gu, " ")
}

function looksLikeCueMetadata(value: string): boolean {
  return /^(align|position|size|line|vertical):/u.test(String(value || "").trim())
}

function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&nbsp;/gu, " ")
}
