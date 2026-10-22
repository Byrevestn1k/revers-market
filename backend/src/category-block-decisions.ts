import type { AuthUser } from './auth.js';
import type { CategoryAssessment } from './category-recommendation.js';
import { pool } from './db/client.js';

// Historical decision format is retained for existing appeals. Publishing routes do
// not call this module; a new automatic policy needs separate approval and testing.
export const CATEGORY_RULE_VERSION = 'step16-subject-relations-v3';

export async function categoryBlock(user: AuthUser, targetType: 'product' | 'buy_request', targetId: string | null,
  categoryId: string, title: string, description: string, assessment: CategoryAssessment) {
  const client = await pool.connect();
  let decisionId: string;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['category-block:' + user.id]);
    const values = [user.id, targetType, targetId, categoryId, title.trim(), description];
    const previous = await client.query<{ id: string }>(
      "SELECT id FROM category_block_decisions WHERE user_id = $1 AND target_type = $2 AND target_id IS NOT DISTINCT FROM $3::uuid AND category_id = $4 AND title = $5 AND description = $6 AND created_at > now() - interval '1 hour' ORDER BY created_at DESC LIMIT 1", values);
    if (previous.rowCount) decisionId = previous.rows[0].id;
    else {
      const recent = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM category_block_decisions WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [user.id]);
      if (Number(recent.rows[0].count) >= 60) {
        await client.query('ROLLBACK');
        return { status: 429, body: { error: 'CATEGORY_DECISION_RATE_LIMIT', message: 'Забагато відхилених спроб. Спробуйте пізніше.' } };
      }
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO category_block_decisions (user_id, target_type, target_id, category_id, title, description, reason, rules_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [...values, assessment.reason, CATEGORY_RULE_VERSION]);
      decisionId = inserted.rows[0].id;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  return { status: 422, body: {
    error: 'CATEGORY_MISMATCH', message: assessment.reason, suggestions: assessment.suggestions, decisionId,
    appeal: 'Уточніть назву або опис. Якщо категорія правильна, подайте оскарження на перевірку.',
  } };
}
