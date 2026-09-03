import { requireAdmin } from '../../../_lib/auth.js'
import { writeAudit } from '../../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { expectedVersion, mapProduct, normalizeProductInput } from '../../../_lib/products.js'
import { ensurePublishableProduct, isPublicStatus, productInputFromRow } from '../../../_lib/uploads.js'

export async function onRequestPatch({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const id = String(params.id || '')
  const body = await readJson(request)
  const version = expectedVersion(request, body)
  if (!version) return errorResponse('expectedVersion or If-Match is required.', 428, 'VERSION_REQUIRED')

  const current = await env.DB.prepare('SELECT * FROM products WHERE id = ?1 AND deleted_at IS NULL').bind(id).first()
  if (!current) return errorResponse('Product not found.', 404, 'PRODUCT_NOT_FOUND')
  if (current.version !== version) return errorResponse('Product has changed. Reload before updating.', 409, 'VERSION_CONFLICT')

  let normalized
  try {
    normalized = normalizeProductInput({ ...productInputFromRow(current), ...body, id })
  } catch (error) {
    return errorResponse(error.message, 400, 'INVALID_PRODUCT')
  }
  try {
    if (isPublicStatus(normalized.status)) await ensurePublishableProduct(env, normalized)
  } catch (error) {
    return errorResponse(error.message, 409, 'IMAGE_NOT_READY')
  }

  const updatedAt = new Date().toISOString()
  const result = await env.DB.prepare(
    'UPDATE products SET code = ?1, title = ?2, description = ?3, price = ?4, status = ?5, note = ?6, image_key = ?7, sort_order = ?8, updated_at = ?9, version = version + 1 WHERE id = ?10 AND version = ?11 AND deleted_at IS NULL',
  ).bind(normalized.code, normalized.title, normalized.description, normalized.price, normalized.status, normalized.note, normalized.imageKey, normalized.sortOrder, updatedAt, id, version).run()
  if (Number(result.meta?.changes || 0) !== 1) return errorResponse('Product has changed. Reload before updating.', 409, 'VERSION_CONFLICT')

  await writeAudit(env, {
    actorId: auth.id,
    action: 'product.update',
    entityType: 'product',
    entityId: id,
    versionBefore: version,
    versionAfter: version + 1,
    metadata: { fields: Object.keys(body).filter((key) => key !== 'expectedVersion') },
  })
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first()
  return json({ product: mapProduct(product) })
}

export async function onRequestDelete({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const id = String(params.id || '')
  const body = await readJson(request)
  const version = expectedVersion(request, body)
  if (!version) return errorResponse('expectedVersion or If-Match is required.', 428, 'VERSION_REQUIRED')

  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    "UPDATE products SET deleted_at = ?1, status = 'hidden', updated_at = ?1, version = version + 1 WHERE id = ?2 AND version = ?3 AND deleted_at IS NULL",
  ).bind(now, id, version).run()
  if (Number(result.meta?.changes || 0) !== 1) {
    const current = await env.DB.prepare('SELECT version FROM products WHERE id = ?1').bind(id).first()
    return current ? errorResponse('Product has changed. Reload before deleting.', 409, 'VERSION_CONFLICT') : errorResponse('Product not found.', 404, 'PRODUCT_NOT_FOUND')
  }

  await writeAudit(env, {
    actorId: auth.id,
    action: 'product.soft_delete',
    entityType: 'product',
    entityId: id,
    versionBefore: version,
    versionAfter: version + 1,
  })
  return json({ ok: true, id, version: version + 1, deletedAt: now })
}
