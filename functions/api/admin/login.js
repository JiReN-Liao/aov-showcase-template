import { createSession, verifyPassword } from '../../_lib/auth.js'
import { errorResponse, json, readJson } from '../../_lib/http.js'

export async function onRequestPost({ request, env }) {
  const body = await readJson(request)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const user = await env.DB.prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?1').bind(username).first()
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return errorResponse('Invalid username or password.', 401, 'LOGIN_FAILED')
  }

  const session = await createSession(env, user.id)
  return json({ token: session.token, expiresAt: session.expiresAt, username: user.username })
}
