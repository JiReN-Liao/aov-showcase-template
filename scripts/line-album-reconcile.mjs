import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(ROOT, 'config', 'local-paths.json')
const SUPPLIERS_FILE = join(ROOT, 'config', 'suppliers.json')
const STATE_FILE = join(ROOT, 'config', 'line-album-state.json')
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function albumPlan(snapshotItems, localItems, managedItems, bootstrap = false) {
  const snapshotByHash = new Map(snapshotItems.map((item) => [item.contentHash, item]))
  const localByHash = new Map(localItems.map((item) => [item.contentHash, item]))
  const managed = bootstrap ? localItems : managedItems
  return {
    additions: snapshotItems.filter((item) => !localByHash.has(item.contentHash)),
    adoptions: snapshotItems.filter((item) => localByHash.has(item.contentHash)),
    removals: managed.filter((item) => !snapshotByHash.has(item.contentHash)),
  }
}

export async function reconcileAlbumSnapshot({ supplierRoot, supplier, snapshotRoot, state, dryRun = false }) {
  if (supplier.source !== 'line' || supplier.albumName !== '現貨價格') throw new Error(`Invalid LINE supplier: ${supplier.id}`)
  const supplierFolder = join(supplierRoot, supplier.name)
  const [snapshotItems, localItems] = await Promise.all([scanImages(snapshotRoot), scanImages(supplierFolder)])
  const supplierState = state.suppliers?.[supplier.id]
  const bootstrap = !supplierState
  const managedItems = (supplierState?.items || []).map((item) => ({ ...item, path: join(supplierFolder, ...item.relativePath.split('/')) }))
  const plan = albumPlan(snapshotItems, localItems, managedItems, bootstrap)
  const finalItems = []

  for (const item of plan.adoptions) {
    const local = localItems.find((candidate) => candidate.contentHash === item.contentHash)
    finalItems.push({ contentHash: item.contentHash, relativePath: normalizedRelative(supplierFolder, local.path), fileName: basename(local.path) })
  }

  for (const item of plan.additions) {
    const target = await availableTarget(supplierFolder, basename(item.path), item.contentHash)
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.tmp`
      await copyFile(item.path, temporary)
      await rename(temporary, target)
    }
    finalItems.push({ contentHash: item.contentHash, relativePath: normalizedRelative(supplierFolder, target), fileName: basename(target) })
  }

  for (const item of plan.removals) {
    if (dryRun) continue
    try {
      const currentHash = hashBuffer(await readFile(item.path))
      if (currentHash === item.contentHash) await unlink(item.path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  if (!dryRun) {
    state.suppliers ||= {}
    state.suppliers[supplier.id] = {
      groupName: supplier.name,
      albumName: supplier.albumName,
      syncedAt: new Date().toISOString(),
      items: finalItems.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    }
  }
  return { supplierId: supplier.id, bootstrap, snapshot: snapshotItems.length, local: localItems.length, added: plan.additions.length, adopted: plan.adoptions.length, removed: plan.removals.length }
}

async function main() {
  const command = process.argv[2]
  if (command !== 'apply-snapshot') throw new Error('Usage: node scripts/line-album-reconcile.mjs apply-snapshot --supplier ID --snapshot PATH [--dry-run]')
  const supplierId = argument('--supplier')
  const snapshotRoot = resolve(argument('--snapshot'))
  const dryRun = process.argv.includes('--dry-run')
  const [config, suppliers, state] = await Promise.all([readJson(CONFIG_FILE), readJson(SUPPLIERS_FILE), loadState()])
  const supplier = suppliers.find((item) => item.id === supplierId)
  if (!supplier) throw new Error(`Unknown supplier: ${supplierId}`)
  const result = await reconcileAlbumSnapshot({ supplierRoot: resolve(config.supplierRoot), supplier, snapshotRoot, state, dryRun })
  if (!dryRun) await saveState(state)
  console.log(JSON.stringify({ ok: true, dryRun, ...result }, null, 2))
}

async function scanImages(folder) {
  const output = []
  for (const path of await walkImages(folder)) {
    output.push({ path, contentHash: hashBuffer(await readFile(path)) })
  }
  return output
}

async function walkImages(folder) {
  const output = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) output.push(...await walkImages(path))
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) output.push(path)
  }
  return output
}

async function availableTarget(folder, preferredName, hash) {
  const safe = basename(preferredName).replace(/[<>:"/\\|?*]/gu, '_') || `${hash}.jpg`
  const direct = join(folder, safe)
  try {
    if ((await stat(direct)).isFile()) return join(folder, `${basename(safe, extname(safe))}-${hash.slice(0, 8)}${extname(safe)}`)
  } catch {}
  return direct
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join('/')
}

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required.`)
  return process.argv[index + 1]
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function loadState() {
  try { return { version: 1, suppliers: {}, ...await readJson(STATE_FILE) } } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, suppliers: {} }
    throw error
  }
}
async function saveState(state) {
  const temporary = `${STATE_FILE}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, STATE_FILE)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main().catch((error) => { console.error(`[line-album] ${error.message}`); process.exitCode = 1 })
