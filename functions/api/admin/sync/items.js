import { requireAdmin } from '../../../_lib/auth.js'
import { writeAudit } from '../../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { validSupplierId } from '../../../_lib/suppliers.js'

const ORIGINS = new Set(['line', 'facebook', 'mobile', 'local'])

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const result = await env.DB.prepare(
    `SELECT sync_items.product_id, sync_items.supplier_id, sync_items.origin, sync_items.content_hash,
            sync_items.file_name, sync_items.local_synced_at, sync_items.created_at, sync_items.updated_at,
            sync_items.deleted_at, sync_items.local_deleted_at,
            products.code, products.status, products.price, products.image_key, products.version,
            image_objects.content_type, image_objects.size
     FROM sync_items
     JOIN products ON products.id = sync_items.product_id
     LEFT JOIN image_objects ON image_objects.key = products.image_key
     WHERE (sync_items.deleted_at IS NULL AND products.deleted_at IS NULL
       AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready')
       OR (sync_items.deleted_at IS NOT NULL AND sync_items.local_deleted_at IS NULL)
     ORDER BY sync_items.deleted_at IS NOT NULL, sync_items.supplier_id, products.code`,
  ).all()
  return json({ items: (result.results || []).map(mapSyncItem) })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const productId = String(body.productId || '')
  const supplierId = validSupplierId(body.supplierId, env)
  const origin = String(body.origin || '')
  const contentHash = String(body.contentHash || '').toLowerCase()
  const fileName = String(body.fileName || '').replace(/[\\/]/gu, '_').slice(0, 240)
  if (!productId || !supplierId || !ORIGINS.has(origin) || !/^[a-f0-9]{64}$/u.test(contentHash)) {
    return errorResponse('Valid product, supplier, origin, and SHA-256 hash are required.', 400, 'INVALID_SYNC_ITEM')
  }
  const product = await env.DB.prepare(
    `SELECT products.id FROM products
     JOIN image_objects ON image_objects.key = products.image_key
     WHERE products.id = ?1 AND products.deleted_at IS NULL
       AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready'`,
  ).bind(productId).first()
  if (!product) return errorResponse('A product with a ready image is required.', 409, 'PRODUCT_NOT_READY')
  const hashOwner = await env.DB.prepare('SELECT product_id FROM sync_items WHERE content_hash = ?1 AND deleted_at IS NULL').bind(contentHash).first()
  if (hashOwner && hashOwner.product_id !== productId) return errorResponse('This image is already managed by another product.', 409, 'SYNC_HASH_CONFLICT')

  await env.DB.prepare(
    'DELETE FROM sync_items WHERE content_hash = ?1 AND deleted_at IS NOT NULL AND product_id <> ?2',
  ).bind(contentHash, productId).run()

  const now = new Date().toISOString()
  const localSyncedAt = origin === 'mobile' ? null : now
  await env.DB.prepare(
    `INSERT INTO sync_items (product_id, supplier_id, origin, content_hash, file_name, local_synced_at, created_at, updated_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL)
     ON CONFLICT(product_id) DO UPDATE SET supplier_id = excluded.supplier_id, origin = excluded.origin,
       content_hash = excluded.content_hash, file_name = excluded.file_name,
       local_synced_at = COALESCE(sync_items.local_synced_at, excluded.local_synced_at),
       updated_at = excluded.updated_at, deleted_at = NULL`,
  ).bind(productId, supplierId, origin, contentHash, fileName, localSyncedAt, now).run()
  await env.DB.prepare('UPDATE image_objects SET content_hash = ?1 WHERE key = (SELECT image_key FROM products WHERE id = ?2)').bind(contentHash, productId).run()
  await writeAudit(env, { actorId: auth.id, action: 'sync_item.link', entityType: 'product', entityId: productId, metadata: { supplierId, origin, contentHash } })
  const row = await env.DB.prepare(
    `SELECT sync_items.*, products.code, products.status, products.price, products.image_key, products.version,
            image_objects.content_type, image_objects.size
     FROM sync_items JOIN products ON products.id = sync_items.product_id
     JOIN image_objects ON image_objects.key = products.image_key WHERE sync_items.product_id = ?1`,
  ).bind(productId).first()
  return json({ item: mapSyncItem(row) }, { status: 201 })
}

function mapSyncItem(row) {
  return {
    productId: row.product_id,
    code: row.code,
    supplierId: row.supplier_id,
    origin: row.origin,
    contentHash: row.content_hash,
    fileName: row.file_name || '',
    localSyncedAt: row.local_synced_at || null,
    deletedAt: row.deleted_at || null,
    localDeletedAt: row.local_deleted_at || null,
    imageKey: row.image_key,
    imageUrl: `/api/images/${encodeURIComponent(row.image_key)}`,
    contentType: row.content_type,
    size: Number(row.size || 0),
    status: row.status,
    price: row.price == null ? '' : Number(row.price),
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
