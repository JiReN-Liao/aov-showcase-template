import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/price-recognition/recognize_prices.py', import.meta.url))

function runRecognition(args) {
  const result = spawnSync('python', [script, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('price recognition selects an explicitly labelled currency price', () => {
  const [result] = runRecognition(['--text', '售價：NT$ 1,280'])

  assert.equal(result.price, 1280)
  assert.ok(result.confidence >= 0.9)
  assert.equal(result.candidates[0].evidence, 'label+currency')
  assert.match(result.reason, /Selected 1280/)
})

test('price recognition keeps weak number-only OCR as review candidates', () => {
  const [result] = runRecognition(['--text', '擊殺 2024 場，戰力 8800'])

  assert.equal(result.price, null)
  assert.deepEqual(result.candidates.map((candidate) => candidate.value), [2024, 8800])
  assert.match(result.reason, /below the review threshold/)
})

test('price recognition returns one stable result for each supplied text input', () => {
  const results = runRecognition(['--text', '價格 888', '--text', '沒有可辨識文字'])

  assert.equal(results.length, 2)
  assert.equal(results[0].price, 888)
  assert.deepEqual(results[1], {
    image: '<text:2>',
    price: null,
    confidence: 0,
    candidates: [],
    reason: 'No price-like number was found.',
  })
})

test('price recognition ignores zero-value percentage statistics', () => {
  const [result] = runRecognition(['--text', '0.00%'])

  assert.equal(result.price, null)
  assert.deepEqual(result.candidates, [])
})
