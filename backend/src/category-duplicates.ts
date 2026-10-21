import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;
export type DuplicateNotice = { existing: { id: string; categoryId: string }[]; message: string };

export async function categoryDuplicates(queryable: Queryable, kind: 'product' | 'buy_request', ownerId: string,
  title: string, description: string, categoryId: string, excludeId?: string): Promise<{ notice: DuplicateNotice | null; massAbuse: boolean }> {
  const table = kind === 'product' ? 'products' : 'buy_requests';
  const owner = kind === 'product' ? 'owner_id' : 'buyer_id';
  const active = kind === 'product' ? "status = 'active'" : "status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')";
  const canonicalTitle = "btrim(regexp_replace(lower(title), '[[:punct:][:space:]]+', ' ', 'g'))";
  const canonicalDescription = "btrim(regexp_replace(lower(description), '[[:punct:][:space:]]+', ' ', 'g'))";
  const inputTitle = "btrim(regexp_replace(lower($2), '[[:punct:][:space:]]+', ' ', 'g'))";
  const inputDescription = "btrim(regexp_replace(lower($3), '[[:punct:][:space:]]+', ' ', 'g'))";
  const rows = await queryable.query<{ id: string; category_id: string; exact: boolean }>(`SELECT id, category_id,
      ${canonicalTitle} = ${inputTitle} AND ${canonicalDescription} = ${inputDescription} AS exact FROM ${table}
    WHERE ${owner} = $1 AND (${canonicalTitle} = ${inputTitle} OR similarity(title, $2) >= 0.92)
      AND (${canonicalDescription} = ${inputDescription} OR similarity(description, $3) >= 0.9)
      AND category_id <> $4 AND ($5::uuid IS NULL OR id <> $5) AND ${active}
    ORDER BY (${canonicalTitle} = ${inputTitle} AND ${canonicalDescription} = ${inputDescription}) DESC, created_at DESC LIMIT 5`,
  [ownerId, title, description, categoryId, excludeId ?? null]);
  const existing = rows.rows.map(row => ({ id: row.id, categoryId: row.category_id }));
  return { notice: existing.length ? { existing, message: 'Схоже оголошення вже є в іншій категорії. Перевірте його перед публікацією.' } : null,
    massAbuse: rows.rows.filter(row => row.exact).length >= 3 };
}
