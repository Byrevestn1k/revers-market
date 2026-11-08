import type { RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';

export type AdminAccess = { roles: string[]; permissions: string[] };
declare global { namespace Express { interface Request { adminAccess?: AdminAccess } } }

export async function getAdminAccess(userId: string, db: Pick<PoolClient, 'query'> = pool): Promise<AdminAccess> {
  const result = await db.query(`SELECT DISTINCT g.role_id, p.permission_id
    FROM admin_user_roles g JOIN admin_role_permissions p ON p.role_id=g.role_id
    WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())`, [userId]);
  return { roles: [...new Set(result.rows.map(r => r.role_id as string))], permissions: [...new Set(result.rows.map(r => r.permission_id as string))] };
}

export const loadAdminAccess: RequestHandler = async (request, response, next) => {
  try {
    const access = await getAdminAccess(request.authUser!.id);
    if (!access.permissions.includes('admin.access')) { response.status(403).json({ error: 'ADMIN_FORBIDDEN', message: 'Адміністративний доступ не надано' }); return; }
    request.adminAccess = access;
    response.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
};

export const requirePermission = (permission: string): RequestHandler => (request, response, next) => {
  if (!request.adminAccess?.permissions.includes(permission)) { response.status(403).json({ error: 'PERMISSION_DENIED', message: 'Недостатньо прав' }); return; }
  next();
};

export const mutationProtection: RequestHandler = async (request, response, next) => {
  try {
    const origin = request.get('Origin');
    const expected = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173').origin;
    if (origin !== expected || request.get('X-Admin-Action') !== '1' || !request.is('application/json')) {
      response.status(403).json({ error: 'ADMIN_CSRF_REJECTED' }); return;
    }
    const session = await pool.query(`SELECT 1 FROM user_sessions WHERE id=$1 AND user_id=$2
      AND revoked_at IS NULL AND expires_at > now() AND created_at > now()-interval '1 hour'`, [request.authSessionId, request.authUser!.id]);
    if (!session.rowCount) { response.status(401).json({ error: 'ADMIN_REAUTH_REQUIRED', message: 'Для цієї дії увійдіть повторно' }); return; }
    next();
  } catch (error) { next(error); }
};
