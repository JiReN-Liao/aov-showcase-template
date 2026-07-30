import { requireAdmin } from '../../../../_lib/auth.js'
import { writeAudit } from '../../../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../../../_lib/http.js'
import { ALL_STATUSES, expectedVersion, mapProduct } from '../../../../_lib/products.js'
import { ensurePublishableProduct, isPublicStatus, productInputFromRow } from '../../../../_lib/uploads.js'

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const version = expectedVersion(request, body)
  const status = String(body.status || '')
  if (!version) return errorResponse('expectedVersion or If-Match is required.', 428, 'VERSION_REQUIRED')
  if (!ALL_STATUSES.includes(status)) return errorResponse('Invalid product status.', 400, 'INVALID_STATUS')

  const id = String(params.id || '')
  const currentProduct = await env.DB.prepare('SELECT * FROM products WHERE id = ?1 AND deleted_at IS NULL').bind(id).first()
  if (!currentProduct) return errorResponse('Product not found.', 404, 'PRODUCT_NOT_FOUND')
  if (currentProduct.version !== version) return errorResponse('Product has changed. Reload before updating status.', 409, 'VERSION_CONFLICT')
  try {
    if (isPublicStatus(status)) await ensurePublishableProduct(env, productInputFromRow(currentProduct))
  } catch (error) {
    return errorResponse(error.message, 409, 'IMAGE_NOT_READY')
  }
  const result = await env.DB.prepare(
    'UPDATE products SET status = ?1, updated_at = ?2, version = version + 1 WHERE id = ?3 AND version = ?4 AND deleted_at IS NULL',
  ).bind(status, new Date().toISOString(), id, version).run()
  if (Number(result.meta?.changes || 0) !== 1) {
    const current = await env.DB.prepare('SELECT version FROM products WHERE id = ?1').bind(id).first()
    return current ? errorResponse('Product has changed. Reload before updating status.', 409, 'VERSION_CONFLICT') : errorResponse('Product not found.', 404, 'PRODUCT_NOT_FOUND')
  }

  await writeAudit(env, {
    actorId: auth.id,
    action: 'product.status',
    entityType: 'product',
    entityId: id,
    versionBefore: version,
    versionAfter: version + 1,
    metadata: { status },
  })
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first()
  return json({ product: mapProduct(product) })
}
