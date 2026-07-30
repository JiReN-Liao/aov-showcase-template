import { requireAdmin } from '../../../_lib/auth.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { getAdminProducts, mapProduct, normalizeProductInput } from '../../../_lib/products.js'
import { ensurePublishableProduct, isPublicStatus } from '../../../_lib/uploads.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  return json({ products: await getAdminProducts(env) })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const inputs = Array.isArray(body) ? body : Array.isArray(body.products) ? body.products : [body.product || body]
  if (!inputs.length || inputs.length > 100) return errorResponse('Create between 1 and 100 products per request.', 400, 'INVALID_BATCH')

  let products
  try {
    products = inputs.map((input) => normalizeProductInput(input))
    for (const product of products) {
      if (isPublicStatus(product.status)) await ensurePublishableProduct(env, product)
    }
  } catch (error) {
    return errorResponse(error.message, 400, 'INVALID_PRODUCT')
  }

  const now = new Date().toISOString()
  const statements = []
  for (const product of products) {
    statements.push(env.DB.prepare(
      'INSERT INTO products (id, code, title, description, price, status, note, image_key, sort_order, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 1)',
    ).bind(product.id, product.code, product.title, product.description, product.price, product.status, product.note, product.imageKey, product.sortOrder, now))
    statements.push(env.DB.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, version_before, version_after, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1, ?6, ?7)',
    ).bind(crypto.randomUUID(), auth.id, 'product.create', 'product', product.id, JSON.stringify({ code: product.code }), now))
  }

  try {
    await env.DB.batch(statements)
  } catch {
    return errorResponse('One or more products conflict with an existing id or code.', 409, 'PRODUCT_CREATE_CONFLICT')
  }

  return json({ products: products.map((product) => mapProduct({
    ...product,
    image_key: product.imageKey,
    sort_order: product.sortOrder,
    created_at: now,
    updated_at: now,
    version: 1,
    deleted_at: null,
  })) }, { status: 201 })
}
