import { tokenizeText } from "./embedding-runtime-service.js"

export interface RerankCandidate {
  text: string
  terms?: string[]
  lexical_score?: number
  vector_score: number
  source?: string
  source_set?: string[]
}

export class RerankRuntimeService {
  rerank<T extends RerankCandidate>(
    queryText: string,
    candidates: T[],
    topN: number,
  ): Array<T & { lexical_score: number; rerank_score: number }> {
    const queryTokens = tokenizeText(queryText)
    const normalizedQuery = String(queryText || "").trim()

    return candidates
      .map((candidate) => {
        const lexicalScore = Number.isFinite(candidate.lexical_score)
          ? roundScore(candidate.lexical_score || 0)
          : scoreLexicalMatch(queryTokens, normalizedQuery, candidate.terms ?? tokenizeText(candidate.text), candidate.text)
        const sourceWeight = resolveSourceWeight(candidate.source, candidate.source_set)
        return {
          ...candidate,
          lexical_score: lexicalScore,
          rerank_score: roundScore(((candidate.vector_score * 0.6) + (Math.min(1.5, lexicalScore) * 0.4)) * sourceWeight),
        }
      })
      .sort((left, right) => {
        if (right.rerank_score !== left.rerank_score) {
          return right.rerank_score - left.rerank_score
        }
        if (right.lexical_score !== left.lexical_score) {
          return right.lexical_score - left.lexical_score
        }
        return right.vector_score - left.vector_score
      })
      .slice(0, Math.max(1, topN))
  }
}

export function scoreLexicalMatch(
  queryTokens: string[],
  queryText: string,
  candidateTerms: string[],
  text: string,
): number {
  if (queryTokens.length === 0) {
    return 0
  }
  const candidateTokens = new Set(candidateTerms.map((item) => String(item || "").trim()).filter(Boolean))
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length
  const latinQueryTokens = [...new Set(queryTokens.filter((token) => /[a-z0-9]/i.test(token)))]
  const latinOverlap = latinQueryTokens.filter((token) => candidateTokens.has(token)).length
  const tokenDensity = overlap > 0 ? overlap / Math.max(candidateTokens.size, 1) : 0
  const containsWholeQuery = queryText && String(text || "").includes(queryText) ? 0.35 : 0
  const containsAllTerms = overlap === queryTokens.length && queryTokens.length > 1 ? 0.15 : 0
  const latinCoverage = latinQueryTokens.length > 0 ? latinOverlap / latinQueryTokens.length : 0
  return roundScore(
    (overlap / queryTokens.length) +
      containsWholeQuery +
      containsAllTerms +
      (tokenDensity * 0.35) +
      (latinCoverage * 0.5),
  )
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}

function resolveSourceWeight(source?: string, sourceSet?: string[]): number {
  const normalizedSource = String(source || "").trim()
  const normalizedSet = Array.isArray(sourceSet) ? sourceSet.map((item) => String(item || "").trim()) : []
  if (normalizedSource === "frame_semantic" || normalizedSet.includes("frame_semantic")) {
    return 0.98
  }
  if (normalizedSource === "transcript" || normalizedSet.includes("transcript")) {
    return 1
  }
  return 0.99
}
