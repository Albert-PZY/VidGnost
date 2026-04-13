"use client"

import { buildTaskArtifactFileUrl } from "@/lib/api"

const CODE_FENCE_PATTERN = /```[\s\S]*?```/g
const TIMESTAMP_PATTERN =
  /(^|[\s(（\[])(\d{1,2}:\d{2}(?::\d{2})?)(?=([\s)\]，。,.!！?？:：]|$))/g
const RELATIVE_IMAGE_PATTERN =
  /(!\[[^\]]*]\()((?:\.{1,2}\/)?(?:notes-images\/)?[^)\s]+\.(?:png|jpg|jpeg|gif|webp|svg))(\))/gi

export function timeTextToSeconds(raw: string): number {
  const parts = raw.split(":").map((item) => Number(item))
  if (parts.some((item) => Number.isNaN(item))) {
    return 0
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return parts[0] * 60 + parts[1]
}

export function decorateMarkdownContent(markdown: string, taskId?: string): string {
  const fences = markdown.match(CODE_FENCE_PATTERN) ?? []
  let fenceIndex = 0

  return markdown
    .replace(CODE_FENCE_PATTERN, () => `@@CODE_FENCE_${fenceIndex++}@@`)
    .replace(RELATIVE_IMAGE_PATTERN, (_match, prefix, pathValue, suffix) => {
      const trimmed = String(pathValue).trim()
      if (/^(?:https?:|data:|file:|blob:)/i.test(trimmed) || !taskId) {
        return `${prefix}${trimmed}${suffix}`
      }
      return `${prefix}${buildTaskArtifactFileUrl(taskId, trimmed)}${suffix}`
    })
    .replace(TIMESTAMP_PATTERN, (_match, leading, stamp) => {
      const seconds = timeTextToSeconds(stamp)
      return `${leading}[${stamp}](vidgnost://seek/${seconds})`
    })
    .replace(/@@CODE_FENCE_(\d+)@@/g, (_match, indexText) => fences[Number(indexText)] ?? "")
}
