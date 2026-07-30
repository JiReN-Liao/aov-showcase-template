export const defaultSettings = {
  siteName: 'AOV Account Showcase',
  adminUsers: [],
  contactMethods: [
    { id: 'line', label: 'LINE', url: '' },
    { id: 'facebook', label: 'Facebook', url: '' },
    { id: 'instagram', label: 'Instagram', url: '' },
  ],
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.')
    error.code = data.code
    error.status = response.status
    throw error
  }
  return data
}

export function loadProducts() {
  return []
}

export function loadCloudCatalog() {
  return requestJson('/api/catalog')
}

export async function loginAdmin(username, password) {
  return requestJson('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function setupAdmin(username, password) {
  return requestJson('/api/admin/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export function listAdminCatalog(token) {
  return requestJson('/api/admin/catalog', { headers: { Authorization: `Bearer ${token}` } })
}

export function listSuppliers(token) {
  return requestJson('/api/admin/suppliers', { headers: { Authorization: `Bearer ${token}` } })
}

export function linkSyncItem(item, token) {
  return requestJson('/api/admin/sync/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(item),
  })
}

export function matchProductsByImageHashes(hashes, token) {
  return requestJson('/api/admin/products/match-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hashes }),
  })
}

export function matchProductsByImages(images, token) {
  return requestJson('/api/admin/products/match-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ images }),
  })
}

export function listVisualHashes(token) {
  return requestJson('/api/admin/images/visual-hashes', { headers: { Authorization: `Bearer ${token}` } })
}

export function saveVisualHashes(images, token) {
  return requestJson('/api/admin/images/visual-hashes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ images }),
  })
}

export async function hashImageFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createProducts(products, token) {
  return requestJson('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ products }),
  })
}

export function createUploadBatch(token, id = crypto.randomUUID()) {
  return requestJson('/api/admin/upload-batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  })
}

export function registerUploadItems(batchId, items, token) {
  return requestJson(`/api/admin/upload-batches/${encodeURIComponent(batchId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  })
}

export function getUploadBatch(batchId, token) {
  return requestJson(`/api/admin/upload-batches/${encodeURIComponent(batchId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function cancelUploadBatch(batchId, token) {
  return requestJson(`/api/admin/upload-batches/${encodeURIComponent(batchId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function recognizeImagePrice(imageKey, token) {
  return requestJson(`/api/admin/images/${encodeURIComponent(imageKey)}/recognize-price`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function recognizeUnpublishedPrices(token) {
  return requestJson('/api/admin/products/recognize-prices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateProduct(id, patch, version, token) {
  return requestJson(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(version) },
    body: JSON.stringify({ ...patch, expectedVersion: version }),
  })
}

export function updateProductStatus(id, status, version, token) {
  return requestJson(`/api/admin/products/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(version) },
    body: JSON.stringify({ status, expectedVersion: version }),
  })
}

export function softDeleteProduct(id, version, token) {
  return requestJson(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': String(version) },
    body: JSON.stringify({ expectedVersion: version }),
  })
}

export function saveAdminSettings(settings, adminUsers, token) {
  return requestJson('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      siteName: settings.siteName,
      contactMethods: settings.contactMethods,
      adminUsers,
    }),
  })
}

export function loadSettings() {
  return defaultSettings
}

const IMAGE_UPLOAD_TIMEOUT_MS = 45_000
const IMAGE_UPLOAD_RETRIES = 3

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? 0 : Math.max(0, date - now)
}

export function isRetryableUploadStatus(status) {
  return status === 408 || status === 429 || status >= 500
}

export async function putImage(imageKey, file, token, options = {}) {
  let attempt = 0
  while (true) {
    try {
      return await putImageOnce(imageKey, file, token, options)
    } catch (error) {
      if (error.name === 'AbortError' || attempt >= IMAGE_UPLOAD_RETRIES || !error.retryable) throw error
      const backoff = Math.min(8_000, 500 * (2 ** attempt))
      await waitForRetry(Math.max(backoff, error.retryAfter || 0), options.signal)
      attempt += 1
    }
  }
}

function putImageOnce(imageKey, file, token, options) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => options.signal?.removeEventListener('abort', abort)
    const fail = (error) => {
      cleanup()
      reject(error)
    }
    xhr.open('PUT', `/api/images/${encodeURIComponent(imageKey)}`)
    xhr.timeout = IMAGE_UPLOAD_TIMEOUT_MS
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (options.batchId) xhr.setRequestHeader('X-Upload-Batch', options.batchId)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      cleanup()
      let data = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data)
      const error = new Error(data.error || `Image upload failed (HTTP ${xhr.status}).`)
      error.code = data.code
      error.status = xhr.status
      error.retryable = isRetryableUploadStatus(xhr.status)
      error.retryAfter = retryAfterMs(xhr.getResponseHeader('Retry-After'))
      reject(error)
    }
    xhr.onerror = () => {
      const error = new Error('Image upload network error.')
      error.retryable = true
      fail(error)
    }
    xhr.ontimeout = () => {
      const error = new Error('Image upload timed out after 45 seconds.')
      error.status = 408
      error.retryable = true
      fail(error)
    }
    xhr.onabort = () => {
      const error = new Error('Image upload cancelled.')
      error.name = 'AbortError'
      fail(error)
    }
    if (options.signal?.aborted) return abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(file)
  })
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    let timer
    const abort = () => {
      window.clearTimeout(timer)
      const error = new Error('Image upload cancelled.')
      error.name = 'AbortError'
      reject(error)
    }
    const done = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    timer = window.setTimeout(done, delay)
  })
}

export function deleteImage(imageKey, token) {
  if (!imageKey) return Promise.resolve()
  return requestJson(`/api/images/${encodeURIComponent(imageKey)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
}

export function clearAllProducts(token) {
  return requestJson('/api/admin/products/clear', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
}

export function deleteProductsBatch(ids, token) {
  return requestJson('/api/admin/products/batch', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids }),
  })
}
