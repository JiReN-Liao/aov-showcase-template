export function auditStatement({ actorId, action, entityType, entityId, versionBefore = null, versionAfter = null, metadata = {} }) {
  return {
    actorId,
    action,
    entityType,
    entityId,
    versionBefore,
    versionAfter,
    metadataJson: JSON.stringify(metadata),
  }
}

export async function writeAudit(env, entry) {
  await env.DB.prepare(
    'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, version_before, version_after, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
  ).bind(
    crypto.randomUUID(),
    entry.actorId || null,
    entry.action,
    entry.entityType,
    entry.entityId || null,
    entry.versionBefore ?? null,
    entry.versionAfter ?? null,
    JSON.stringify(entry.metadata || {}),
    new Date().toISOString(),
  ).run()
}
