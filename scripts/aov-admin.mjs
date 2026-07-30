#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const [command, ...rawArgs] = process.argv.slice(2)
const { flags } = parseArgs(rawArgs)
const dryRun = Boolean(flags['dry-run'])
const baseUrl = requiredEnv('AOV_API_URL').replace(/\/$/, '')
const token = requiredEnv('AOV_ADMIN_TOKEN')

if (!command || command === 'help' || flags.help) usage(0)

try {
  if (command === 'list') {
    const path = flags.public ? '/api/catalog' : '/api/admin/products'
    await request(path, { method: 'GET' })
  } else if (command === 'create') {
    await request('/api/admin/products', { method: 'POST', body: productInput(flags, true) })
  } else if (command === 'patch' || command === 'update') {
    const id = requiredFlag(flags, 'id')
    await request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...productInput(flags, false), expectedVersion: await versionFor(id) } })
  } else if (command === 'status') {
    const id = requiredFlag(flags, 'id')
    await request(`/api/admin/products/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: requiredFlag(flags, 'status'), expectedVersion: await versionFor(id) } })
  } else if (command === 'delete') {
    const id = requiredFlag(flags, 'id')
    const imageKey = flags['delete-image']
    await request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', body: { expectedVersion: await versionFor(id) } })
    if (imageKey) await request(`/api/images/${encodeURIComponent(imageKey)}`, { method: 'DELETE' })
  } else if (command === 'upload') {
    const key = requiredFlag(flags, 'key')
    const file = requiredFlag(flags, 'file')
    const body = dryRun ? null : await readFile(file)
    await request(`/api/images/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': flags.type || contentType(file) },
      summary: { key, file: basename(file), ...(body ? { bytes: body.byteLength } : {}) },
    })
  } else {
    usage(1)
  }
} catch (caught) {
  console.error(`Error: ${caught.message}`)
  process.exitCode = 1
}

function productInput(input, creating) {
  const product = input.json ? JSON.parse(input.json) : {}
  for (const [flag, property] of Object.entries({ code: 'code', title: 'title', price: 'price', status: 'status', note: 'note', 'image-key': 'imageKey', 'sort-order': 'sortOrder', id: 'id' })) {
    if (input[flag] !== undefined) product[property] = input[flag]
  }
  if (creating && !product.code) throw new Error('--code or --json is required for create')
  return product
}

async function request(path, options) {
  const summary = { method: options.method, url: `${baseUrl}${path}`, ...(options.summary || {}), body: options.body }
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2))
    return
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}), ...(options.body && !Buffer.isBuffer(options.body) ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body && !Buffer.isBuffer(options.body) ? JSON.stringify(options.body) : options.body,
  })
  const text = await response.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error(typeof data === 'object' ? data.error || `HTTP ${response.status}` : `HTTP ${response.status}: ${data}`)
  if (!options.silent) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  return data
}

async function versionFor(id) {
  if (flags['expected-version']) return Number(flags['expected-version'])
  if (dryRun) throw new Error('--expected-version is required with --dry-run for update, status, and delete')
  const catalog = await request('/api/admin/products', { method: 'GET', silent: true })
  const product = catalog.products?.find((item) => item.id === id)
  if (!product) throw new Error(`Product ${id} was not found`)
  return product.version
}

function parseArgs(args) {
  const flags = {}
  const positionals = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const [name, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) flags[name] = inline
    else if (args[index + 1] && !args[index + 1].startsWith('--')) flags[name] = args[++index]
    else flags[name] = true
  }
  return { flags, positionals }
}

function requiredEnv(name) {
  if (!process.env[name]) throw new Error(`${name} must be provided through the environment.`)
  return process.env[name]
}

function requiredFlag(flags, name) {
  if (!flags[name] || flags[name] === true) throw new Error(`--${name} is required`)
  return flags[name]
}

function contentType(file) {
  const extension = file.split('.').pop().toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' })[extension] || 'application/octet-stream'
}

function usage(exitCode) {
  console.log(`Usage: npm run admin -- <command> [options]

Required environment: AOV_API_URL, AOV_ADMIN_TOKEN
Commands: list [--public], create, patch --id, status --id --status, delete --id [--delete-image key], upload --file --key
Product options: --code --title --price --status --note --image-key --sort-order --json '{...}'
Use --expected-version with dry-run updates; otherwise the CLI reads the current version automatically. Add --dry-run to print the request without sending it.`)
  process.exit(exitCode)
}
