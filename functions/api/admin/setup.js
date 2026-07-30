import { createPasswordHash, createSession, validateCredentials } from '../../_lib/auth.js'
import { errorResponse, json, readJson } from '../../_lib/http.js'
import { writeAudit } from '../../_lib/audit.js'

export async function onRequestPost({ request, env }) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first()
  if (Number(existing?.count || 0) > 0) return errorResponse('Admin setup is already complete.', 409, 'ADMIN_EXISTS')

  const body = await readJson(request)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  try {
    validateCredentials(username, password)
  } catch (error) {
    return errorResponse(error.message, 400, 'INVALID_CREDENTIALS')
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const passwordHash = await createPasswordHash(password)
  try {
    await env.DB.prepare(
      'INSERT INTO admin_users (id, username, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    ).bind(id, username, passwordHash, now, now).run()
  } catch {
    return errorResponse('Unable to create admin account.', 409, 'ADMIN_CREATE_CONFLICT')
  }

  await writeAudit(env, { actorId: id, action: 'admin.setup', entityType: 'admin_user', entityId: id })
  const session = await createSession(env, id)
  return json({ token: session.token, expiresAt: session.expiresAt, username })
}
