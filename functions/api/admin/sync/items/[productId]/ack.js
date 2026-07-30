import { requireAdmin } from '../../../../../_lib/auth.js'
import { writeAudit } from '../../../../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../../../../_lib/http.js'

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const productId = String(params.productId || '')
  const body = await readJson(request)
  const now = new Date().toISOString()
  if (body.deleted === true) {
    const result = await env.DB.prepare(
      'UPDATE sync_items SET local_deleted_at = ?1, updated_at = ?1 WHERE product_id = ?2 AND deleted_at IS NOT NULL AND local_deleted_at IS NULL',
    ).bind(now, productId).run()
    if (Number(result.meta?.changes || 0) !== 1) return errorResponse('Pending local deletion not found.', 404, 'LOCAL_DELETE_NOT_FOUND')
    await writeAudit(env, { actorId: auth.id, action: 'sync_item.local_delete_ack', entityType: 'product', entityId: productId })
    return json({ ok: true, productId, localDeletedAt: now })
  }
  const result = await env.DB.prepare(
    'UPDATE sync_items SET local_synced_at = ?1, updated_at = ?1 WHERE product_id = ?2 AND deleted_at IS NULL',
  ).bind(now, productId).run()
  if (Number(result.meta?.changes || 0) !== 1) return errorResponse('Sync item not found.', 404, 'SYNC_ITEM_NOT_FOUND')
  await writeAudit(env, { actorId: auth.id, action: 'sync_item.local_ack', entityType: 'product', entityId: productId })
  return json({ ok: true, productId, localSyncedAt: now })
}
