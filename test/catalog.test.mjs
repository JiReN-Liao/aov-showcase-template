import test from 'node:test'
import assert from 'node:assert/strict'
import { getAdminProducts, getPublicProducts, normalizeProductInput, parseSettings } from '../functions/_lib/products.js'

test('admin catalog query returns newest sort order first', async () => {
  let query = ''
  const products = await getAdminProducts({ DB: { prepare(value) { query = value; return { all: async () => ({ results: [] }) } } } })
  assert.deepEqual(products, [])
  assert.match(query, /ORDER BY sort_order DESC, created_at DESC, code DESC/)
})

test('public catalog query filters statuses and does not select notes', async () => {
  let query = ''
  const products = await getPublicProducts({ DB: { prepare(value) { query = value; return { all: async () => ({ results: [] }) } } } })
  assert.deepEqual(products, [])
  assert.match(query, /status = 'available'/)
  assert.match(query, /\bpublished_at\b/)
  assert.doesNotMatch(query, /\bnote\b/)
  assert.match(query, /ORDER BY sort_order ASC, code ASC/)
})

test('product validation accepts only known product statuses', () => {
  assert.equal(normalizeProductInput({ id: 'one', code: 'AOV-001', status: 'draft' }).status, 'draft')
  assert.throws(() => normalizeProductInput({ id: 'one', code: 'AOV-001', status: 'private' }))
})

test('settings normalization keeps only the public settings shape', () => {
  assert.deepEqual(Object.keys(parseSettings(JSON.stringify({ siteName: 'Shop', adminUsers: [{ password: 'nope' }] }))).sort(), ['contactMethods', 'siteName'])
})
