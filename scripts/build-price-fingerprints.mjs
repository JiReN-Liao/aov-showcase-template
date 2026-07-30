#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [reportArg, outputArg = 'price-fingerprints.sql'] = process.argv.slice(2)
if (!reportArg) {
  console.error('Usage: node scripts/build-price-fingerprints.mjs <report.json> [output.sql]')
  process.exit(1)
}

const report = JSON.parse(await readFile(resolve(reportArg), 'utf8'))
const recognized = report.filter((item) => Number.isInteger(item.price) && item.price > 0)
const now = new Date().toISOString()
const unique = new Map()

for (const item of recognized) {
  const buffer = await readFile(item.image)
  unique.set(createHash('sha256').update(buffer).digest('hex'), item.price)
}

const lines = []
for (const [hash, price] of unique) {
  lines.push(`INSERT INTO price_fingerprints (sha256, price, created_at, updated_at) VALUES ('${hash}', ${price}, '${now}', '${now}') ON CONFLICT(sha256) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at;`)
}
lines.push('')
await writeFile(resolve(outputArg), lines.join('\n'), 'utf8')
console.log(JSON.stringify({ report: report.length, recognized: recognized.length, unique: unique.size, output: resolve(outputArg) }))
