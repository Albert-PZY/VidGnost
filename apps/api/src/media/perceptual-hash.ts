/**
 * 感知哈希工具。
 * 不引入图像解码依赖：直接对 JPEG 字节流按固定步长采样亮度，
 * 计算 8x8 差分哈希（dHash），用于关键帧去重。
 */

export const DHASH_SIZE = 8

export function dHash(buffer: Buffer): bigint {
  const size = DHASH_SIZE
  const samples: number[] = []
  const step = Math.max(1, Math.floor(buffer.length / (size * (size + 1))))
  for (let index = 0; index < size * (size + 1) && index * step < buffer.length; index += 1) {
    samples.push(buffer[index * step])
  }
  let hash = 0n
  let bit = 0n
  for (let index = 0; index < samples.length - 1; index += 1) {
    if (samples[index] > samples[index + 1]) {
      hash |= 1n << bit
    }
    bit += 1n
  }
  return hash
}

export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b
  let count = 0
  while (value > 0n) {
    count += Number(value & 1n)
    value >>= 1n
  }
  return count
}

/**
 * 按感知哈希去重：保留与所有已保留项差异足够大的候选帧。
 * 第一项始终保留，保证时间轴起点有画面证据。
 */
export function dedupeByHash<T extends { hash: bigint }>(items: T[], maxItems: number, minDistance = 12): T[] {
  if (items.length === 0) {
    return []
  }
  const kept: T[] = [items[0]]
  for (const item of items.slice(1)) {
    if (kept.length >= maxItems) {
      break
    }
    const nearest = Math.min(...kept.map((candidate) => hammingDistance(candidate.hash, item.hash)))
    if (nearest >= minDistance) {
      kept.push(item)
    }
  }
  return kept
}
