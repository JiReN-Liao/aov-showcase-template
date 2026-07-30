#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [reportArg, catalogArg, registryArg = 'config/price-style-registry.json', sqlArg = 'price-style-registry.sql'] = process.argv.slice(2)
if (!reportArg || !catalogArg) {
  console.error('Usage: node scripts/build-price-style-registry.mjs <ocr-report.json> <catalog.json> [registry.json] [output.sql]')
  process.exit(1)
}

async function readJson(path) {
  return JSON.parse((await readFile(resolve(path), 'utf8')).replace(/^\uFEFF/, ''))
}

async function readOptionalJson(path, fallback) {
  try {
    return await readJson(path)
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

const report = await readJson(reportArg)
const catalogPayload = await readJson(catalogArg)
const suppliers = await readJson('config/suppliers.json')
const existingRegistry = await readOptionalJson(registryArg, { suppliers: [] })
const styleOverrides = await readOptionalJson('config/price-style-overrides.json', {})
const catalog = Array.isArray(catalogPayload)
  ? catalogPayload.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : entry?.hash ? [entry] : [])
  : []

const reportByHash = new Map()
for (const item of report) {
  const hash = basename(item.image).match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase()
  if (!hash || !Number.isInteger(item.price) || item.price <= 0) continue
  const candidate = item.candidates?.find((value) => value.value === item.price)
  reportByHash.set(hash, {
    confidence: item.confidence,
    evidence: candidate?.evidence,
    geometry: candidate?.geometry,
  })
}

function roundedAverage(values) {
  if (!values.length) return undefined
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

function signatureFor(samples) {
  const measured = samples.map((sample) => sample.geometry).filter(Boolean)
  const evidence = [...new Set(samples.map((sample) => sample.evidence).filter(Boolean))].sort()
  return {
    geometry: measured.length ? {
      x: roundedAverage(measured.map((item) => item.x)),
      y: roundedAverage(measured.map((item) => item.y)),
      width: roundedAverage(measured.map((item) => item.width)),
      height: roundedAverage(measured.map((item) => item.height)),
    } : null,
    evidence,
    measuredSamples: measured.length,
  }
}

const generatedAt = new Date().toISOString()
const previousStyleByHash = new Map(
  (existingRegistry.suppliers || []).flatMap((supplier) =>
    (supplier.styles || []).flatMap((style) => (style.samples || []).map((sample) => [sample.hash, style.id])),
  ),
)
const registry = {
  version: 1,
  generatedAt,
  suppliers: suppliers.map((supplier) => {
    const samples = catalog
      .filter((item) => item.supplier_id === supplier.id && Number.isInteger(Number(item.price)) && Number(item.price) > 0)
      .map((item) => {
        const measurement = reportByHash.get(String(item.hash).toLowerCase()) || {}
        return {
          hash: String(item.hash).toLowerCase(),
          price: Number(item.price),
          ...measurement,
        }
      })
    if (!samples.length) return { supplierId: supplier.id, supplierName: supplier.name, styles: [] }
    const grouped = new Map()
    for (const sample of samples) {
      const requestedStyle = styleOverrides[sample.hash] || previousStyleByHash.get(sample.hash)
      const styleId = requestedStyle?.startsWith(`${supplier.id}-style-`)
        ? requestedStyle
        : `${supplier.id}-style-01`
      if (!grouped.has(styleId)) grouped.set(styleId, [])
      grouped.get(styleId).push(sample)
    }
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      styles: [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, styleSamples]) => ({
        id,
        label: `樣式 ${id.match(/style-(\d+)$/)?.[1] || '01'}`,
        kind: 'numeric-overlay',
        sampleCount: styleSamples.length,
        signature: signatureFor(styleSamples),
        samples: styleSamples,
      })),
    }
  }),
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const sql = []
for (const supplier of registry.suppliers) {
  for (const style of supplier.styles) {
    sql.push(
      `INSERT INTO price_styles (id, supplier_id, label, signature_json, sample_count, created_at, updated_at) VALUES (${quote(style.id)}, ${quote(supplier.supplierId)}, ${quote(style.label)}, ${quote(JSON.stringify(style.signature))}, ${style.sampleCount}, ${quote(generatedAt)}, ${quote(generatedAt)}) ON CONFLICT(id) DO UPDATE SET supplier_id=excluded.supplier_id, label=excluded.label, signature_json=excluded.signature_json, sample_count=excluded.sample_count, updated_at=excluded.updated_at;`,
    )
    for (const sample of style.samples) {
      sql.push(`UPDATE price_fingerprints SET supplier_id=${quote(supplier.supplierId)}, style_id=${quote(style.id)}, updated_at=${quote(generatedAt)} WHERE sha256=${quote(sample.hash)};`)
    }
  }
}
sql.push('')

await writeFile(resolve(registryArg), `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
await writeFile(resolve(sqlArg), sql.join('\n'), 'utf8')
console.log(JSON.stringify({
  registry: resolve(registryArg),
  sql: resolve(sqlArg),
  suppliers: registry.suppliers.filter((supplier) => supplier.styles.length).length,
  styles: registry.suppliers.reduce((total, supplier) => total + supplier.styles.length, 0),
  samples: registry.suppliers.reduce((total, supplier) => total + supplier.styles.reduce((count, style) => count + style.sampleCount, 0), 0),
}))
