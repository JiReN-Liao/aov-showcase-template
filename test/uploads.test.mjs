import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProductInput, productInputFromRow } from '../functions/_lib/products.js'
import { MAX_BATCH_ITEMS, isPublicStatus, safeImageKey } from '../functions/_lib/uploads.js'
import { isRetryableUploadStatus, retryAfterMs } from '../src/storage.js'

test('PATCH input mapping preserves image key and sort order from snake_case rows', () => {
  const current = productInputFromRow({
    id: 'product-1',
    code: 'AOV-001',
    title: '',
    description: '',
    price: null,
    status: 'draft',
    note: '',
    image_key: 'img-1',
    sort_order: 7,
  })
  const product = normalizeProductInput({ ...current, title: 'Updated' })
  assert.equal(product.imageKey, 'img-1')
  assert.equal(product.sortOrder, 7)
})

test('upload batch helpers validate keys, limits, and publish statuses', () => {
  assert.equal(MAX_BATCH_ITEMS, 20)
  assert.equal(safeImageKey('img-a_1.jpg'), 'img-a_1.jpg')
  assert.equal(safeImageKey('../unsafe'), '')
  assert.equal(isPublicStatus('available'), true)
  assert.equal(isPublicStatus('draft'), false)
})

test('image upload retry helpers cover transient responses and Retry-After', () => {
  assert.equal(isRetryableUploadStatus(408), true)
  assert.equal(isRetryableUploadStatus(429), true)
  assert.equal(isRetryableUploadStatus(503), true)
  assert.equal(isRetryableUploadStatus(400), false)
  assert.equal(retryAfterMs('2', 0), 2000)
})
