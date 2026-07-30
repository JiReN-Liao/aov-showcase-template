import { requireAdmin } from '../../../../_lib/auth.js'
import { errorResponse, json, readJson } from '../../../../_lib/http.js'
import { mapProduct } from '../../../../_lib/products.js'
import { MAX_BATCH_ITEMS, safeImageKey } from '../../../../_lib/uploads.js'

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const batchId = String(params.id || '')
  const batch = await env.DB.prepare("SELECT id FROM upload_batches WHERE id = ?1 AND created_by = ?2 AND status = 'active'").bind(batchId, auth.id).first()
  if (!batch) return errorResponse('Active upload batch not found.', 404, 'BATCH_NOT_FOUND')

  const body = await readJson(request)
  const inputs = Array.isArray(body.items) ? body.items : []
  if (!inputs.length || inputs.length > MAX_BATCH_ITEMS) return errorResponse(`Register 1 to ${MAX_BATCH_ITEMS} upload items per request.`, 400, 'INVALID_BATCH_ITEMS')

  const items = []
  for (const input of inputs) {
    const clientItemId = String(input?.clientItemId || '')
    const imageKey = safeImageKey(input?.imageKey)
    const contentType = String(input?.contentType || 'application/octet-stream').slice(0, 120)
    const size = Number(input?.size || 0)
    const sortOrder = Number(input?.sortOrder || 0)
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(clientItemId) || !imageKey || !contentType.startsWith('image/') || !Number.isInteger(size) || size <= 0 || !Number.isInteger(sortOrder) || sortOrder < 0) {
      return errorResponse('Each upload item needs a stable id, image metadata, and non-negative sort order.', 400, 'INVALID_BATCH_ITEM')
    }
    items.push({ clientItemId, imageKey, contentType, size, sortOrder })
  }
  if (new Set(items.map((item) => item.clientItemId)).size !== items.length || new Set(items.map((item) => item.imageKey)).size !== items.length) {
    return errorResponse('Upload item ids and image keys must be unique inside a request.', 400, 'DUPLICATE_BATCH_ITEM')
  }

  const itemPlaceholders = items.map((_, index) => `?${index + 2}`).join(', ')
  const existingResult = await env.DB.prepare(
    `SELECT products.*, image_objects.key AS object_key, image_objects.batch_item_id, image_objects.upload_status, image_objects.upload_error
     FROM image_objects
     JOIN products ON products.image_key = image_objects.key AND products.deleted_at IS NULL
     WHERE image_objects.batch_id = ?1 AND image_objects.batch_item_id IN (${itemPlaceholders})`,
  ).bind(batchId, ...items.map((item) => item.clientItemId)).all()
  const existingByItemId = new Map((existingResult.results || []).map((row) => [row.batch_item_id, row]))
  const entries = items.map((item) => ({ item, row: existingByItemId.get(item.clientItemId) || null }))
  const mismatched = entries.find(({ item, row }) => row && row.object_key !== item.imageKey)
  if (mismatched) return errorResponse('A batch item id cannot be reused with another image key.', 409, 'BATCH_ITEM_CONFLICT')
  const newEntries = entries.filter(({ row }) => !row)

  if (newEntries.length) {
    const keyPlaceholders = newEntries.map((_, index) => `?${index + 1}`).join(', ')
    const conflicts = await env.DB.prepare(
      `SELECT key FROM image_objects WHERE key IN (${keyPlaceholders})`,
    ).bind(...newEntries.map(({ item }) => item.imageKey)).all()
    if ((conflicts.results || []).length) return errorResponse('An image key is already registered.', 409, 'IMAGE_KEY_CONFLICT')
    const sequence = await env.DB.prepare("SELECT next_value FROM aov_sequences WHERE name = 'product'").first()
    if (!sequence) return errorResponse('Product sequence is unavailable.', 500, 'SEQUENCE_UNAVAILABLE')
    const start = Number(sequence.next_value)
    const now = new Date().toISOString()
    const statements = []
    newEntries.forEach(({ item }, index) => {
      const id = crypto.randomUUID()
      const code = `AOV-${String(start + index).padStart(3, '0')}`
      statements.push(env.DB.prepare(
        "INSERT INTO products (id, code, title, description, price, status, note, image_key, sort_order, created_at, updated_at, version) VALUES (?1, ?2, '', '', NULL, 'draft', '', ?3, ?4, ?5, ?5, 1)",
      ).bind(id, code, item.imageKey, item.sortOrder, now))
      statements.push(env.DB.prepare(
        "INSERT INTO image_objects (key, content_type, size, uploaded_by, created_at, batch_id, batch_item_id, upload_status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?5)",
      ).bind(item.imageKey, item.contentType, item.size, auth.id, now, batchId, item.clientItemId))
      entries[items.indexOf(item)].row = {
        id,
        code,
        title: '',
        description: '',
        price: null,
        status: 'draft',
        note: '',
        image_key: item.imageKey,
        sort_order: item.sortOrder,
        created_at: now,
        updated_at: now,
        version: 1,
        object_key: item.imageKey,
        upload_status: 'pending',
        upload_error: '',
      }
    })
    statements.push(env.DB.prepare("UPDATE aov_sequences SET next_value = ?1 WHERE name = 'product' AND next_value = ?2").bind(start + newEntries.length, start))
    try {
      const results = await env.DB.batch(statements)
      if (Number(results.at(-1)?.meta?.changes || 0) !== 1) return errorResponse('Product sequence changed. Retry this chunk.', 409, 'SEQUENCE_CONFLICT')
    } catch {
      return errorResponse('Could not register this upload chunk. Retry it with the same item ids.', 409, 'BATCH_ITEM_CONFLICT')
    }
  }

  return json({
    items: entries.map(({ item, row }) => ({
      clientItemId: item.clientItemId,
      imageKey: row.image_key || row.object_key,
      imageStatus: row.upload_status,
      error: row.upload_error || '',
      product: mapProduct({ ...row, image_key: row.image_key || row.object_key }),
    })),
  }, { status: 201 })
}
