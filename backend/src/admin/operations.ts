import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { pool } from '../db/client.js';
import { getAdminAccess } from './access.js';
import { uuid } from './grants.js';

// Shared by admin clients; public-site buttons can call the same guarded endpoint.
export const operations = {
  users: { table: 'users', permission: 'users.restrict', actions: ['restrict', 'unrestrict'], entity: 'user' },
  products: { table: 'products', permission: 'products.moderate', actions: ['hide', 'restore'], entity: 'product' },
  requests: { table: 'buy_requests', permission: 'requests.moderate', actions: ['hide', 'restore'], entity: 'buy_request' },
  moderation: { table: 'reports', permission: 'moderation.decide', actions: ['under_review', 'resolved', 'dismissed', 'open'], entity: 'report' },
} as const;
export const decisionReasons = ['policy_violation', 'spam', 'fraud_risk', 'review_completed', 'mistake_corrected', 'insufficient_evidence'] as const;
const failure = (status: number, error: string) => ({ status, body: { error, message: status === 409 ? 'Дані змінилися. Оновіть сторінку й перевірте рішення.' : 'Дію не виконано. Перевірте права та параметри.' } });

export async function applyOperation(name: keyof typeof operations, request: Request) {
  const config = operations[name], actor = request.authUser!.id, id = String(request.params.id);
  const { action, reason, version, requestKey, until } = request.body ?? {};
  if (!uuid(id) || !uuid(requestKey) || !Number.isInteger(version) || version < 0 || !config.actions.some(a => a === action) || !decisionReasons.some(r => r === reason)) return failure(400, 'INVALID_DECISION');
  const expiry = action === 'restrict' && typeof until === 'string' ? new Date(until) : null;
  if (action === 'restrict' && (!expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now() || expiry.getTime() > Date.now() + 30 * 86400000)) return failure(400, 'INVALID_RESTRICTION_EXPIRY');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Same lock as grant writes: permission revocation cannot race this decision.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('admin-grants'))");
    const access = await getAdminAccess(actor, db);
    const active = await db.query('SELECT 1 FROM users WHERE id=$1 AND (restricted_until IS NULL OR restricted_until<=now())', [actor]);
    if (!active.rowCount || !access.permissions.includes('admin.access') || !access.permissions.includes(config.permission)) { await db.query('ROLLBACK'); return failure(403, 'PERMISSION_DENIED'); }
    const previous = await db.query("SELECT entity_id,entity_type,metadata FROM audit_logs WHERE actor_id=$1 AND metadata->>'requestKey'=$2 AND action LIKE 'admin.%'", [actor, requestKey]);
    const fingerprint = JSON.stringify({ name, id, action, reason, version, until: expiry?.toISOString() ?? null });
    if (previous.rowCount) {
      await db.query('ROLLBACK');
      return previous.rows[0].metadata.fingerprint === fingerprint ? { status: 200, body: { data: previous.rows[0].metadata.response } } : failure(409, 'REQUEST_KEY_REUSED');
    }
    const found = await db.query(`SELECT moderation_version,${name === 'users' ? 'restricted_until' : name === 'moderation' ? 'status' : 'moderation_hidden'} FROM ${config.table} WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.rowCount) { await db.query('ROLLBACK'); return failure(404, 'OBJECT_NOT_FOUND'); }
    const before = found.rows[0];
    if (before.moderation_version !== version) { await db.query('ROLLBACK'); return failure(409, 'DECISION_CONFLICT'); }
    if (name === 'users') {
      const targetAccess = await getAdminAccess(id, db);
      if (id === actor || targetAccess.permissions.includes('admin.access')) { await db.query('ROLLBACK'); return failure(403, 'PROTECTED_USER'); }
      await db.query('UPDATE users SET restricted_until=$2,moderation_version=moderation_version+1 WHERE id=$1', [id, action === 'restrict' ? expiry : null]);
    } else if (name === 'moderation') {
      await db.query('UPDATE reports SET status=$2,moderator_id=$3,moderation_note=$4,updated_at=now(),moderation_version=moderation_version+1 WHERE id=$1', [id, action, actor, reason]);
    } else {
      await db.query(`UPDATE ${config.table} SET moderation_hidden=$2,moderation_version=moderation_version+1 WHERE id=$1`, [id, action === 'hide']);
    }
    const decisionId = randomUUID();
    const data = { id, version: version + 1, action, decisionId };
    await db.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,id) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [actor, `admin.${name}.${action}`, config.entity, id, JSON.stringify({ reason, result: 'success', before, after: { action, until: expiry?.toISOString() ?? null }, requestKey, fingerprint, response: data }), decisionId]);
    await db.query('COMMIT');
    return { status: 200, body: { data } };
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
