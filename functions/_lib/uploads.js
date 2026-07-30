import { PUBLIC_STATUSES, productInputFromRow } from './products.js'

export const MAX_BATCH_ITEMS = 20

export { productInputFromRow }

export function safeImageKey(value) {
  const key = String(value || '')
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,239}$/.test(key) ? key : ''
}

export function isPublicStatus(status) {
  return PUBLIC_STATUSES.includes(status)
}

export async function ensureReadyImage(env, imageKey) {
  if (!imageKey) throw new Error('A ready image is required before publishing a product.')
  const image = await env.DB.prepare(
    "SELECT key FROM image_objects WHERE key = ?1 AND deleted_at IS NULL AND upload_status = 'ready'",
  ).bind(imageKey).first()
  if (!image) throw new Error('The product image is not ready for publishing.')
}

export async function ensurePublishableProduct(env, product) {
  await ensureReadyImage(env, product.imageKey)
}

export function mapBatch(row, items = [], counts = {}) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at || null,
    counts: {
      pending: Number(counts.pending || 0),
      ready: Number(counts.ready || 0),
      failed: Number(counts.failed || 0),
    },
    items,
  }
}
