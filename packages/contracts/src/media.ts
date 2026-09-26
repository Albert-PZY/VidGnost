import type { IsoDateTime } from "./common.js"

/** 媒体来源类型。 */
export type SourceKind = "local_file" | "local_path" | "url"

/** 平台识别结果，用于决定是否走平台字幕轨道。 */
export type SourcePlatform = "local" | "direct" | "youtube" | "bilibili" | "other"

export interface MediaSource {
  kind: SourceKind
  /** 原始输入：绝对路径或 URL。 */
  uri: string
  /** 平台判定。 */
  platform: SourcePlatform
  /** 展示标题（不含扩展名）。 */
  title: string
  /** 实际落盘的媒体文件绝对路径。 */
  mediaPath: string
  /** 无视频轨的纯音频来源。 */
  audioOnly: boolean
  durationSeconds: number
  sizeBytes: number
  /** 内容指纹（前 1MB + 大小 + 时长），用于去重与缓存命中。 */
  fingerprint: string
  createdAt: IsoDateTime
}

export interface MediaProbe {
  durationSeconds: number
  audioCodec: string | null
  videoCodec: string | null
  width: number | null
  height: number | null
  hasAudio: boolean
}
