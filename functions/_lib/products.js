export const PUBLIC_STATUSES = ['available']
export const ALL_STATUSES = ['draft', 'available', 'reserved', 'sold', 'hidden']

export const PUBLIC_SETTINGS = {
  siteName: 'Zhuの小舖',
  contactMethods: [
    { id: 'line', label: 'LINE', url: '' },
    { id: 'facebook', label: 'Facebook', url: '' },
    { id: 'instagram', label: 'Instagram', url: '' },
  ],
}

export function imageUrl(key) {
  return key ? `/api/images/${encodeURIComponent(key)}` : ''
}

export function mapProduct(row, publicOnly = false) {
  const product = {
    id: row.id,
    code: row.code,
    title: row.title || '',
    description: row.description || '',
    price: row.price == null ? '' : row.price,
    status: row.status,
    imageKey: row.image_key || '',
    imageUrl: imageUrl(row.image_key),
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null,
    version: row.version || 1,
  }

  if (!publicOnly) {
    product.note = row.note || ''
    product.deletedAt = row.deleted_at || ''
  }

  return product
}

export function parseSettings(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return {
      siteName: String(parsed.siteName || PUBLIC_SETTINGS.siteName).slice(0, 160),
      contactMethods: Array.isArray(parsed.contactMethods) ? parsed.contactMethods : [],
    }
  } catch {
    return { ...PUBLIC_SETTINGS }
  }
}

export async function getSettings(env) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?1').bind('public').first()
  return parseSettings(row?.value_json)
}

export async function getAdminProducts(env) {
  const result = await env.DB.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY sort_order ASC, code ASC').all()
  return (result.results || []).map((row) => mapProduct(row))
}

export async function getPublicProducts(env) {
  const result = await env.DB.prepare(
    "SELECT id, code, title, description, price, status, image_key, sort_order, created_at, updated_at, published_at, version FROM products WHERE deleted_at IS NULL AND status = 'available' ORDER BY sort_order ASC, code ASC",
  ).all()
  return (result.results || []).map((row) => mapProduct(row, true))
}

export function nextPublishedAt(currentStatus, nextStatus, currentPublishedAt, now) {
  if (nextStatus === 'available' && currentStatus !== 'available') return now
  return currentPublishedAt || null
}

export function normalizeProductInput(input, fallback = {}) {
  const value = { ...fallback, ...(input || {}) }
  const code = String(value.code || '').trim()
  if (!code || code.length > 120) throw new Error('Product code is required and must be at most 120 characters.')

  const status = String(value.status || 'draft')
  if (!ALL_STATUSES.includes(status)) throw new Error('Invalid product status.')

  const price = value.price === '' || value.price == null ? null : Number(value.price)
  if (price != null && (!Number.isInteger(price) || price < 0 || price > 2147483647)) {
    throw new Error('Price must be a non-negative integer.')
  }

  const sortOrder = value.sortOrder === '' || value.sortOrder == null ? 0 : Number(value.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new Error('Sort order must be a non-negative integer.')

  return {
    id: String(value.id || crypto.randomUUID()),
    code,
    title: String(value.title || '').slice(0, 240),
    description: String(value.description || '').slice(0, 10000),
    price,
    status,
    note: String(value.note || '').slice(0, 10000),
    imageKey: value.imageKey ? String(value.imageKey).slice(0, 240) : null,
    sortOrder,
  }
}

export function productInputFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    price: row.price,
    status: row.status,
    note: row.note,
    imageKey: row.image_key,
    sortOrder: row.sort_order,
  }
}

export function expectedVersion(request, body = {}) {
  const raw = body.expectedVersion ?? request.headers.get('If-Match')?.replace(/^W\//, '').replaceAll('"', '')
  const version = Number(raw)
  return Number.isInteger(version) && version > 0 ? version : null
}
