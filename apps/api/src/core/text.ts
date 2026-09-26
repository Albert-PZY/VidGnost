/** 文本工具：时间码、分词、JSON 抽取、截断。 */

/** `75` → `01:15`；超过 1 小时 → `1:02:03`。 */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** 解析 `mm:ss` / `hh:mm:ss` / 纯秒数字符串。 */
export function parseTimecode(input: string): number | null {
  const value = String(input || "").trim()
  if (!value) {
    return null
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }
  const match = value.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/)
  if (!match) {
    return null
  }
  const first = Number(match[1])
  const second = Number(match[2])
  const third = match[3] === undefined ? null : Number(match[3])
  return third === null ? first * 60 + second : first * 3600 + second * 60 + third
}

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 检索分词：
 * - 拉丁字母与数字按小写单词切分；
 * - CJK 连续串长度 ≥2 时只产出相邻二元组，避免单字带来的巨量噪声匹配；
 *   孤立的单字（长度 1 的串）保留为单字 token；
 * - 过滤纯标点与空白。
 */
export function tokenize(input: string): string[] {
  const text = String(input || "").toLowerCase()
  const tokens: string[] = []
  const buffer: string[] = []
  const cjkBuffer: string[] = []

  const flushLatin = () => {
    if (buffer.length > 0) {
      const word = buffer.join("")
      if (word.length > 1 || /[a-z0-9]/.test(word)) {
        tokens.push(word)
      }
      buffer.length = 0
    }
  }
  const flushCjk = () => {
    if (cjkBuffer.length === 0) {
      return
    }
    if (cjkBuffer.length === 1) {
      tokens.push(cjkBuffer[0])
    } else {
      for (let index = 0; index < cjkBuffer.length - 1; index += 1) {
        tokens.push(`${cjkBuffer[index]}${cjkBuffer[index + 1]}`)
      }
    }
    cjkBuffer.length = 0
  }

  for (const char of text) {
    if (/[a-z0-9]/.test(char)) {
      flushCjk()
      buffer.push(char)
    } else if (CJK_PATTERN.test(char)) {
      flushLatin()
      cjkBuffer.push(char)
    } else {
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return tokens
}

/** 简单的 token 数估算：CJK 1 字 ≈ 1 token，拉丁 4 字符 ≈ 1 token。 */
export function estimateTokens(input: string): number {
  const text = String(input || "")
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (CJK_PATTERN.test(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return cjk + Math.ceil(other / 4)
}

/** 把长文本按预算切段，优先在句子/段落边界断开。 */
export function splitByTokenBudget(input: string, maxTokens: number): string[] {
  const text = String(input || "").trim()
  if (!text) {
    return []
  }
  if (estimateTokens(text) <= maxTokens) {
    return [text]
  }

  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ""
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(current)
      current = ""
    }
    if (estimateTokens(paragraph) <= maxTokens) {
      current = paragraph
      continue
    }
    for (const sentence of splitSentences(paragraph)) {
      const next = current ? `${current}${sentence}` : sentence
      if (estimateTokens(next) <= maxTokens) {
        current = next
      } else {
        if (current) {
          chunks.push(current)
        }
        current = sentence
      }
    }
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

const SENTENCE_BOUNDARY = /(?<=[。！？；!?;])\s*|(?<=\.)\s+(?=[A-Z])/g

export function splitSentences(input: string): string[] {
  return String(input || "")
    .split(SENTENCE_BOUNDARY)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 从模型输出中抽取 JSON。容忍 ```json 围栏、前后解释文字、以及首尾多余字符。
 */
export function extractJson<T = unknown>(input: string): T | null {
  const text = String(input || "").trim()
  if (!text) {
    return null
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1].trim() : text

  const direct = tryParse<T>(candidate)
  if (direct !== null) {
    return direct
  }

  const startIndex = candidate.search(/[[{]/)
  if (startIndex < 0) {
    return null
  }
  const openChar = candidate[startIndex]
  const closeChar = openChar === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === openChar) {
      depth += 1
    } else if (char === closeChar) {
      depth -= 1
      if (depth === 0) {
        return tryParse<T>(candidate.slice(startIndex, index + 1))
      }
    }
  }
  return null
}

function tryParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T
  } catch {
    return null
  }
}

/** 生成带省略号的摘要片段。 */
export function snippet(input: string, maxLength = 120): string {
  const text = String(input || "").replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}…`
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}
