const baseUrl = process.env.AOV_API_URL?.replace(/\/$/, '')
if (!baseUrl) {
  console.error('AOV_API_URL must be provided through the environment.')
  process.exit(1)
}

const response = await fetch(`${baseUrl}/api/catalog`, { cache: 'no-store' })
if (!response.ok) throw new Error(`Public catalog returned HTTP ${response.status}`)
const body = await response.json()
const allowed = new Set(['available', 'reserved', 'sold'])
if (!Array.isArray(body.products) || body.products.some((product) => !allowed.has(product.status) || 'note' in product)) {
  throw new Error('Public catalog contract failed: it must expose only public statuses and never product notes.')
}
console.log(`Public catalog smoke check passed (${body.products.length} products).`)
