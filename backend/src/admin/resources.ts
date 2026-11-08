import type { Request } from 'express';
import { pool } from '../db/client.js';

export const resources = {
  users: { permission: 'users.read', table: 'users', fields: 'id,username,created_at AS "createdAt",last_seen_at AS "lastSeenAt"', search: 'username' },
  products: { permission: 'products.read', table: 'products', fields: 'id,title,status,category_id AS "categoryId",created_at AS "createdAt"', search: 'title' },
  requests: { permission: 'requests.read', table: 'buy_requests', fields: 'id,title,status,category_id AS "categoryId",created_at AS "createdAt"', search: 'title' },
  offers: { permission: 'offers.read', table: 'offers', fields: 'id,status,buy_request_id AS "requestId",created_at AS "createdAt"', search: 'status' },
  deals: { permission: 'deals.read', table: 'orders', fields: 'id,status,buy_request_id AS "requestId",created_at AS "createdAt"', search: 'status' },
  moderation: { permission: 'moderation.read', table: 'reports', fields: `id,target_type AS "targetType",target_id AS "targetId",CASE WHEN reason='Неправильна категорія' THEN 'Неправильна категорія' ELSE 'Інша причина' END AS reason,status,created_at AS "createdAt"`, search: 'status' },
  audit: { permission: 'audit.read', table: 'audit_logs', fields: `id,actor_id AS "actorId",action,entity_type AS "entityType",entity_id AS "entityId",created_at AS "createdAt",metadata->>'result' AS result,metadata->>'reason' AS reason`, search: 'action' },
} as const;

export async function listResource(name: keyof typeof resources, request: Request) {
  const page = Number(request.query.page ?? 1), perPage = Number(request.query.perPage ?? 25);
  const q = request.query.q ?? '';
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100 || typeof q !== 'string' || q.length > 100) return null;
  const resource = resources[name];
  // Every interpolated identifier comes from the server-owned resource registry.
  const where = `WHERE ${resource.search} ILIKE $1 ${name === 'audit' ? "AND action LIKE 'admin.%'" : ''}`;
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout='3000ms'");
    const count = await db.query(`SELECT count(*)::int AS total FROM ${resource.table} ${where}`, [pattern]);
    const rows = await db.query(`SELECT ${resource.fields} FROM ${resource.table} ${where} ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`, [pattern, perPage, (page - 1) * perPage]);
    await db.query('COMMIT');
    return { data: rows.rows, total: count.rows[0].total };
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
