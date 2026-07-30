import { getPublicProducts, getSettings } from '../_lib/products.js'
import { json } from '../_lib/http.js'

export async function onRequestGet({ env }) {
  const [products, settings, admin] = await Promise.all([
    getPublicProducts(env),
    getSettings(env),
    env.DB.prepare('SELECT 1 FROM admin_users LIMIT 1').first(),
  ])
  return json({ products, settings: { ...settings, hasAdminAccount: Boolean(admin) } })
}
