import { createPasswordHash, requireAdmin } from '../../_lib/auth.js'
import { writeAudit } from '../../_lib/audit.js'
import { errorResponse, json, readJson } from '../../_lib/http.js'
import { getSettings, PUBLIC_SETTINGS } from '../../_lib/products.js'

function normalizeContactMethods(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).map((method, index) => ({
    id: String(method.id || `contact-${index + 1}`).slice(0, 80),
    label: String(method.label || '').slice(0, 80),
    url: String(method.url || '').slice(0, 1000),
  })).filter((method) => method.label || method.url)
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const settings = {
    ...PUBLIC_SETTINGS,
    siteName: String(body.siteName || PUBLIC_SETTINGS.siteName).slice(0, 160),
    contactMethods: normalizeContactMethods(body.contactMethods),
  }
  const now = new Date().toISOString()
  const statements = [env.DB.prepare(
    'INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
  ).bind('public', JSON.stringify(settings), now)]

  if (Array.isArray(body.adminUsers)) {
    if (!body.adminUsers.length) return errorResponse('At least one admin user is required.', 400, 'ADMIN_REQUIRED')
    const existing = await env.DB.prepare('SELECT id, username, password_hash FROM admin_users').all()
    const existingById = new Map((existing.results || []).map((user) => [user.id, user]))
    const incomingIds = new Set()
    const usernames = new Set()
    for (const input of body.adminUsers) {
      const id = String(input.id || crypto.randomUUID())
      const username = String(input.username || '').trim()
      if (usernames.has(username)) return errorResponse('Admin usernames must be unique.', 409, 'ADMIN_USERNAME_CONFLICT')
      usernames.add(username)
      incomingIds.add(id)
      if (!/^[\w.@-]{3,80}$/u.test(username)) return errorResponse('Invalid admin username.', 400, 'INVALID_ADMIN_USERNAME')
      const existingUser = existingById.get(id)
      if (existingUser) {
        if (input.password) {
          if (String(input.password).length < 12) return errorResponse('Password must be at least 12 characters.', 400, 'INVALID_CREDENTIALS')
          const hash = await createPasswordHash(String(input.password))
          statements.push(env.DB.prepare('UPDATE admin_users SET username = ?1, password_hash = ?2, updated_at = ?3 WHERE id = ?4').bind(username, hash, now, id))
        } else {
          statements.push(env.DB.prepare('UPDATE admin_users SET username = ?1, updated_at = ?2 WHERE id = ?3').bind(username, now, id))
        }
      } else {
        if (String(input.password || '').length < 12) return errorResponse('New admin users need a password of at least 12 characters.', 400, 'INVALID_CREDENTIALS')
        const hash = await createPasswordHash(String(input.password))
        statements.push(env.DB.prepare('INSERT INTO admin_users (id, username, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(id, username, hash, now))
      }
    }
    for (const user of existing.results || []) {
      if (!incomingIds.has(user.id)) statements.push(env.DB.prepare('DELETE FROM admin_users WHERE id = ?1').bind(user.id))
    }
  }

  try {
    await env.DB.batch(statements)
  } catch {
    return errorResponse('Settings or admin users could not be saved.', 409, 'SETTINGS_CONFLICT')
  }
  await writeAudit(env, { actorId: auth.id, action: 'settings.update', entityType: 'settings', entityId: 'public' })
  return json({ settings: await getSettings(env) })
}
