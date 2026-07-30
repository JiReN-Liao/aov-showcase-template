import { requireAdmin } from '../../../_lib/auth.js'
import { normalizeVisualHash } from '../../../_lib/image-matching.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const rows = (await env.DB.prepare(
    `SELECT image_objects.key AS image_key, image_objects.visual_hash
     FROM image_objects JOIN products ON products.image_key = image_objects.key
     WHERE products.deleted_at IS NULL AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready'`,
  ).all()).results || []
  return json({ images: rows.map((row) => ({ imageKey: row.image_key, visualHash: row.visual_hash || '' })) })
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  if (!Array.isArray(body.images)) return errorResponse('Provide visual image hashes.', 400, 'INVALID_VISUAL_HASHES')
  const images = body.images.slice(0, 100).map((item) => ({
    imageKey: String(item?.imageKey || '').slice(0, 240),
    visualHash: normalizeVisualHash(item?.visualHash),
  })).filter((item) => item.imageKey && item.visualHash)
  if (!images.length) return errorResponse('Provide valid visual image hashes.', 400, 'INVALID_VISUAL_HASHES')
  await env.DB.batch(images.map((item) => env.DB.prepare(
    'UPDATE image_objects SET visual_hash = ?1 WHERE key = ?2 AND deleted_at IS NULL',
  ).bind(item.visualHash, item.imageKey)))
  return json({ ok: true, updated: images.length })
}
