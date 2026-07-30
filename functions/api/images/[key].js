import { requireAdmin } from '../../_lib/auth.js'
import { writeAudit } from '../../_lib/audit.js'
import { errorResponse, json } from '../../_lib/http.js'
import { bytesToHex } from '../../_lib/image-matching.js'
import { safeImageKey } from '../../_lib/uploads.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function onRequestGet({ params, env }) {
  const key = safeImageKey(params.key)
  if (!key) return errorResponse('Invalid image key.', 400, 'INVALID_IMAGE_KEY')
  const [body, metadata] = await Promise.all([
    env.AOV_STORE.get(storageKey(key), 'arrayBuffer'),
    env.DB.prepare("SELECT content_type FROM image_objects WHERE key = ?1 AND deleted_at IS NULL AND upload_status = 'ready'").bind(key).first(),
  ])
  if (!body || !metadata) return errorResponse('Image not found.', 404, 'IMAGE_NOT_FOUND')
  return new Response(body, { headers: { 'Content-Type': metadata.content_type, 'Cache-Control': 'public, max-age=31536000, immutable' } })
}

export async function onRequestPut({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const key = safeImageKey(params.key)
  const contentType = request.headers.get('Content-Type') || ''
  const length = Number(request.headers.get('Content-Length') || 0)
  const now = new Date().toISOString()
  if (!key) return errorResponse('Invalid image key.', 400, 'INVALID_IMAGE_KEY')
  const image = await env.DB.prepare('SELECT * FROM image_objects WHERE key = ?1').bind(key).first()
  if (image?.deleted_at) return errorResponse('Image keys are immutable and cannot be reused.', 409, 'IMMUTABLE_IMAGE_KEY')
  if (image?.upload_status === 'ready') {
    return json({ ok: true, imageKey: key, imageUrl: `/api/images/${encodeURIComponent(key)}`, idempotent: true })
  }
  if (image?.batch_id) {
    const batch = await env.DB.prepare('SELECT status FROM upload_batches WHERE id = ?1').bind(image.batch_id).first()
    if (!batch || batch.status !== 'active') return errorResponse('This upload batch is no longer active.', 409, 'BATCH_INACTIVE')
  }
  if (!contentType.startsWith('image/')) return await failUpload(env, image, key, now, 'Only image uploads are allowed.', 415, 'INVALID_IMAGE_TYPE')
  if (length > MAX_IMAGE_BYTES) return await failUpload(env, image, key, now, 'Image is too large. Maximum size is 10 MB.', 413, 'IMAGE_TOO_LARGE')

  let body
  try {
    body = await request.arrayBuffer()
  } catch {
    return await failUpload(env, image, key, now, 'Image body could not be read.', 400, 'IMAGE_REQUIRED')
  }
  if (!body.byteLength) return await failUpload(env, image, key, now, 'Image body is required.', 400, 'IMAGE_REQUIRED')
  if (body.byteLength > MAX_IMAGE_BYTES) return await failUpload(env, image, key, now, 'Image is too large. Maximum size is 10 MB.', 413, 'IMAGE_TOO_LARGE')
  const contentHash = bytesToHex(await crypto.subtle.digest('SHA-256', body))

  if (!image) {
    try {
      // Reserve a direct-upload key before its KV write so retries stay idempotent.
    await env.DB.prepare(
        "INSERT INTO image_objects (key, content_type, size, uploaded_by, created_at, upload_status, updated_at, content_hash) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?5, ?6)",
      ).bind(key, contentType, body.byteLength, auth.id, now, contentHash).run()
    } catch {
      return errorResponse('Image keys are immutable and cannot be reused.', 409, 'IMMUTABLE_IMAGE_KEY')
    }
  } else {
    await env.DB.prepare(
      "UPDATE image_objects SET content_type = ?1, size = ?2, content_hash = ?3, upload_status = 'pending', upload_error = NULL, failed_at = NULL, updated_at = ?4 WHERE key = ?5",
    ).bind(contentType, body.byteLength, contentHash, now, key).run()
  }
  try {
    await env.AOV_STORE.put(storageKey(key), body)
  } catch {
    return await failUpload(env, image || { key }, key, now, 'Cloud image upload failed.', 502, 'IMAGE_UPLOAD_FAILED')
  }
  await env.DB.prepare(
    "UPDATE image_objects SET upload_status = 'ready', upload_error = NULL, uploaded_at = ?1, failed_at = NULL, updated_at = ?1 WHERE key = ?2",
  ).bind(now, key).run()
  await writeAudit(env, { actorId: auth.id, action: 'image.upload', entityType: 'image', entityId: key, metadata: { size: body.byteLength, contentType } })
  return json({ ok: true, imageKey: key, imageUrl: `/api/images/${encodeURIComponent(key)}` }, { status: image ? 200 : 201 })
}

export async function onRequestDelete({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const key = safeImageKey(params.key)
  if (!key) return errorResponse('Invalid image key.', 400, 'INVALID_IMAGE_KEY')
  const referenced = await env.DB.prepare('SELECT id FROM products WHERE image_key = ?1 AND deleted_at IS NULL LIMIT 1').bind(key).first()
  if (referenced) return errorResponse('Delete the product before deleting its image.', 409, 'IMAGE_IN_USE')
  await env.DB.prepare('UPDATE image_objects SET deleted_at = ?1 WHERE key = ?2 AND deleted_at IS NULL').bind(new Date().toISOString(), key).run()
  await env.AOV_STORE.delete(storageKey(key))
  await writeAudit(env, { actorId: auth.id, action: 'image.delete', entityType: 'image', entityId: key })
  return json({ ok: true, imageKey: key })
}

async function failUpload(env, image, key, now, message, status, code) {
  if (image) {
    await env.DB.prepare(
      "UPDATE image_objects SET upload_status = 'failed', upload_error = ?1, failed_at = ?2, updated_at = ?2 WHERE key = ?3 AND upload_status != 'ready' AND deleted_at IS NULL",
    ).bind(message.slice(0, 1000), now, key).run()
  }
  return errorResponse(message, status, code)
}

function storageKey(key) {
  return `image:${key}`
}
