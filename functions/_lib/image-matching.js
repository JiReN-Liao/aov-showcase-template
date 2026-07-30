const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const VISUAL_HASH_PATTERN = /^[a-f0-9]{16}$/u

export function normalizeRequestedHashes(values, limit = 50) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter((value) => SHA256_PATTERN.test(value)))].slice(0, limit)
}

export function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeVisualHash(value) {
  const hash = String(value || '').trim().toLowerCase()
  return VISUAL_HASH_PATTERN.test(hash) ? hash : ''
}

export function normalizeImageRequests(values, limit = 50) {
  if (!Array.isArray(values)) return []
  const unique = new Map()
  for (const value of values) {
    const hash = String(value?.hash || '').trim().toLowerCase()
    if (!SHA256_PATTERN.test(hash) || unique.has(hash)) continue
    unique.set(hash, { hash, visualHash: normalizeVisualHash(value?.visualHash) })
    if (unique.size >= limit) break
  }
  return [...unique.values()]
}

export function hammingDistance(left, right) {
  const normalizedLeft = normalizeVisualHash(left)
  const normalizedRight = normalizeVisualHash(right)
  if (!normalizedLeft || !normalizedRight) return Number.POSITIVE_INFINITY
  let difference = BigInt(`0x${normalizedLeft}`) ^ BigInt(`0x${normalizedRight}`)
  let count = 0
  while (difference) {
    difference &= difference - 1n
    count += 1
  }
  return count
}

export function findUniqueVisualMatch(visualHash, candidates, options = {}) {
  const maxDistance = options.maxDistance ?? 8
  const minMargin = options.minMargin ?? 3
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: hammingDistance(visualHash, candidate.visualHash) }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((left, right) => left.distance - right.distance)
  const best = ranked[0]
  if (!best || best.distance > maxDistance) return { match: null, ambiguous: false, distance: best?.distance ?? null }
  const runnerUp = ranked[1]
  if (runnerUp && runnerUp.distance - best.distance < minMargin) {
    return { match: null, ambiguous: true, distance: best.distance }
  }
  return { match: best.candidate, ambiguous: false, distance: best.distance }
}
