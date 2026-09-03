const codeCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareAdminProductsNewestFirst(a, b) {
  return Number(b?.sortOrder || 0) - Number(a?.sortOrder || 0)
    || Date.parse(b?.createdAt || '') - Date.parse(a?.createdAt || '')
    || codeCollator.compare(String(b?.code || ''), String(a?.code || ''))
}

export function nextProductSortOrder(products) {
  return products.reduce(
    (highest, product) => Math.max(highest, Number(product?.sortOrder) || 0),
    0,
  ) + 1
}
