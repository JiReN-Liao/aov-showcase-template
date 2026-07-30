import { requireAdmin } from '../../../_lib/auth.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { mapBatch } from '../../../_lib/uploads.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const id = String(body.id || crypto.randomUUID())
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return errorResponse('Invalid upload batch id.', 400, 'INVALID_BATCH_ID')

  const existing = await env.DB.prepare('SELECT * FROM upload_batches WHERE id = ?1 AND created_by = ?2').bind(id, auth.id).first()
  if (existing) return json({ batch: mapBatch(existing) })

  const now = new Date().toISOString()
  try {
    await env.DB.prepare(
      "INSERT INTO upload_batches (id, status, created_by, created_at, updated_at) VALUES (?1, 'active', ?2, ?3, ?3)",
    ).bind(id, auth.id, now).run()
  } catch {
    return errorResponse('Upload batch id already exists.', 409, 'BATCH_CONFLICT')
  }
  return json({ batch: mapBatch({ id, status: 'active', created_at: now, updated_at: now }) }, { status: 201 })
}
