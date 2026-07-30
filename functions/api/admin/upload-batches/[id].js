import { requireAdmin } from '../../../_lib/auth.js'
import { errorResponse, json } from '../../../_lib/http.js'
import { mapBatch } from '../../../_lib/uploads.js'

async function getBatch(env, id, userId) {
  return env.DB.prepare('SELECT * FROM upload_batches WHERE id = ?1 AND created_by = ?2').bind(id, userId).first()
}

export async function onRequestGet({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const batch = await getBatch(env, String(params.id || ''), auth.id)
  if (!batch) return errorResponse('Upload batch not found.', 404, 'BATCH_NOT_FOUND')
  const [itemsResult, countResult] = await Promise.all([
    env.DB.prepare(
      'SELECT image_objects.batch_item_id, image_objects.key AS image_key, image_objects.upload_status, image_objects.upload_error, products.id AS product_id, products.code, products.sort_order FROM image_objects LEFT JOIN products ON products.image_key = image_objects.key AND products.deleted_at IS NULL WHERE image_objects.batch_id = ?1 ORDER BY image_objects.created_at ASC',
    ).bind(batch.id).all(),
    env.DB.prepare(
      "SELECT SUM(CASE WHEN upload_status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN upload_status = 'ready' THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN upload_status = 'failed' THEN 1 ELSE 0 END) AS failed FROM image_objects WHERE batch_id = ?1 AND deleted_at IS NULL",
    ).bind(batch.id).first(),
  ])
  const items = (itemsResult.results || []).map((item) => ({
    clientItemId: item.batch_item_id,
    imageKey: item.image_key,
    imageStatus: item.upload_status,
    error: item.upload_error || '',
    product: item.product_id ? { id: item.product_id, code: item.code, sortOrder: item.sort_order } : null,
  }))
  return json({ batch: mapBatch(batch, items, countResult) })
}

export async function onRequestDelete({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const id = String(params.id || '')
  const batch = await getBatch(env, id, auth.id)
  if (!batch) return errorResponse('Upload batch not found.', 404, 'BATCH_NOT_FOUND')
  if (batch.status === 'cancelled') return json({ batch: mapBatch(batch) })
  const now = new Date().toISOString()
  await env.DB.prepare("UPDATE upload_batches SET status = 'cancelled', cancelled_at = ?1, updated_at = ?1 WHERE id = ?2").bind(now, id).run()
  return json({ batch: mapBatch({ ...batch, status: 'cancelled', cancelled_at: now, updated_at: now }) })
}
