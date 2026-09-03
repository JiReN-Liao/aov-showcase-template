import test from 'node:test'
import assert from 'node:assert/strict'
import { mapProduct, nextPublishedAt } from '../functions/_lib/products.js'
import { isTodayStock, publishedTimestamp, TODAY_STOCK_WINDOW_MS } from '../src/product-freshness.js'

const NOW = Date.parse('2026-09-03T12:00:00.000Z')

test('publication time changes only when a product enters available status', () => {
  const previous = '2026-09-01T08:00:00.000Z'
  const now = new Date(NOW).toISOString()

  assert.equal(nextPublishedAt('draft', 'available', null, now), now)
  assert.equal(nextPublishedAt('available', 'available', previous, now), previous)
  assert.equal(nextPublishedAt('available', 'hidden', previous, now), previous)
  assert.equal(nextPublishedAt('hidden', 'available', previous, now), now)
})

test('today stock uses a strict rolling 24-hour window', () => {
  const product = { status: 'available', publishedAt: new Date(NOW - TODAY_STOCK_WINDOW_MS + 1).toISOString() }

  assert.equal(isTodayStock(product, NOW), true)
  assert.equal(isTodayStock({ ...product, publishedAt: new Date(NOW - TODAY_STOCK_WINDOW_MS).toISOString() }, NOW), false)
  assert.equal(isTodayStock({ ...product, status: 'draft' }, NOW), false)
  assert.equal(isTodayStock({ ...product, publishedAt: new Date(NOW + 1).toISOString() }, NOW), false)
})

test('product mapping and newest sorting expose the cloud publication time', () => {
  const product = mapProduct({
    id: 'product-1',
    code: 'AOV-001',
    status: 'available',
    published_at: '2026-09-03T10:00:00.000Z',
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-03T11:00:00.000Z',
    version: 1,
  }, true)

  assert.equal(product.publishedAt, '2026-09-03T10:00:00.000Z')
  assert.equal(publishedTimestamp(product), Date.parse(product.publishedAt))
  assert.equal(Object.hasOwn(product, 'note'), false)
})
