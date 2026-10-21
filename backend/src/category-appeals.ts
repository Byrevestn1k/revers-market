import type { AuthUser } from './auth.js';
import { pool } from './db/client.js';
import { assessCategory } from './category-recommendation.js';
import { isModerator } from './community-service.js';

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function createCategoryAppeal(user: AuthUser, input: Record<string, unknown>) {
  const { targetType, targetId, categoryId, title, description = '', comment = '' } = input;
  if (!['product', 'buy_request'].includes(String(targetType)) || typeof categoryId !== 'string' ||
      typeof title !== 'string' || title.trim().length < 2 || title.length > 160 ||
      typeof description !== 'string' || description.length > 5000 || typeof comment !== 'string' || comment.length > 2000 ||
      targetId !== undefined && (typeof targetId !== 'string' || !isUuid(targetId))) return { status: 400, body: { error: 'VALIDATION_ERROR' } };
  const category = await pool.query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [categoryId]);
  if (!category.rowCount) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } };
  if (targetId) {
    const table = targetType === 'product' ? 'products' : 'buy_requests';
    const owner = targetType === 'product' ? 'owner_id' : 'buyer_id';
    const owned = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND ${owner} = $2`, [targetId, user.id]);
    if (!owned.rowCount) return { status: 404, body: { error: 'LISTING_NOT_FOUND' } };
  }
  const assessment = await assessCategory({ title, description, categoryId });
  if (assessment.level !== 'block') return { status: 409, body: { error: 'CATEGORY_APPEAL_NOT_NEEDED' } };
  const result = await pool.query(`INSERT INTO category_appeals (user_id, target_type, target_id, category_id, title, description, comment)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id, status, created_at AS "createdAt"`,
  [user.id, targetType, targetId ?? null, categoryId, title.trim(), description, comment.trim()]);
  if (!result.rowCount) return { status: 409, body: { error: 'CATEGORY_APPEAL_EXISTS', message: 'Таке оскарження вже очікує розгляду.' } };
  return { status: 201, body: { appeal: result.rows[0] } };
}

export async function listCategoryAppeals(user: AuthUser) {
  if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } };
  const result = await pool.query(`SELECT id, user_id AS "userId", target_type AS "targetType", target_id AS "targetId",
    category_id AS "categoryId", title, description, comment, status, created_at AS "createdAt"
    FROM category_appeals WHERE status IN ('open', 'under_review') ORDER BY created_at DESC LIMIT 200`);
  return { status: 200, body: { appeals: result.rows } };
}

export async function updateCategoryAppeal(user: AuthUser, id: string, status: unknown) {
  if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } };
  if (!isUuid(id) || !['under_review', 'resolved', 'dismissed'].includes(String(status))) return { status: 400, body: { error: 'VALIDATION_ERROR' } };
  const result = await pool.query('UPDATE category_appeals SET status = $1 WHERE id = $2 RETURNING id, status', [status, id]);
  return result.rowCount ? { status: 200, body: { appeal: result.rows[0] } } : { status: 404, body: { error: 'CATEGORY_APPEAL_NOT_FOUND' } };
}
