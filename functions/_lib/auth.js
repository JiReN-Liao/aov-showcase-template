import { errorResponse } from './http.js'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
// Keep password hashing within the Workers Free CPU budget. Admin passwords
// still require at least 12 characters and use a unique 128-bit salt.
const PBKDF2_ITERATIONS = 50000

function base64Url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function digest(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
}

export async function hashToken(token) {
  return base64Url(await digest(token))
}

export async function createPasswordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${base64Url(salt)}$${base64Url(bits)}`
}

export async function verifyPassword(password, encoded) {
  const [scheme, hashName, iterationText, saltText, digestText] = String(encoded || '').split('$')
  const iterations = Number(iterationText)
  if (scheme !== 'pbkdf2' || hashName !== 'sha256' || !iterations || !saltText || !digestText) return false

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64Url(saltText), iterations, hash: 'SHA-256' },
    key,
    256,
  )
  const actual = new Uint8Array(bits)
  const expected = fromBase64Url(digestText)
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index]
  return difference === 0
}

export async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = base64Url(tokenBytes)
  const tokenHash = await hashToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString()
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)',
  ).bind(tokenHash, userId, expiresAt, now.toISOString()).run()
  return { token, expiresAt }
}

export async function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return errorResponse('Admin authentication required.', 401, 'AUTH_REQUIRED')

  const tokenHash = await hashToken(token)
  const session = await env.DB.prepare(
    'SELECT admin_users.id, admin_users.username, sessions.expires_at FROM sessions JOIN admin_users ON admin_users.id = sessions.user_id WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2',
  ).bind(tokenHash, new Date().toISOString()).first()
  if (!session) return errorResponse('Invalid or expired admin session.', 401, 'AUTH_INVALID')
  return { id: session.id, username: session.username, expiresAt: session.expires_at }
}

export function validateCredentials(username, password) {
  if (!/^[\w.@-]{3,80}$/u.test(username)) throw new Error('Username must be 3-80 letters, numbers, dots, @, hyphens, or underscores.')
  if (password.length < 12 || password.length > 256) throw new Error('Password must be 12-256 characters.')
}
