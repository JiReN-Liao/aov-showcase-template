import { requireAdmin } from '../../../_lib/auth.js'
import { writeAudit } from '../../../_lib/audit.js'
import { errorResponse, json } from '../../../_lib/http.js'
import { mapProduct } from '../../../_lib/products.js'

const HASH_CONCURRENCY = 8

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth

  const rows = (await env.DB.prepare(
    "SELECT products.* FROM products JOIN image_objects ON image_objects.key = products.image_key WHERE products.deleted_at IS NULL AND products.status != 'available' AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready' ORDER BY products.sort_order ASC, products.code ASC",
  ).all()).results || []
  if (!rows.length) return json({ ok: true, scanned: 0, recognized: 0, unchanged: 0, unknown: 0, products: [] })

  const fingerprints = (await env.DB.prepare('SELECT sha256, price FROM price_fingerprints').all()).results || []
  const priceByHash = new Map(fingerprints.map((item) => [item.sha256, Number(item.price)]))
  const matches = []
  let unknown = 0
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++]
      const image = await env.AOV_STORE.get(`image:${row.image_key}`, 'arrayBuffer')
      if (!image) {
        unknown += 1
        continue
      }
      const price = priceByHash.get(await sha256Hex(image))
      if (!Number.isInteger(price) || price <= 0) {
        unknown += 1
        continue
      }
      matches.push({ row, price })
    }
  }
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, rows.length) }, worker))

  const changed = matches.filter(({ row, price }) => Number(row.price) !== price)
  const now = new Date().toISOString()
  if (changed.length) {
    const results = await env.DB.batch(changed.map(({ row, price }) => env.DB.prepare(
      'UPDATE products SET price = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3 AND version = ?4 AND deleted_at IS NULL',
    ).bind(price, now, row.id, row.version)))
    if (results.some((result) => Number(result.meta?.changes || 0) !== 1)) {
      return errorResponse('Some products changed while recognizing prices. Please retry.', 409, 'VERSION_CONFLICT')
    }
  }

  const changedIds = changed.map(({ row }) => row.id)
  let products = []
  if (changedIds.length) {
    const placeholders = changedIds.map((_, index) => `?${index + 1}`).join(',')
    products = ((await env.DB.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).bind(...changedIds).all()).results || []).map((row) => mapProduct(row))
  }
  await writeAudit(env, {
    actorId: auth.id,
    action: 'product.unpublished_prices_recognized',
    entityType: 'catalog',
    entityId: 'unpublished',
    metadata: { scanned: rows.length, recognized: matches.length, changed: changed.length, unknown },
  })
  return json({ ok: true, scanned: rows.length, recognized: matches.length, changed: changed.length, unchanged: matches.length - changed.length, unknown, products })
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
