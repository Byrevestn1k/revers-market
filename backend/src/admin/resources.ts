import type { Request } from 'express';
import { pool } from '../db/client.js';
import { uuid } from './grants.js';
import { regionCondition } from '../map-service.js';
import { settlementCodesInRegion } from '../settlements.js';

export const resources = {
  users: { permission: 'users.read', table: 'users', fields: 'id,username,nickname,restricted_until AS "restrictedUntil",moderation_version AS version,created_at AS "createdAt",last_seen_at AS "lastSeenAt"', search: 'username' },
  products: { permission: 'products.read', table: 'products', fields: 'id,title,status,moderation_hidden AS hidden,moderation_version AS version,category_id AS "categoryId",created_at AS "createdAt"', search: 'title' },
  requests: { permission: 'requests.read', table: 'buy_requests', fields: 'id,title,status,moderation_hidden AS hidden,moderation_version AS version,category_id AS "categoryId",created_at AS "createdAt"', search: 'title' },
  offers: { permission: 'offers.read', table: 'offers', fields: 'id,status,buy_request_id AS "requestId",created_at AS "createdAt"', search: 'status' },
  deals: { permission: 'deals.read', table: 'orders', fields: 'id,status,buy_request_id AS "requestId",created_at AS "createdAt"', search: 'status' },
  moderation: { permission: 'moderation.read', table: 'reports', fields: `id,moderation_version AS version,target_type AS "targetType",target_id AS "targetId",CASE WHEN reason='Неправильна категорія' THEN 'Неправильна категорія' ELSE 'Інша причина' END AS reason,status,created_at AS "createdAt"`, search: 'status' },
  audit: { permission: 'audit.read', table: 'audit_logs', fields: `id,actor_id AS "actorId",action,entity_type AS "entityType",entity_id AS "entityId",created_at AS "createdAt",metadata->>'result' AS result,metadata->>'reason' AS reason`, search: 'action' },
} as const;

export async function listResource(name: keyof typeof resources, request: Request) {
  const page = Number(request.query.page ?? 1), perPage = Number(request.query.perPage ?? 25);
  const q = request.query.q ?? '';
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100 || typeof q !== 'string' || q.length > 100) return null;
  const resource = resources[name];
  // Every interpolated identifier comes from the server-owned resource registry.
  const params: unknown[] = [`%${q.replace(/[\\%_]/g, '\\$&')}%`];
  const clauses = [`(${resource.search} ILIKE $1 OR id::text=$2${name === 'users' ? ' OR nickname ILIKE $1' : ''})`];
  params.push(q);
  if (name === 'audit') clauses.push("(action LIKE 'admin.%' OR action='report.moderated')");
  const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replace('?', `$${params.length}`)); };
  const filters = request.query;
  for (const key of ['status', 'categoryId', 'authorId', 'targetType', 'targetId', 'entityId', 'reason', 'role', 'activity', 'visibility', 'from', 'to', 'region']) {
    const value = filters[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 100) return null;
    if (['categoryId', 'authorId', 'targetId', 'entityId'].includes(key) && !uuid(value)) return null;
    if (key === 'from' || key === 'to') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) return null;
      add(`created_at ${key === 'from' ? '>=' : '<'} ?::timestamptz`, value);
    } else if (key === 'status' && name === 'users') {
      if (!['restricted', 'active'].includes(value)) return null;
      clauses.push(value === 'restricted' ? 'restricted_until > now()' : '(restricted_until IS NULL OR restricted_until<=now())');
    } else if (key === 'status' && ['products','requests','moderation','offers','deals'].includes(name)) add('status=?', value);
    else if (key === 'categoryId' && ['products','requests'].includes(name)) add('category_id=?', value);
    else if (key === 'authorId' && ['products','requests'].includes(name)) add(`${name === 'products' ? 'owner_id' : 'buyer_id'}=?`, value);
    else if (key === 'region' && ['products','requests'].includes(name)) {
      if (!settlementCodesInRegion(value).length) return null;
      clauses.push(regionCondition('settlement_code', name === 'products' ? 'geo_zone' : 'geo_area', value, params));
    } else if (key === 'visibility' && ['products','requests'].includes(name)) {
      if (!['hidden','visible'].includes(value)) return null;
      clauses.push(`moderation_hidden=${value === 'hidden'}`);
    } else if (key === 'role' && name === 'users') add('EXISTS (SELECT 1 FROM admin_user_roles g WHERE g.user_id=users.id AND g.role_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()))', value);
    else if (key === 'activity' && name === 'users') {
      if (!['recent','inactive'].includes(value)) return null;
      clauses.push(value === 'recent' ? "last_seen_at>now()-interval '30 days'" : "(last_seen_at IS NULL OR last_seen_at<=now()-interval '30 days')");
    } else if (key === 'targetType' && name === 'moderation') add('target_type=?', value);
    else if (key === 'targetId' && name === 'moderation') add('target_id=?', value);
    else if (key === 'entityId' && name === 'audit') add('entity_id=?', value);
    else if (key === 'reason' && name === 'moderation') {
      if (!['category','other'].includes(value)) return null;
      clauses.push(`reason ${value === 'category' ? '=' : '<>'} 'Неправильна категорія'`);
    } else return null;
  }
  const sortFields: Record<string,string> = { createdAt: 'created_at', id: 'id' };
  if (name === 'users') { sortFields.username = 'username'; sortFields.lastSeenAt = 'last_seen_at'; }
  if (['products','requests'].includes(name)) sortFields.title = 'title';
  const sort = typeof filters.sort === 'string' ? sortFields[filters.sort] : 'created_at';
  const order = filters.order ?? 'DESC';
  if (!sort || !['ASC','DESC'].includes(String(order))) return null;
  const where = `WHERE ${clauses.join(' AND ')}`;
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout='3000ms'");
    const count = await db.query(`SELECT count(*)::int AS total FROM ${resource.table} ${where}`, params);
    const rows = await db.query(`SELECT ${resource.fields} FROM ${resource.table} ${where} ORDER BY ${sort} ${order} NULLS LAST,id LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, perPage, (page - 1) * perPage]);
    await db.query('COMMIT');
    return { data: rows.rows, total: count.rows[0].total };
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}


export async function resourceDetail(name: keyof typeof resources, id: string) {
  if (!uuid(id)) return null;
  const resource = resources[name];
  const result = await pool.query(`SELECT ${resource.fields} FROM ${resource.table} WHERE id=$1 ${name === 'audit' ? "AND (action LIKE 'admin.%' OR action='report.moderated')" : ''}`, [id]);
  if (!result.rowCount) return null;
  const data = result.rows[0];
  if (name === 'users') {
    const profile = await pool.query('SELECT bio,country_code AS "countryCode" FROM users WHERE id=$1', [id]);
    Object.assign(data, profile.rows[0]);
    const counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM products WHERE owner_id=$1) AS products,
      (SELECT count(*)::int FROM buy_requests WHERE buyer_id=$1) AS requests,
      (SELECT count(*)::int FROM offers WHERE seller_id=$1) AS offers,
      (SELECT count(*)::int FROM orders WHERE buyer_id=$1 OR seller_id=$1) AS deals,
      (SELECT count(*)::int FROM reports WHERE target_type='user' AND target_id=$1) AS reports`, [id]);
    data.counts = counts.rows[0];
  }
  if (name === 'products' || name === 'requests') {
    const detail = await pool.query(`SELECT description,unit,currency,
      ${name === 'products' ? 'quantity,price' : 'requested_quantity AS quantity,min_unit_price AS "minPrice",max_unit_price AS "maxPrice"'},
      (SELECT name FROM categories WHERE id=${resource.table}.category_id) AS "categoryName",${name === 'products' ? 'owner_id' : 'buyer_id'} AS "authorId" FROM ${resource.table} WHERE id=$1`, [id]);
    Object.assign(data, detail.rows[0]);
  }
  const entity = ({ users: 'user', products: 'product', requests: 'buy_request', moderation: 'report' } as Record<string,string>)[name];
  if (entity) {
    const history = await pool.query(`SELECT id,actor_id AS "actorId",action,created_at AS "createdAt",metadata->>'reason' AS reason,metadata->>'result' AS result
      FROM audit_logs WHERE entity_type=$1 AND entity_id=$2 AND (action LIKE 'admin.%' OR action='report.moderated') ORDER BY created_at DESC,id LIMIT 100`, [entity,id]);
    data.history = history.rows;
  }
  return { data };
}
