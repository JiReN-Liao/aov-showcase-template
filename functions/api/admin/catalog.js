import { requireAdmin } from '../../_lib/auth.js'
import { getAdminProducts, getSettings } from '../../_lib/products.js'
import { errorResponse, json } from '../../_lib/http.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth

  const [products, settings, users] = await Promise.all([
    getAdminProducts(env),
    getSettings(env),
    env.DB.prepare('SELECT id, username, created_at, updated_at FROM admin_users ORDER BY username ASC').all(),
  ])
  return json({
    products,
    settings: { ...settings, hasAdminAccount: true },
    adminUsers: (users.results || []).map((user) => ({
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    })),
  })
}

export async function onRequestPut() {
  return errorResponse('Use the product and settings APIs for versioned writes.', 405, 'VERSIONED_WRITE_REQUIRED')
}
