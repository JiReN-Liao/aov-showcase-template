#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

const baseUrl = process.env.AOV_SMOKE_URL || 'http://127.0.0.1:8791'

async function main() {
  const password = `${randomUUID()}Aa1!`
  const setup = await json('/api/admin/setup', { method: 'POST', body: { username: 'smoke-admin', password } })
  const token = setup.token
  const batchId = `smoke-${randomUUID()}`
  const imageKey = `smoke-${randomUUID()}`
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const contentHash = createHash('sha256').update(image).digest('hex')

  await json('/api/admin/upload-batches', { method: 'POST', token, body: { id: batchId } })
  const registered = await json(`/api/admin/upload-batches/${encodeURIComponent(batchId)}/items`, {
    method: 'POST', token, body: { items: [{ clientItemId: 'smoke-item', imageKey, contentType: 'image/png', size: image.length, sortOrder: 1 }] },
  })
  const product = registered.items[0].product
  await raw(`/api/images/${encodeURIComponent(imageKey)}`, { method: 'PUT', token, body: image, contentType: 'image/png' })
  await json('/api/admin/sync/items', {
    method: 'POST', token, body: { productId: product.id, supplierId: 'supplier-1', origin: 'mobile', contentHash, fileName: 'smoke.png' },
  })

  const matched = await json('/api/admin/products/match-images', { method: 'POST', token, body: { hashes: [contentHash] } })
  assert.equal(matched.matches.length, 1)
  assert.equal(matched.matches[0].product.id, product.id)
  const deleted = await json('/api/admin/products/batch', { method: 'DELETE', token, body: { ids: [product.id] } })
  assert.equal(deleted.deleted, 1)
  const queued = await json('/api/admin/sync/items', { token })
  assert.equal(queued.items.length, 1)
  assert.ok(queued.items[0].deletedAt)
  await json(`/api/admin/sync/items/${encodeURIComponent(product.id)}/ack`, { method: 'POST', token, body: { deleted: true } })
  const afterAck = await json('/api/admin/sync/items', { token })
  assert.equal(afterAck.items.length, 0)
  console.log(JSON.stringify({ ok: true, product: product.code, matches: matched.matches.length, deleted: deleted.deleted, pendingDelete: queued.items.length, afterAck: afterAck.items.length }, null, 2))
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${payload.error || ''}`)
  return payload
}

async function raw(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': options.contentType },
    body: options.body,
  })
  if (!response.ok) throw new Error(`${options.method} ${path}: ${response.status} ${await response.text()}`)
}

main().catch((error) => {
  console.error(`[smoke-image-delete] ${error.message}`)
  process.exitCode = 1
})
