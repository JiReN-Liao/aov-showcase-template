import { requireAdmin } from '../../../../_lib/auth.js'
import { writeAudit } from '../../../../_lib/audit.js'
import { errorResponse, json } from '../../../../_lib/http.js'
import { mapProduct } from '../../../../_lib/products.js'
import { safeImageKey } from '../../../../_lib/uploads.js'

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth

  const key = safeImageKey(params.key)
  if (!key) return errorResponse('Invalid image key.', 400, 'INVALID_IMAGE_KEY')
  const product = await env.DB.prepare(
    "SELECT products.* FROM products JOIN image_objects ON image_objects.key = products.image_key WHERE products.image_key = ?1 AND products.deleted_at IS NULL AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready'",
  ).bind(key).first()
  if (!product) return errorResponse('Ready product image not found.', 404, 'IMAGE_NOT_READY')
  const image = await env.AOV_STORE.get(`image:${key}`, 'arrayBuffer')
  if (!image) return errorResponse('Image not found.', 404, 'IMAGE_NOT_FOUND')
  const hash = await sha256Hex(image)
  const fingerprint = await env.DB.prepare('SELECT price FROM price_fingerprints WHERE sha256 = ?1').bind(hash).first()
  const price = fingerprint?.price == null ? null : Number(fingerprint.price)
  if (!Number.isInteger(price) || price <= 0) return json({ ok: true, recognized: false, price: null, reason: 'UNKNOWN_IMAGE' })

  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    'UPDATE products SET price = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3 AND version = ?4 AND deleted_at IS NULL',
  ).bind(price, now, product.id, product.version).run()
  if (Number(result.meta?.changes || 0) !== 1) return errorResponse('Product changed while recognizing its price.', 409, 'VERSION_CONFLICT')
  await writeAudit(env, { actorId: auth.id, action: 'product.price_recognized', entityType: 'product', entityId: product.id, versionBefore: product.version, versionAfter: product.version + 1, metadata: { price, source: 'sha256_fingerprint' } })
  const updated = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(product.id).first()
  return json({ ok: true, recognized: true, price, product: mapProduct(updated) })
}

export function parseRecognizedPrice(value) {
  const text = String(value || '').trim().toUpperCase()
  if (!text || text.includes('NONE')) return null
  const decimal = text.match(/(?:^|\D)(\d{1,2}[.,]\d{1,2})(?:\D|$)/)
  const price = decimal ? Math.round(Number(decimal[1].replace(',', '.')) * 10_000) : Number(text.match(/\b\d{3,6}\b/)?.[0])
  return Number.isInteger(price) && price >= 300 && price <= 500_000 ? price : null
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
