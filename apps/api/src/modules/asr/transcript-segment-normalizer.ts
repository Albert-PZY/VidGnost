import type { TranscriptSegment } from "@vidgnost/contracts"

export function parseWhisperSrtSegments(rawSrt: string): TranscriptSegment[] {
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
      const textLines = lines.filter((line) => line !== timestampLine && !/^\d+$/u.test(line))
      const [startText, endText] = timestampLine.split("-->").map((item) => item.trim())
      return {
        start: parseSrtTimestamp(startText),
        end: parseSrtTimestamp(endText),
        text: normalizeTranscriptText(textLines.join(" ")),
      }
    })
    .filter((segment) => segment.text.length > 0)
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

function parseSrtTimestamp(value: string | undefined): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u.exec(String(value || "").trim())
  if (!match) {
    return 0
  }
  const hours = Number(match[1]) || 0
  const minutes = Number(match[2]) || 0
  const seconds = Number(match[3]) || 0
  const milliseconds = Number(match[4]) || 0
  return Number((hours * 3600 + minutes * 60 + seconds + milliseconds / 1000).toFixed(3))
}
