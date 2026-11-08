import type { Request } from 'express';
import { pool } from '../db/client.js';
import { getAdminAccess } from './access.js';

export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const reasons = ['access_assignment', 'access_review', 'incident_response'];

export async function changeGrant(request: Request, revoke = false) {
  const actor = request.authUser!.id;
  const { userId, roleId, reason, expiresAt } = request.body ?? {};
  const id = String(request.params.id ?? '');
  if (!reasons.includes(reason) || (revoke ? !uuid(id) : !uuid(userId) || typeof roleId !== 'string' || roleId === 'super_admin' || roleId.length > 80)) return { status: 400, body: { error: 'INVALID_GRANT' } };
  const expiry = expiresAt === undefined || expiresAt === null ? null : new Date(expiresAt);
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) return { status: 400, body: { error: 'INVALID_EXPIRY' } };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize grant mutations and recheck authorization inside the transaction.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('admin-grants'))");
    const access = await getAdminAccess(actor, db);
    if (!access.permissions.includes('roles.manage')) { await db.query('ROLLBACK'); return { status: 403, body: { error: 'PERMISSION_DENIED' } }; }
    let grant;
    if (revoke) {
      const existing = await db.query('SELECT * FROM admin_user_roles WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [id]);
      grant = existing.rows[0];
      if (!grant) { await db.query('ROLLBACK'); return { status: 404, body: { error: 'GRANT_NOT_FOUND' } }; }
      if (grant.user_id === actor || grant.role_id === 'super_admin') { await db.query('ROLLBACK'); return { status: 403, body: { error: 'PROTECTED_GRANT' } }; }
      await db.query('UPDATE admin_user_roles SET revoked_at=now() WHERE id=$1', [id]);
    } else {
      if (userId === actor) { await db.query('ROLLBACK'); return { status: 403, body: { error: 'SELF_GRANT_FORBIDDEN' } }; }
      const role = await db.query('SELECT id FROM admin_roles WHERE id=$1', [roleId]);
      const target = await db.query('SELECT id FROM users WHERE id=$1', [userId]);
      if (!role.rowCount || !target.rowCount) { await db.query('ROLLBACK'); return { status: 404, body: { error: 'GRANT_TARGET_NOT_FOUND' } }; }
      // Custom roles cannot grant role-management authority through this endpoint.
      const elevated = await db.query("SELECT 1 FROM admin_role_permissions WHERE role_id=$1 AND permission_id='roles.manage'", [roleId]);
      if (elevated.rowCount) { await db.query('ROLLBACK'); return { status: 403, body: { error: 'PROTECTED_GRANT' } }; }
      await db.query('UPDATE admin_user_roles SET revoked_at=now() WHERE user_id=$1 AND role_id=$2 AND revoked_at IS NULL AND expires_at <= now()', [userId, roleId]);
      const result = await db.query('INSERT INTO admin_user_roles(user_id,role_id,granted_by,expires_at) VALUES($1,$2,$3,$4) RETURNING *', [userId, roleId, actor, expiry]);
      grant = result.rows[0];
    }
    await db.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'admin_grant',$3,$4::jsonb)`, [actor, revoke ? 'admin.grant_revoked' : 'admin.grant_created', grant.id, JSON.stringify({ reason, result: 'success', userId: grant.user_id, roleId: grant.role_id })]);
    await db.query('COMMIT');
    return { status: 200, body: { data: { id: grant.id, userId: grant.user_id, roleId: grant.role_id, expiresAt: grant.expires_at, revoked: revoke } } };
  } catch (error) {
    await db.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return { status: 409, body: { error: 'GRANT_ALREADY_EXISTS' } };
    throw error;
  } finally { db.release(); }
}
