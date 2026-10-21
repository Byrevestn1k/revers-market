import type { AuthUser } from './auth.js';
import { pool } from './db/client.js';
import { isModerator } from './community-service.js';

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function createCategoryAppeal(user: AuthUser, input: Record<string, unknown>) {
  const { decisionId, comment = '' } = input;
  if (typeof decisionId !== 'string' || !isUuid(decisionId) || typeof comment !== 'string' || comment.length > 2000)
    return { status: 400, body: { error: 'VALIDATION_ERROR' } };
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const decision = await client.query(
      'SELECT id, target_type, target_id, category_id, title, description, status FROM category_block_decisions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [decisionId, user.id]);
    if (!decision.rowCount) return { status: 404, body: { error: 'CATEGORY_DECISION_NOT_FOUND' } };
    if (decision.rows[0].status !== 'blocked') return { status: 409, body: { error: 'CATEGORY_APPEAL_EXISTS', message: 'Це рішення вже оскаржено або розглянуто.' } };
    const row = decision.rows[0];
    const result = await client.query(
      'INSERT INTO category_appeals (user_id, target_type, target_id, category_id, title, description, comment, decision_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id, status, created_at AS "createdAt"',
      [user.id, row.target_type, row.target_id, row.category_id, row.title, row.description, comment.trim(), decisionId]);
    if (!result.rowCount) return { status: 409, body: { error: 'CATEGORY_APPEAL_EXISTS', message: 'Таке оскарження вже очікує розгляду.' } };
    await client.query("UPDATE category_block_decisions SET status = 'appealed' WHERE id = $1", [decisionId]);
    await client.query('COMMIT');
    committed = true;
    return { status: 201, body: { appeal: { ...result.rows[0], decisionId } } };
  } finally {
    if (!committed) await client.query('ROLLBACK');
    client.release();
  }
}

export async function listCategoryAppeals(user: AuthUser) {
  if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } };
  const result = await pool.query(
    'SELECT a.id, a.user_id AS "userId", a.target_type AS "targetType", a.target_id AS "targetId", a.category_id AS "categoryId", a.title, a.description, a.comment, a.status, a.created_at AS "createdAt", a.decision_id AS "decisionId", d.reason AS "blockReason", d.rules_version AS "rulesVersion" FROM category_appeals a LEFT JOIN category_block_decisions d ON d.id = a.decision_id WHERE a.status IN (\'open\', \'under_review\') ORDER BY a.created_at DESC LIMIT 200');
  return { status: 200, body: { appeals: result.rows } };
}

export async function updateCategoryAppeal(user: AuthUser, id: string, status: unknown) {
  if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } };
  if (!isUuid(id) || !['under_review', 'resolved', 'dismissed'].includes(String(status))) return { status: 400, body: { error: 'VALIDATION_ERROR' } };
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; status: string; decision_id: string | null }>(
      'UPDATE category_appeals SET status = $1 WHERE id = $2 RETURNING id, status, decision_id', [status, id]);
    if (!result.rowCount) return { status: 404, body: { error: 'CATEGORY_APPEAL_NOT_FOUND' } };
    if (result.rows[0].decision_id) await client.query('UPDATE category_block_decisions SET status = $1 WHERE id = $2',
      [status === 'under_review' ? 'appealed' : status, result.rows[0].decision_id]);
    await client.query('COMMIT');
    committed = true;
    return { status: 200, body: { appeal: { id: result.rows[0].id, status: result.rows[0].status } } };
  } finally {
    if (!committed) await client.query('ROLLBACK');
    client.release();
  }
}
