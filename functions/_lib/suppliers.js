const DEFAULT_SUPPLIERS = [
  { id: 'supplier-1', name: '供應商一', source: 'local' },
  { id: 'supplier-2', name: '供應商二', source: 'local' },
]

export function getSuppliers(env = {}) {
  if (!env.SUPPLIERS_JSON) return DEFAULT_SUPPLIERS
  try {
    return normalizeSuppliers(JSON.parse(env.SUPPLIERS_JSON))
  } catch {
    return DEFAULT_SUPPLIERS
  }
}

export function validSupplierId(value, env = {}) {
  const id = String(value || '')
  return getSuppliers(env).some((supplier) => supplier.id === id) ? id : ''
}

function normalizeSuppliers(input) {
  if (!Array.isArray(input)) throw new Error('SUPPLIERS_JSON must be an array.')
  const ids = new Set()
  const suppliers = input.slice(0, 50).map((item) => {
    const id = String(item?.id || '').trim()
    const name = String(item?.name || '').trim()
    const source = String(item?.source || 'local').trim()
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id) || !name || ids.has(id)) throw new Error('Invalid supplier configuration.')
    ids.add(id)
    return { id, name: name.slice(0, 80), source: source.slice(0, 24) }
  })
  if (!suppliers.length) throw new Error('At least one supplier is required.')
  return suppliers
}
