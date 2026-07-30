#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_CONFIG = join(ROOT, 'config', 'local-paths.json')
const SUPPLIER_CONFIG = join(ROOT, 'config', 'suppliers.json')
const STATE_FILE = join(ROOT, 'config', 'sync-state.json')
const ENV_FILE = join(ROOT, '.env.admin')
const IMAGE_TYPES = new Map([['.avif', 'image/avif'], ['.gif', 'image/gif'], ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']])

export function sha256Hex(buffer) { return createHash('sha256').update(buffer).digest('hex') }
export function isImageFile(file) { return IMAGE_TYPES.has(extname(file).toLowerCase()) }
export function contentType(file) { return IMAGE_TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream' }

export function reconcilePlan(localItems, remoteItems, managedHashes = []) {
  const localByHash = new Map(localItems.map((item) => [item.contentHash, item]))
  const remoteByHash = new Map(remoteItems.map((item) => [item.contentHash, item]))
  const managed = new Set(managedHashes)
  return {
    downloads: remoteItems.filter((item) => !localByHash.has(item.contentHash) && item.origin === 'mobile' && !item.localSyncedAt),
    uploads: localItems.filter((item) => !remoteByHash.has(item.contentHash)),
    removals: remoteItems.filter((item) => !localByHash.has(item.contentHash) && item.localSyncedAt && managed.has(item.contentHash)),
  }
}

export function localDeletionPlan(localItems, remoteItems) {
  return remoteItems
    .filter((item) => item.deletedAt && !item.localDeletedAt)
    .map((item) => ({
      item,
      files: localItems.filter((local) => local.supplierId === item.supplierId && local.contentHash === item.contentHash),
    }))
}

export function safeFileName(value, fallback = 'account.jpg') {
  const portablePath = String(value || '').replace(/\\/gu, '/')
  const name = basename(portablePath).replace(/[<>:"/\\|?*]/gu, '_').replace(/\p{Cc}/gu, '_').trim()
  return name && name !== '.' && name !== '..' ? name.slice(0, 180) : fallback
}

export async function mapLimit(items, concurrency, operation) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

export async function scanSupplierRoot(root, suppliers, previousCache = {}) {
  const cache = {}
  const items = []
  for (const supplier of suppliers) {
    const folder = join(root, supplier.name)
    const files = await walkImages(folder)
    for (const file of files) {
      const info = await stat(file)
      const cacheKey = relative(root, file).split(sep).join('/')
      const cached = previousCache[cacheKey]
      const contentHash = cached?.size === info.size && cached?.mtimeMs === info.mtimeMs
        ? cached.contentHash
        : sha256Hex(await readFile(file))
      cache[cacheKey] = { size: info.size, mtimeMs: info.mtimeMs, contentHash }
      items.push({ supplierId: supplier.id, supplierName: supplier.name, source: supplier.source, path: file, fileName: basename(file), contentHash, size: info.size, contentType: contentType(file) })
    }
  }
  return { items, cache }
}

async function main() {
  const command = process.argv[2] || 'status'
  const dryRun = process.argv.includes('--dry-run')
  await loadEnvFile(ENV_FILE)
  const localConfig = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'))
  const suppliers = JSON.parse(await readFile(SUPPLIER_CONFIG, 'utf8'))
  const supplierRoot = resolve(localConfig.supplierRoot)
  await validateSupplierRoot(supplierRoot, suppliers)
  if (command === 'status') {
    const state = await loadState()
    const scan = await scanSupplierRoot(supplierRoot, suppliers, state.fileCache)
    console.log(JSON.stringify({ ok: true, supplierRoot, suppliers: suppliers.map((supplier) => ({ ...supplier, files: scan.items.filter((item) => item.supplierId === supplier.id).length })), managed: state.managedHashes.length }, null, 2))
    return
  }
  if (!['once', 'watch'].includes(command)) usage()
  const api = await CloudApi.create()
  const run = () => syncOnce({ api, supplierRoot, suppliers, dryRun })
  await run()
  if (command === 'watch') {
    const seconds = Math.max(10, Number(localConfig.pollIntervalSeconds || 30))
    console.log(`watching every ${seconds}s; press Ctrl+C to stop`)
    setInterval(() => run().catch((error) => console.error(`[sync] ${error.message}`)), seconds * 1000)
  }
}

async function syncOnce({ api, supplierRoot, suppliers, dryRun }) {
  const state = await loadState()
  let scan = await scanSupplierRoot(supplierRoot, suppliers, state.fileCache)
  const [inventory, catalog] = await Promise.all([api.get('/api/admin/sync/items'), api.get('/api/admin/catalog')])
  const inventoryItems = inventory.items || []
  const deletionPlan = localDeletionPlan(scan.items, inventoryItems)
  const actions = { adopted: 0, downloaded: 0, uploaded: 0, removed: 0, localDeleted: 0, deleteAcknowledged: 0 }

  for (const task of deletionPlan) {
    if (dryRun) continue
    for (const local of task.files) {
      const currentHash = sha256Hex(await readFile(local.path))
      if (currentHash !== task.item.contentHash) throw new Error(`Local file changed before deletion: ${local.fileName}`)
      await unlink(local.path)
      actions.localDeleted += 1
    }
    await api.post(`/api/admin/sync/items/${encodeURIComponent(task.item.productId)}/ack`, { deleted: true })
    actions.deleteAcknowledged += 1
  }

  if (!dryRun && deletionPlan.some((task) => task.files.length)) {
    scan = await scanSupplierRoot(supplierRoot, suppliers, scan.cache)
  }
  const remoteItems = inventoryItems.filter((item) => !item.deletedAt)
  const linkedProductIds = new Set(remoteItems.map((item) => item.productId))
  const unlinkedProducts = (catalog.products || []).filter((product) => product.imageKey && !linkedProductIds.has(product.id))
  const localByHash = new Map(scan.items.map((item) => [item.contentHash, item]))
  const adopted = []

  const adoptionCandidates = await mapLimit(unlinkedProducts, 6, async (product) => {
    let hash = state.cloudImageHashes[product.imageKey]
    if (!hash) {
      const buffer = await api.bytes(product.imageUrl)
      hash = sha256Hex(buffer)
      state.cloudImageHashes[product.imageKey] = hash
    }
    const local = localByHash.get(hash)
    if (!local) return null
    return { product, local }
  })

  for (const candidate of adoptionCandidates) {
    if (!candidate) continue
    const { product, local } = candidate
    adopted.push({ product, local })
    if (!dryRun) await api.post('/api/admin/sync/items', syncLink(product.id, local, local.source))
  }

  let currentRemote = dryRun ? [...remoteItems, ...adopted.map(({ product, local }) => ({ productId: product.id, contentHash: local.contentHash, supplierId: local.supplierId, origin: local.source, localSyncedAt: new Date().toISOString(), imageKey: product.imageKey, version: product.version }))] : ((await api.get('/api/admin/sync/items')).items || []).filter((item) => !item.deletedAt)
  let plan = reconcilePlan(scan.items, currentRemote, state.managedHashes)
  actions.adopted = adopted.length

  for (const item of plan.downloads) {
    const supplier = suppliers.find((entry) => entry.id === item.supplierId)
    if (!supplier) continue
    const target = await availableTarget(join(supplierRoot, supplier.name), item.fileName || `${item.code}${extensionForType(item.contentType)}`, item.contentHash)
    if (dryRun) continue
    const buffer = await api.bytes(item.imageUrl)
    if (sha256Hex(buffer) !== item.contentHash) throw new Error(`Cloud hash mismatch for ${item.code}`)
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, buffer)
    await rename(temporary, target)
    await api.post(`/api/admin/sync/items/${encodeURIComponent(item.productId)}/ack`, {})
    actions.downloaded += 1
  }

  if (!dryRun && plan.downloads.length) {
    scan = await scanSupplierRoot(supplierRoot, suppliers, scan.cache)
    currentRemote = ((await api.get('/api/admin/sync/items')).items || []).filter((item) => !item.deletedAt)
    plan = reconcilePlan(scan.items, currentRemote, state.managedHashes)
  }

  for (const local of plan.uploads) {
    if (dryRun) continue
    await uploadLocal(api, local)
    actions.uploaded += 1
  }

  for (const item of plan.removals) {
    if (dryRun) continue
    await api.delete(`/api/admin/products/${encodeURIComponent(item.productId)}`, { expectedVersion: item.version })
    await api.delete(`/api/images/${encodeURIComponent(item.imageKey)}`)
    actions.removed += 1
  }

  if (!dryRun) {
    const finalScan = await scanSupplierRoot(supplierRoot, suppliers, scan.cache)
    const finalInventory = ((await api.get('/api/admin/sync/items')).items || []).filter((item) => !item.deletedAt)
    state.fileCache = finalScan.cache
    state.managedHashes = [...new Set(finalInventory.map((item) => item.contentHash))]
    state.lastSyncAt = new Date().toISOString()
    await saveState(state)
  }
  console.log(JSON.stringify({ ok: true, dryRun, local: scan.items.length, remote: currentRemote.length, plan: { localDelete: deletionPlan.length, adopt: adopted.length, download: plan.downloads.length, upload: plan.uploads.length, remove: plan.removals.length }, actions }, null, 2))
}

async function uploadLocal(api, local) {
  const batch = await api.post('/api/admin/upload-batches', {})
  const imageKey = `sync-${local.contentHash}-${randomUUID().slice(0, 8)}`
  const registered = await api.post(`/api/admin/upload-batches/${encodeURIComponent(batch.batch.id)}/items`, { items: [{ clientItemId: randomUUID(), imageKey, contentType: local.contentType, size: local.size, sortOrder: 0 }] })
  const product = registered.items?.[0]?.product
  if (!product) throw new Error(`Could not register ${local.fileName}`)
  await api.putBytes(`/api/images/${encodeURIComponent(imageKey)}`, await readFile(local.path), local.contentType)
  await api.post('/api/admin/sync/items', syncLink(product.id, local, local.source))
  try { await api.post(`/api/admin/images/${encodeURIComponent(imageKey)}/recognize-price`, {}) } catch {}
}

function syncLink(productId, local, origin) {
  return { productId, supplierId: local.supplierId, origin: origin === 'line' ? 'line' : 'facebook', contentHash: local.contentHash, fileName: local.fileName }
}

class CloudApi {
  constructor(baseUrl, token) { this.baseUrl = baseUrl; this.token = token }
  static async create() {
    const baseUrl = requiredEnv('AOV_API_URL').replace(/\/$/u, '')
    const response = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: requiredEnv('AOV_ADMIN_USERNAME'), password: requiredEnv('AOV_ADMIN_PASSWORD') }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.token) throw new Error('Admin login failed.')
    return new CloudApi(baseUrl, data.token)
  }
  get(path) { return this.request(path) }
  post(path, body) { return this.request(path, { method: 'POST', body }) }
  delete(path, body) { return this.request(path, { method: 'DELETE', body }) }
  async putBytes(path, buffer, type) { return this.request(path, { method: 'PUT', rawBody: buffer, headers: { 'Content-Type': type, 'Content-Length': String(buffer.byteLength) } }) }
  async bytes(path) {
    const response = await fetch(new URL(path, `${this.baseUrl}/`), { headers: { Authorization: `Bearer ${this.token}` } })
    if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, { method: options.method || 'GET', headers: { Authorization: `Bearer ${this.token}`, ...(options.headers || {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `${options.method || 'GET'} ${path} failed: HTTP ${response.status}`)
    return data
  }
}

async function walkImages(folder) {
  const output = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) output.push(...await walkImages(path))
    else if (entry.isFile() && isImageFile(path)) output.push(path)
  }
  return output
}

async function availableTarget(folder, preferredName, hash) {
  await mkdir(folder, { recursive: true })
  const safe = safeFileName(preferredName, `${hash}.jpg`)
  const direct = join(folder, safe)
  try { if (sha256Hex(await readFile(direct)) === hash) return direct } catch {}
  try { await stat(direct); return join(folder, `${basename(safe, extname(safe))}-${hash.slice(0, 8)}${extname(safe)}`) } catch { return direct }
}

async function validateSupplierRoot(root, suppliers) {
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('supplierRoot must be a directory.')
  for (const supplier of suppliers) {
    const folder = join(root, supplier.name)
    if (!(await stat(folder)).isDirectory()) throw new Error(`Missing supplier folder: ${supplier.name}`)
  }
}

async function loadState() {
  try { return normalizeState(JSON.parse(await readFile(STATE_FILE, 'utf8'))) } catch { return normalizeState({}) }
}
function normalizeState(value) { return { version: 1, lastSyncAt: value.lastSyncAt || null, fileCache: value.fileCache || {}, cloudImageHashes: value.cloudImageHashes || {}, managedHashes: Array.isArray(value.managedHashes) ? value.managedHashes : [] } }
async function saveState(state) { await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8') }
async function loadEnvFile(file) {
  try {
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/u)) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/u)
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/gu, '')
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
function extensionForType(type) { return ({ 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' })[type] || '.jpg' }
function requiredEnv(name) { if (!process.env[name]) throw new Error(`${name} is required in the environment or .env.admin.`); return process.env[name] }
function usage() { throw new Error('Usage: npm run sync -- status | once [--dry-run] | watch [--dry-run]') }

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main().catch((error) => { console.error(`[sync] ${error.message}`); process.exitCode = 1 })
