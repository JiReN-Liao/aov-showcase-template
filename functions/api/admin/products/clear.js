import { requireAdmin } from '../../../_lib/auth.js'
import { writeAudit } from '../../../_lib/audit.js'
import { errorResponse, json } from '../../../_lib/http.js'

export async function onRequestPost({ request, env, waitUntil }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth

  const active = await env.DB.prepare('SELECT image_key FROM products WHERE deleted_at IS NULL').all()
  const imageKeys = [...new Set((active.results || []).map((row) => row.image_key).filter(Boolean))]
  if (!imageKeys.length) return json({ ok: true, deleted: 0, imagesQueued: 0 })

  const now = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE image_objects SET deleted_at = ?1 WHERE key IN (SELECT image_key FROM products WHERE deleted_at IS NULL) AND deleted_at IS NULL').bind(now),
      env.DB.prepare('UPDATE sync_items SET deleted_at = ?1, updated_at = ?1 WHERE product_id IN (SELECT id FROM products WHERE deleted_at IS NULL) AND deleted_at IS NULL').bind(now),
      env.DB.prepare("UPDATE products SET deleted_at = ?1, status = 'hidden', updated_at = ?1, version = version + 1 WHERE deleted_at IS NULL").bind(now),
    ])
  } catch {
    return errorResponse('Could not clear cloud products.', 500, 'CLEAR_FAILED')
  }

  await writeAudit(env, {
    actorId: auth.id,
    action: 'product.clear_all',
    entityType: 'product',
    entityId: 'all',
    metadata: { count: active.results?.length || 0, images: imageKeys.length },
  })

  const cleanup = Promise.allSettled(imageKeys.map((key) => env.AOV_STORE.delete(`image:${key}`)))
  if (typeof waitUntil === 'function') waitUntil(cleanup)
  else await cleanup

  return json({ ok: true, deleted: active.results?.length || 0, imagesQueued: imageKeys.length })
}
