import { tokenizeText } from "./embedding-runtime-service.js"

export interface RerankCandidate {
  text: string
  vector_score: number
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
        const lexicalScore = computeLexicalScore(queryTokens, normalizedQuery, candidate.text)
        return {
          ...candidate,
          lexical_score: lexicalScore,
          rerank_score: roundScore((candidate.vector_score * 0.7) + (lexicalScore * 0.3)),
        }
      })
      .sort((left, right) => right.rerank_score - left.rerank_score)
      .slice(0, Math.max(1, topN))
  }
}

function computeLexicalScore(queryTokens: string[], queryText: string, text: string): number {
  if (queryTokens.length === 0) {
    return 0
  }
  const candidateTokens = new Set(tokenizeText(text))
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length
  const containsWholeQuery = queryText && String(text || "").includes(queryText) ? 0.35 : 0
  return roundScore((overlap / queryTokens.length) + containsWholeQuery)
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}
