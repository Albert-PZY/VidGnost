const DEFAULT_DIMENSIONS = 48

export class EmbeddingRuntimeService {
  embedText(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
    const tokens = tokenizeText(text)
    return this.embedTokens(tokens, dimensions)
  }

  embedImageSemantic(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
    const tokens = tokenizeImageSemanticText(text)
    return this.embedTokens(tokens, dimensions)
  }

  private embedTokens(tokens: string[], dimensions: number): number[] {
    const vector = new Array<number>(dimensions).fill(0)
    if (tokens.length === 0) {
      return vector
    }

    for (const token of tokens) {
      const slot = Math.abs(hashToken(token)) % dimensions
      vector[slot] += 1
    }

    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
    if (norm <= 0) {
      return vector
    }
    return vector.map((value) => roundScore(value / norm))
  }

  cosineSimilarity(left: number[], right: number[]): number {
    const size = Math.min(left.length, right.length)
    let total = 0
    for (let index = 0; index < size; index += 1) {
      total += (left[index] || 0) * (right[index] || 0)
    }
    return roundScore(total)
  }
}

export function tokenizeText(text: string): string[] {
  const normalized = String(text || "").toLowerCase()
  const latinTokens = normalized.match(/[a-z0-9]{2,}/g) || []
  const cjkText = [...normalized].filter((char) => /\p{Script=Han}/u.test(char)).join("")
  const cjkUnigrams = cjkText ? [...cjkText] : []
  const cjkBigrams = buildCharacterNgrams(cjkText, 2)
  return [...new Set([...latinTokens, ...cjkUnigrams, ...cjkBigrams])]
}

export function tokenizeImageSemanticText(text: string): string[] {
  const normalized = String(text || "").toLowerCase()
  const tokens = tokenizeText(normalized)
  const visualHints = ["画面", "镜头", "场景", "图像", "帧", "人物", "动作", "表情", "字幕", "演示", "界面", "流程"]
  const hasVisualHint = visualHints.some((item) => normalized.includes(item))
  if (hasVisualHint) {
    return [...new Set([...tokens, ...visualHints.filter((item) => normalized.includes(item))])]
  }
  return tokens
}

function buildCharacterNgrams(text: string, size: number): string[] {
  const chars = [...String(text || "").replace(/\s+/g, "")]
  if (chars.length === 0) {
    return []
  }
  if (chars.length <= size) {
    return [chars.join("")]
  }
  const result: string[] = []
  for (let index = 0; index <= chars.length - size; index += 1) {
    result.push(chars.slice(index, index + size).join(""))
  }
  return result
}

function hashToken(token: string): number {
  let hash = 0
  for (const char of token) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return hash
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}
