import { requireAdmin } from '../../../_lib/auth.js'
import { findUniqueVisualMatch, normalizeImageRequests, normalizeRequestedHashes } from '../../../_lib/image-matching.js'
import { errorResponse, json, readJson } from '../../../_lib/http.js'
import { mapProduct } from '../../../_lib/products.js'

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env)
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  const images = normalizeImageRequests(body.images)
  const hashes = images.length ? images.map((image) => image.hash) : normalizeRequestedHashes(body.hashes)
  if (!hashes.length) return errorResponse('Provide 1 to 50 valid SHA-256 hashes.', 400, 'INVALID_IMAGE_HASHES')

  const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',')
  const rows = (await env.DB.prepare(
    `SELECT products.*, COALESCE(sync_items.content_hash, image_objects.content_hash) AS match_hash
     FROM products
     JOIN image_objects ON image_objects.key = products.image_key
       AND image_objects.deleted_at IS NULL AND image_objects.upload_status = 'ready'
     LEFT JOIN sync_items ON sync_items.product_id = products.id AND sync_items.deleted_at IS NULL
     WHERE products.deleted_at IS NULL
       AND (sync_items.content_hash IN (${placeholders}) OR image_objects.content_hash IN (${placeholders}))
     ORDER BY products.code`,
  ).bind(...hashes).all()).results || []

  const matches = rows.map((row) => ({ hash: row.match_hash, matchType: 'exact', distance: 0, product: mapProduct(row) }))
  const matchedHashes = new Set(matches.map((match) => match.hash))
  const unmatchedImages = images.filter((image) => !matchedHashes.has(image.hash) && image.visualHash)
  const visualRows = unmatchedImages.length ? (await env.DB.prepare(
    `SELECT products.*, image_objects.visual_hash
     FROM products JOIN image_objects ON image_objects.key = products.image_key
     WHERE products.deleted_at IS NULL AND image_objects.deleted_at IS NULL
       AND image_objects.upload_status = 'ready' AND image_objects.visual_hash IS NOT NULL`,
  ).all()).results || [] : []
  const ambiguous = []
  for (const image of unmatchedImages) {
    const result = findUniqueVisualMatch(image.visualHash, visualRows.map((row) => ({ row, visualHash: row.visual_hash })))
    if (result.match) {
      matches.push({
        hash: image.hash,
        matchType: 'visual',
        distance: result.distance,
        similarity: Math.round((1 - result.distance / 64) * 100),
        product: mapProduct(result.match.row),
      })
      matchedHashes.add(image.hash)
    } else if (result.ambiguous) {
      ambiguous.push(image.hash)
    }
  }
  return json({ matches, ambiguous, unmatched: hashes.filter((hash) => !matchedHashes.has(hash) && !ambiguous.includes(hash)) })
}
