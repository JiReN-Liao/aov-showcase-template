import test from 'node:test'
import assert from 'node:assert/strict'
import { localDeletionPlan, reconcilePlan, safeFileName } from '../scripts/sync-agent.mjs'

test('sync plan downloads new mobile items, uploads new local files, and only removes managed missing files', () => {
  const local = [
    { contentHash: 'a', supplierId: 'one' },
    { contentHash: 'local-new', supplierId: 'one' },
  ]
  const remote = [
    { contentHash: 'a', origin: 'facebook', localSyncedAt: 'now' },
    { contentHash: 'mobile-new', origin: 'mobile', localSyncedAt: null },
    { contentHash: 'removed', origin: 'line', localSyncedAt: 'before' },
    { contentHash: 'unsafe-to-delete', origin: 'line', localSyncedAt: 'before' },
  ]
  const plan = reconcilePlan(local, remote, ['removed'])
  assert.deepEqual(plan.downloads.map((item) => item.contentHash), ['mobile-new'])
  assert.deepEqual(plan.uploads.map((item) => item.contentHash), ['local-new'])
  assert.deepEqual(plan.removals.map((item) => item.contentHash), ['removed'])
})

test('download file names cannot escape a supplier folder', () => {
  assert.equal(safeFileName('..\\outside.jpg'), 'outside.jpg')
  assert.equal(safeFileName('bad:name?.png'), 'bad_name_.png')
})

test('local deletion queue only targets exact hashes in the matching supplier', () => {
  const local = [
    { contentHash: 'same', supplierId: 'one', path: 'one.jpg' },
    { contentHash: 'same', supplierId: 'two', path: 'two.jpg' },
    { contentHash: 'different', supplierId: 'one', path: 'other.jpg' },
  ]
  const remote = [
    { productId: 'deleted', supplierId: 'one', contentHash: 'same', deletedAt: 'now', localDeletedAt: null },
    { productId: 'done', supplierId: 'one', contentHash: 'different', deletedAt: 'before', localDeletedAt: 'after' },
    { productId: 'active', supplierId: 'one', contentHash: 'same', deletedAt: null, localDeletedAt: null },
  ]
  const plan = localDeletionPlan(local, remote)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].item.productId, 'deleted')
  assert.deepEqual(plan[0].files.map((item) => item.path), ['one.jpg'])
})
