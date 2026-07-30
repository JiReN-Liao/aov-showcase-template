import { requireAdmin } from '../../../_lib/auth.js'
import { writeAudit } from '../../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { expectedVersion, normalizeProductInput } from '../../../_lib/products.js'
import { ensurePublishableProduct, isPublicStatus, productInputFromRow } from '../../../_lib/uploads.js'

// Batch writes preserve the same optimistic-lock contract as the single-product API.
export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const operations = body.operations
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) {
    return errorResponse('Provide 1 to 100 patch operations.', 400, 'INVALID_BATCH')
  }

  const statements = []
  const now = new Date().toISOString()
  try {
    for (const operation of operations) {
      const id = String(operation?.id || '')
      const version = expectedVersion(request, operation)
      if (!id || !version || !operation.patch || typeof operation.patch !== 'object') {
        throw new Error('Every operation needs id, expectedVersion, and patch.')
      }
      const current = await env.DB.prepare('SELECT * FROM products WHERE id = ?1 AND deleted_at IS NULL').bind(id).first()
      if (!current) throw new Error(`Product ${id} was not found.`)
      if (current.version !== version) throw new Error(`Product ${id} has changed. Reload before updating.`)
      const product = normalizeProductInput({ ...productInputFromRow(current), ...operation.patch, id })
      if (isPublicStatus(product.status)) await ensurePublishableProduct(env, product)
      statements.push(env.DB.prepare(
        'UPDATE products SET code = ?1, title = ?2, description = ?3, price = ?4, status = ?5, note = ?6, image_key = ?7, sort_order = ?8, updated_at = ?9, version = version + 1 WHERE id = ?10 AND version = ?11 AND deleted_at IS NULL',
      ).bind(product.code, product.title, product.description, product.price, product.status, product.note, product.imageKey, product.sortOrder, now, id, version))
      statements.push(env.DB.prepare(
        'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, version_before, version_after, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
      ).bind(crypto.randomUUID(), auth.id, 'product.batch_update', 'product', id, version, version + 1, JSON.stringify({ fields: Object.keys(operation.patch) }), now))
    }
  } catch (caught) {
    return errorResponse(caught.message, 409, 'BATCH_CONFLICT')
  }

  const results = await env.DB.batch(statements)
  if (results.some((result) => Number(result.meta?.changes || 0) === 0)) {
    return errorResponse('One or more products changed while the batch was saved.', 409, 'BATCH_CONFLICT')
  }
  await writeAudit(env, { actorId: auth.id, action: 'products.batch_update', entityType: 'product_batch', metadata: { count: operations.length } })
  return json({ ok: true, operations: operations.length })
}

export async function onRequestDelete({ request, env, waitUntil }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || '')).filter(Boolean))]
  if (!ids.length || ids.length > 100) return errorResponse('Provide 1 to 100 product ids.', 400, 'INVALID_BATCH')

  const placeholders = ids.map((_, index) => `?${index + 1}`).join(',')
  const active = (await env.DB.prepare(`SELECT id, image_key FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL`).bind(...ids).all()).results || []
  if (!active.length) return json({ ok: true, deleted: 0, imagesQueued: 0 })
  const activeIds = active.map((row) => row.id)
  const imageKeys = [...new Set(active.map((row) => row.image_key).filter(Boolean))]
  const activePlaceholders = activeIds.map((_, index) => `?${index + 2}`).join(',')
  const now = new Date().toISOString()

  await env.DB.batch([
    env.DB.prepare(`UPDATE image_objects SET deleted_at = ?1 WHERE key IN (SELECT image_key FROM products WHERE id IN (${activePlaceholders})) AND deleted_at IS NULL`).bind(now, ...activeIds),
    env.DB.prepare(`UPDATE sync_items SET deleted_at = ?1, updated_at = ?1 WHERE product_id IN (${activePlaceholders}) AND deleted_at IS NULL`).bind(now, ...activeIds),
    env.DB.prepare(`UPDATE products SET deleted_at = ?1, status = 'hidden', updated_at = ?1, version = version + 1 WHERE id IN (${activePlaceholders}) AND deleted_at IS NULL`).bind(now, ...activeIds),
  ])
  await writeAudit(env, { actorId: auth.id, action: 'products.batch_delete', entityType: 'product_batch', entityId: 'selected', metadata: { count: active.length, images: imageKeys.length } })

  const cleanup = Promise.allSettled(imageKeys.map((key) => env.AOV_STORE.delete(`image:${key}`)))
  if (typeof waitUntil === 'function') waitUntil(cleanup)
  else await cleanup
  return json({ ok: true, deleted: active.length, imagesQueued: imageKeys.length })
}
