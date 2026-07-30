import assert from 'node:assert/strict'
import test from 'node:test'
import { albumPlan } from '../scripts/line-album-reconcile.mjs'

const item = (contentHash, path = contentHash) => ({ contentHash, path })

test('album plan adds new images and removes only managed missing images', () => {
  const result = albumPlan([item('keep'), item('new')], [item('keep'), item('manual')], [item('keep'), item('gone')])
  assert.deepEqual(result.additions.map((entry) => entry.contentHash), ['new'])
  assert.deepEqual(result.adoptions.map((entry) => entry.contentHash), ['keep'])
  assert.deepEqual(result.removals.map((entry) => entry.contentHash), ['gone'])
})

test('first snapshot treats the dedicated LINE folder as the initial mirror', () => {
  const result = albumPlan([item('keep')], [item('keep'), item('stale')], [], true)
  assert.deepEqual(result.removals.map((entry) => entry.contentHash), ['stale'])
})
