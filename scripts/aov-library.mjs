#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LIBRARY_DIR = join(homedir(), 'AOVAccountLibrary')
const IMAGE_TYPES = new Map([['.avif', 'image/avif'], ['.gif', 'image/gif'], ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']])

export function parseArgs(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`)
    const [name, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) flags[name] = inline
    else if (args[index + 1] && !args[index + 1].startsWith('--')) flags[name] = args[++index]
    else flags[name] = true
  }
  return flags
}

export function sha256Hex(buffer) { return createHash('sha256').update(buffer).digest('hex') }
export function imageKeyForHash(hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid SHA-256 hash.')
  return `aov-${hash}`
}
export function categoryName(value = 'uncategorized') {
  const category = String(value).trim() || 'uncategorized'
  const hasControlCharacter = Array.from(category).some((character) => character.charCodeAt(0) < 32)
  if (category === '.' || category === '..' || isAbsolute(category) || category.includes('/') || category.includes('\\') || hasControlCharacter) throw new Error('--category must be one private folder name, without path separators.')
  return category
}
export function contentType(file) {
  return IMAGE_TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream'
}
export async function fileHash(file) { return sha256Hex(await readFile(file)) }

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2)
  const flags = parseArgs(rawArgs)
  if (!command || command === 'help' || flags.help) usage(0)
  const dryRun = Boolean(flags['dry-run'])
  const baseUrl = requiredEnv('AOV_API_URL').replace(/\/$/u, '')
  const token = await authenticate(baseUrl, dryRun)
  const libraryDir = resolve(process.env.AOV_LIBRARY_DIR || DEFAULT_LIBRARY_DIR)
  if (command === 'add') await add(flags, { baseUrl, token, dryRun, libraryDir })
  else if (command === 'remove') await remove(flags, { baseUrl, token, dryRun, libraryDir })
  else usage(1)
}

async function add(flags, context) {
  const file = resolve(requiredFlag(flags, 'file'))
  const info = await stat(file)
  if (!info.isFile()) throw new Error('--file must point to a file.')
  const buffer = await readFile(file)
  const hash = sha256Hex(buffer)
  const imageKey = imageKeyForHash(hash)
  const status = flags.status || 'draft'
  if (!['available', 'draft'].includes(status)) throw new Error('--status must be available or draft.')
  const price = flags.price === undefined ? undefined : numberFlag(flags.price, 'price')
  const category = categoryName(flags.category)
  const copyTarget = await targetForCopy(context.libraryDir, category, file, hash)
  const existing = (await getProducts(context)).find((product) => product.imageKey === imageKey)
  if (context.dryRun) {
    printPlan([
      ...(!existing ? [
        { method: 'POST', path: '/api/admin/upload-batches', body: '<new batch>' },
        { method: 'POST', path: '/api/admin/upload-batches/<batch>/items', body: { imageKey, contentType: contentType(file), size: buffer.byteLength } },
      ] : []),
      { method: 'PUT', path: `/api/images/${imageKey}`, body: `<${buffer.byteLength} bytes>` },
      ...(price !== undefined || flags.status !== undefined ? [{ method: 'PATCH', path: `/api/admin/products/${existing?.id || '<product>'}`, body: { ...(price !== undefined ? { price } : {}), ...(flags.status !== undefined ? { status } : {}) } }] : []),
      { local: 'copy', from: file, to: copyTarget || '(already in local library)' },
    ])
    return
  }
  let product = existing
  if (!product) {
    const batch = await request(context, '/api/admin/upload-batches', { method: 'POST', body: {} })
    const clientItemId = hash.slice(0, 32)
    const registered = await request(context, `/api/admin/upload-batches/${encodeURIComponent(batch.batch.id)}/items`, { method: 'POST', body: { items: [{ clientItemId, imageKey, contentType: contentType(file), size: buffer.byteLength, sortOrder: 0 }] } })
    const item = registered.items?.[0]
    if (!item?.product?.id) throw new Error('Upload registration did not return a product.')
    product = item.product
  }
  await request(context, `/api/images/${encodeURIComponent(imageKey)}`, { method: 'PUT', body: buffer, headers: { 'Content-Type': contentType(file), 'Content-Length': String(buffer.byteLength) } })
  if (price !== undefined || flags.status !== undefined) {
    const updated = await request(context, `/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', body: { ...(price !== undefined ? { price } : {}), ...(flags.status !== undefined ? { status } : {}), expectedVersion: product.version } })
    product = updated.product
  }
  const copiedTo = await copyIfNeeded(context.libraryDir, category, file, hash, copyTarget)
  console.log(JSON.stringify({ ok: true, product: product.code, imageKey, status: product.status, ...(price !== undefined ? { price: product.price } : {}), ...(copiedTo ? { copiedTo } : { local: 'already exists' }) }, null, 2))
}

async function remove(flags, context) {
  const file = resolve(requiredFlag(flags, 'file'))
  const libraryRelativePath = relative(context.libraryDir, file)
  if (!libraryRelativePath || libraryRelativePath === '..' || libraryRelativePath.startsWith(`..${sep}`) || isAbsolute(libraryRelativePath)) throw new Error('--file must be inside AOV_LIBRARY_DIR.')
  const info = await stat(file)
  if (!info.isFile()) throw new Error('--file must point to a file.')
  const imageKey = imageKeyForHash(await fileHash(file))
  const product = (await getProducts(context)).find((item) => item.imageKey === imageKey)
  if (context.dryRun) {
    printPlan([...(product ? [{ method: 'DELETE', path: `/api/admin/products/${product.id}`, body: { expectedVersion: product.version } }] : []), { method: 'DELETE', path: `/api/images/${imageKey}` }, { local: 'delete', path: file }])
    return
  }
  if (product) await request(context, `/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE', body: { expectedVersion: product.version } })
  await request(context, `/api/images/${encodeURIComponent(imageKey)}`, { method: 'DELETE' })
  await unlink(file)
  console.log(`removed: ${product?.code || imageKey} and ${basename(file)}`)
}

async function authenticate(baseUrl, dryRun) {
  if (process.env.AOV_ADMIN_TOKEN) return process.env.AOV_ADMIN_TOKEN
  const username = requiredEnv('AOV_ADMIN_USERNAME')
  const password = requiredEnv('AOV_ADMIN_PASSWORD')
  if (dryRun) return '<login token>'
  const response = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.token) throw new Error('Admin login failed.')
  return data.token
}
async function getProducts(context) { return (await request(context, '/api/admin/products', { method: 'GET', silent: true })).products || [] }
async function request(context, path, options = {}) {
  if (context.dryRun) return { batch: { id: '<batch>' }, items: [{ product: { id: '<product>', code: '<new>', version: 1, status: 'draft' } }] }
  const response = await fetch(`${context.baseUrl}${path}`, { method: options.method || 'GET', headers: { Authorization: `Bearer ${context.token}`, ...(options.headers || {}), ...(options.body !== undefined && !Buffer.isBuffer(options.body) ? { 'Content-Type': 'application/json' } : {}) }, body: options.body !== undefined && !Buffer.isBuffer(options.body) ? JSON.stringify(options.body) : options.body })
  const text = await response.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(typeof data === 'object' ? data.error || `HTTP ${response.status}` : `HTTP ${response.status}: ${data}`)
  if (!options.silent) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  return data
}
async function targetForCopy(libraryDir, category, source, hash) {
  if (await findHash(libraryDir, hash)) return null
  const target = join(libraryDir, category, basename(source))
  try { if (sha256Hex(await readFile(target)) === hash) return null } catch {}
  return target
}
async function copyIfNeeded(libraryDir, category, source, hash, target) {
  if (!target) return null
  await mkdir(join(libraryDir, category), { recursive: true })
  let destination = target
  try {
    if (sha256Hex(await readFile(destination)) === hash) return null
    destination = join(join(libraryDir, category), `${basename(target, extname(target))}-${hash.slice(0, 8)}${extname(target)}`)
  } catch {}
  await cp(source, destination, { errorOnExist: true })
  return destination
}
async function findHash(root, hash) {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) { const found = await findHash(path, hash); if (found) return found }
      else if (entry.isFile() && sha256Hex(await readFile(path)) === hash) return path
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return null
}
function printPlan(actions) { console.log(JSON.stringify({ dryRun: true, actions }, null, 2)) }
function numberFlag(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a non-negative integer.`); return number }
function requiredEnv(name) { if (!process.env[name]) throw new Error(`${name} must be provided through the environment.`); return process.env[name] }
function requiredFlag(flags, name) { if (!flags[name] || flags[name] === true) throw new Error(`--${name} is required`); return flags[name] }
function usage(exitCode) { console.log(`Usage: npm run library -- <add|remove> [options]\n\nadd:    --file PATH [--category NAME] [--price N] [--status available|draft] [--dry-run]\nremove: --file PATH [--dry-run]\n\nEnvironment: AOV_API_URL, AOV_LIBRARY_DIR (default: ${DEFAULT_LIBRARY_DIR}),\nAOV_ADMIN_TOKEN or AOV_ADMIN_USERNAME and AOV_ADMIN_PASSWORD.`); process.exit(exitCode) }

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1 })
