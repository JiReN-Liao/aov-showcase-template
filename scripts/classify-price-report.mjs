#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const input = resolve(process.argv[2] || 'price-recognition-report.json')
const output = resolve(process.argv[3] || 'price-recognition-summary.json')
const records = JSON.parse(await readFile(input, 'utf8'))
if (!Array.isArray(records)) throw new Error('價格辨識報告格式錯誤。')

function priceBand(price) {
  if (price == null) return 'review'
  if (price < 3_000) return 'under-3000'
  if (price < 10_000) return '3000-9999'
  if (price < 50_000) return '10000-49999'
  return '50000-plus'
}

const items = records.map((record) => ({
  image: record.image,
  price: record.price,
  confidence: record.confidence,
  classification: priceBand(record.price),
  decision: record.price == null ? 'review' : 'ready',
  reason: record.reason,
}))
const counts = Object.fromEntries(['under-3000', '3000-9999', '10000-49999', '50000-plus', 'review'].map((band) => [band, items.filter((item) => item.classification === band).length]))
const summary = { generatedAt: new Date().toISOString(), total: items.length, recognized: items.filter((item) => item.decision === 'ready').length, review: items.filter((item) => item.decision === 'review').length, counts, items }
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, total: summary.total, recognized: summary.recognized, review: summary.review, counts }, null, 2))
