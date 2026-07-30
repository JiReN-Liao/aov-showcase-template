import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryName, imageKeyForHash, parseArgs, sha256Hex } from '../scripts/aov-library.mjs'

test('library helpers produce deterministic content keys and parse flags', () => {
  const hash = sha256Hex(Buffer.from('aov'))
  assert.equal(hash.length, 64)
  assert.equal(imageKeyForHash(hash), `aov-${hash}`)
  assert.deepEqual(parseArgs(['--file', 'one.png', '--status=available', '--dry-run']), { file: 'one.png', status: 'available', 'dry-run': true })
})

test('category names are private folder names and cannot escape the library', () => {
  assert.equal(categoryName('競技場'), '競技場')
  assert.throws(() => categoryName('../public'), /path separators/)
  assert.throws(() => categoryName('a\\b'), /path separators/)
})
