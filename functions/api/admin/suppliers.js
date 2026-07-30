import { requireAdmin } from '../../_lib/auth.js'
import { json } from '../../_lib/http.js'
import { getSuppliers } from '../../_lib/suppliers.js'

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  return json({ suppliers: getSuppliers(env) })
}
