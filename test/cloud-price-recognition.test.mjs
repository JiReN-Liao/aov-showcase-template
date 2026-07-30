import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecognizedPrice } from '../functions/api/admin/images/[key]/recognize-price.js'

test('cloud price parser handles integer and ten-thousand decimal formats', () => {
  assert.equal(parseRecognizedPrice('8000'), 8000)
  assert.equal(parseRecognizedPrice('14.0'), 140000)
  assert.equal(parseRecognizedPrice('3.85'), 38500)
})

test('cloud price parser rejects non-price and implausible responses', () => {
  assert.equal(parseRecognizedPrice('NONE'), null)
  assert.equal(parseRecognizedPrice('自開'), null)
  assert.equal(parseRecognizedPrice('125'), null)
  assert.equal(parseRecognizedPrice('999999'), null)
})
