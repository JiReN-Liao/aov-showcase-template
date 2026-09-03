import test from 'node:test'
import assert from 'node:assert/strict'
import { compareAdminProductsNewestFirst, nextProductSortOrder } from '../src/product-order.js'

test('admin products sort from newest order value to oldest', () => {
  const products = [
    { code: 'AOV-9', sortOrder: 9, createdAt: '2026-09-01T00:00:00.000Z' },
    { code: 'AOV-11', sortOrder: 11, createdAt: '2026-09-03T00:00:00.000Z' },
    { code: 'AOV-10', sortOrder: 10, createdAt: '2026-09-02T00:00:00.000Z' },
  ]

  assert.deepEqual(products.sort(compareAdminProductsNewestFirst).map((product) => product.code), [
    'AOV-11',
    'AOV-10',
    'AOV-9',
  ])
})

test('new uploads continue after the current highest sort order', () => {
  assert.equal(nextProductSortOrder([{ sortOrder: 2 }, { sortOrder: 12 }, { sortOrder: 7 }]), 13)
  assert.equal(nextProductSortOrder([]), 1)
})
