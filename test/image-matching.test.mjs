import test from 'node:test'
import assert from 'node:assert/strict'
import { bytesToHex, findUniqueVisualMatch, hammingDistance, normalizeImageRequests, normalizeRequestedHashes, normalizeVisualHash } from '../functions/_lib/image-matching.js'

test('image matching accepts unique lowercase SHA-256 hashes only', () => {
  const hash = 'A'.repeat(64)
  assert.deepEqual(normalizeRequestedHashes([hash, hash.toLowerCase(), 'bad', null]), ['a'.repeat(64)])
  assert.deepEqual(normalizeRequestedHashes('not-an-array'), [])
})

test('visual hashes normalize and calculate bit distance', () => {
  assert.equal(normalizeVisualHash('ABCDEF0123456789'), 'abcdef0123456789')
  assert.equal(normalizeVisualHash('short'), '')
  assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4)
  assert.deepEqual(normalizeImageRequests([{ hash: 'A'.repeat(64), visualHash: 'F'.repeat(16) }]), [
    { hash: 'a'.repeat(64), visualHash: 'f'.repeat(16) },
  ])
})

test('visual matching rejects distant and ambiguous candidates', () => {
  const exact = { id: 'exact', visualHash: '0000000000000001' }
  const distant = { id: 'distant', visualHash: 'ffffffffffffffff' }
  assert.equal(findUniqueVisualMatch('0000000000000000', [exact, distant]).match.id, 'exact')
  assert.equal(findUniqueVisualMatch('0000000000000000', [distant]).match, null)
  const ambiguous = findUniqueVisualMatch('0000000000000000', [exact, { id: 'near', visualHash: '0000000000000002' }])
  assert.equal(ambiguous.match, null)
  assert.equal(ambiguous.ambiguous, true)
})

test('image matching hash conversion keeps leading zeroes', () => {
  assert.equal(bytesToHex(Uint8Array.from([0, 1, 15, 255]).buffer), '00010fff')
})
