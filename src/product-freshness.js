export const TODAY_STOCK_WINDOW_MS = 24 * 60 * 60 * 1000

export function publishedTimestamp(product) {
  const timestamp = Date.parse(product?.publishedAt || product?.createdAt || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function isTodayStock(product, now = Date.now()) {
  if (product?.status !== 'available') return false
  const timestamp = Date.parse(product?.publishedAt || '')
  if (!Number.isFinite(timestamp) || timestamp > now) return false
  return now - timestamp < TODAY_STOCK_WINDOW_MS
}
