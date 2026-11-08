import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../auth.js';
import { pool } from '../db/client.js';
import { createSearchRateLimiter } from '../search-rate-limit.js';
import { loadAdminAccess, mutationProtection, requirePermission } from './access.js';
import { dashboard, parsePeriod } from './metrics.js';
import { listResource, resources, resourceDetail } from './resources.js';
import { operations, applyOperation } from './operations.js';
import { changeGrant, uuid } from './grants.js';

const handle = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

export function adminRouter() {
  const router = Router();
  router.use(createSearchRateLimiter({ all: true, max: 90 }), requireAuth, loadAdminAccess);
  router.get('/session', (request, response) => response.json({ user: { id: request.authUser!.id, username: request.authUser!.username }, ...request.adminAccess }));
  router.get('/dashboard', requirePermission('analytics.read'), handle(async (request, response) => {
    const period = parsePeriod(request.query.from, request.query.to);
    if (!period) { response.status(400).json({ error: 'INVALID_PERIOD', message: 'Період має тривати від 1 мс до 93 днів' }); return; }
    response.json(await dashboard(period));
  }));
  for (const name of Object.keys(resources) as (keyof typeof resources)[]) {
    router.get(`/${name}`, requirePermission(resources[name].permission), handle(async (request, response) => {
      const result = await listResource(name, request);
      if (!result) { response.status(400).json({ error: 'INVALID_PAGINATION' }); return; }
      response.json(result);
    }));
  }
  for (const name of Object.keys(resources) as (keyof typeof resources)[]) {
    router.get(`/${name}/:id`, requirePermission(resources[name].permission), handle(async (request, response) => {
      const result = await resourceDetail(name, String(request.params.id));
      response.status(result ? 200 : 404).json(result ?? { error: 'OBJECT_NOT_FOUND' });
    }));
  }
  for (const name of Object.keys(operations) as (keyof typeof operations)[]) {
    router.post(`/${name}/:id/actions`, requirePermission(operations[name].permission), mutationProtection, handle(async (request, response) => {
      const result = await applyOperation(name, request); response.status(result.status).json(result.body);
    }));
  }
  router.get('/roles', requirePermission('roles.read'), handle(async (_request, response) => {
    const roles = await pool.query(`SELECT r.id,r.label,array_agg(p.permission_id ORDER BY p.permission_id) AS permissions FROM admin_roles r
      JOIN admin_role_permissions p ON p.role_id=r.id GROUP BY r.id ORDER BY r.id`);
    const permissions = await pool.query('SELECT id FROM admin_permissions ORDER BY id');
    response.json({ data: roles.rows, permissions: permissions.rows.map(r => r.id) });
  }));
  router.get('/grants', requirePermission('roles.read'), handle(async (request, response) => {
    if (!uuid(request.query.userId)) { response.status(400).json({ error: 'USER_ID_REQUIRED' }); return; }
    const result = await pool.query(`SELECT id,user_id AS "userId",role_id AS "roleId",created_at AS "createdAt",expires_at AS "expiresAt"
      FROM admin_user_roles WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 100`, [request.query.userId]);
    response.json({ data: result.rows });
  }));
  router.post('/grants', requirePermission('roles.manage'), mutationProtection, handle(async (request, response) => {
    const result = await changeGrant(request); response.status(result.status).json(result.body);
  }));
  router.delete('/grants/:id', requirePermission('roles.manage'), mutationProtection, handle(async (request, response) => {
    const result = await changeGrant(request, true); response.status(result.status).json(result.body);
  }));
  // Unknown exports/mutations never fall through to a public route.
  router.use((_request, response) => response.status(404).json({ error: 'ADMIN_ENDPOINT_NOT_FOUND' }));
  return router;
}
