import { tokenize } from "../core/text.js"

export interface Bm25Document {
  id: string
  text: string
  /** 附加字段（问题变体等），权重按 `fieldWeight` 计入。 */
  extras?: string[]
}

export interface Bm25IndexDoc {
  version: 1
  averageLength: number
  documentIds: string[]
  documentLengths: Record<string, number>
  /** term -> { docId -> weighted term frequency and field boost } */
  postings: Record<string, Record<string, number>>
  documentFrequency: Record<string, number>
}

const K1 = 1.35
const B = 0.72
const EXTRA_FIELD_WEIGHT = 0.8

export function buildBm25Index(documents: Bm25Document[]): Bm25IndexDoc {
  const postings: Record<string, Record<string, number>> = {}
  const documentLengths: Record<string, number> = {}
  const documentFrequency: Record<string, number> = {}
  let totalLength = 0

  for (const document of documents) {
    const mainTokens = tokenize(document.text)
    const counts = new Map<string, number>()
    for (const token of mainTokens) {
      counts.set(token, (counts.get(token) || 0) + 1)
    }
    for (const extra of document.extras || []) {
      for (const token of tokenize(extra)) {
        counts.set(token, (counts.get(token) || 0) + EXTRA_FIELD_WEIGHT)
      }
    }

    const length = mainTokens.length + (document.extras || []).reduce((sum, extra) => sum + tokenize(extra).length, 0)
    documentLengths[document.id] = length || 1
    totalLength += documentLengths[document.id]

    for (const [term, frequency] of counts) {
      postings[term] = postings[term] || {}
      postings[term][document.id] = frequency
      documentFrequency[term] = (documentFrequency[term] || 0) + 1
    }
  }

  return {
    version: 1,
    averageLength: documents.length > 0 ? totalLength / documents.length : 1,
    documentIds: documents.map((document) => document.id),
    documentLengths,
    postings,
    documentFrequency,
  }
}

export function searchBm25(index: Bm25IndexDoc, query: string, limit = 40): Array<{ id: string; score: number }> {
  const tokens = [...new Set(tokenize(query))]
  if (tokens.length === 0 || index.documentIds.length === 0) {
    return []
  }
  const totalDocs = index.documentIds.length
  const scores = new Map<string, number>()

  for (const token of tokens) {
    const posting = index.postings[token]
    if (!posting) {
      continue
    }
    const df = index.documentFrequency[token] || 1
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
    for (const [docId, frequency] of Object.entries(posting)) {
      const length = index.documentLengths[docId] || 1
      const denominator = frequency + K1 * (1 - B + B * (length / index.averageLength))
      const score = idf * ((frequency * (K1 + 1)) / (denominator || 1))
      scores.set(docId, (scores.get(docId) || 0) + score)
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
