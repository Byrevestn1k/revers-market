import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;
export type DuplicateNotice = { existing: { id: string; categoryId: string }[]; message: string };

export async function categoryDuplicates(queryable: Queryable, kind: 'product' | 'buy_request', ownerId: string,
  title: string, description: string, categoryId: string, excludeId?: string): Promise<{ notice: DuplicateNotice | null; massAbuse: boolean }> {
  const table = kind === 'product' ? 'products' : 'buy_requests';
  const owner = kind === 'product' ? 'owner_id' : 'buyer_id';
  const active = kind === 'product' ? "status = 'active'" : "status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')";
  const rows = await queryable.query<{ id: string; category_id: string; exact: boolean }>(`SELECT id, category_id,
      lower(trim(title)) = lower(trim($2)) AND lower(trim(description)) = lower(trim($3)) AS exact FROM ${table}
    WHERE ${owner} = $1 AND (lower(trim(title)) = lower(trim($2)) OR similarity(title, $2) >= 0.92)
      AND (lower(trim(description)) = lower(trim($3)) OR similarity(description, $3) >= 0.9)
      AND category_id <> $4 AND ($5::uuid IS NULL OR id <> $5) AND ${active}
    ORDER BY (lower(trim(title)) = lower(trim($2)) AND lower(trim(description)) = lower(trim($3))) DESC, created_at DESC LIMIT 5`,
  [ownerId, title, description, categoryId, excludeId ?? null]);
  const existing = rows.rows.map(row => ({ id: row.id, categoryId: row.category_id }));
  return { notice: existing.length ? { existing, message: 'Схоже оголошення вже є в іншій категорії. Перевірте його перед публікацією.' } : null,
    massAbuse: rows.rows.filter(row => row.exact).length >= 3 };
}
