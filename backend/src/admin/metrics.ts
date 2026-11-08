import { pool } from '../db/client.js';

export const metricDefinitions = [
  { id: 'users', label: 'Нові реєстрації', description: 'Наявні користувачі, створені в обраному періоді.' },
  { id: 'products', label: 'Створені товари', description: 'Наявні товари, створені в обраному періоді. Товар не дорівнює угоді.' },
  { id: 'requests', label: 'Створені запити', description: 'Наявні Buy Request, створені в обраному періоді.' },
  { id: 'offers', label: 'Створені пропозиції', description: 'Наявні Seller Offer, створені в обраному періоді.' },
  { id: 'deals', label: 'Створені угоди', description: 'Наявні Deal, створені в обраному періоді; часткові угоди рахуються окремо.' },
  { id: 'requestResponseRate', label: 'Запити з відповіддю, %', unit: '%', description: '100 × запити періоду з хоча б однією нечернетковою пропозицією на момент звіту / усі запити періоду. Один запит рахується один раз.' },
  { id: 'offerAcceptanceRate', label: 'Пропозиції з прийняттям, %', unit: '%', description: '100 × пропозиції періоду з accepted_quantity > 0 / нечернеткові пропозиції періоду. Часткове прийняття рахується один раз.' },
  { id: 'dau', label: 'DAU', description: 'Даних поки немає: last_seen_at не є історією активності.' },
] as const;

type Dashboard = { period: { from: string; to: string }; metrics: { id: string; label: string; description: string; value: number | null; unit?: string }[]; series: Record<string, unknown>[]; generatedAt: string };
const cache = new Map<string, { expires: number; data: Dashboard }>();

export function parsePeriod(from: unknown, to: unknown) {
  const end = to === undefined ? new Date() : typeof to === 'string' ? new Date(to) : new Date(NaN);
  const start = from === undefined ? new Date(end.getTime() - 30 * 86400_000) : typeof from === 'string' ? new Date(from) : new Date(NaN);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 93 * 86400_000 || end.getTime() > Date.now() + 86400_000) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

export async function dashboard(period: { from: string; to: string }): Promise<Dashboard> {
  const key = JSON.stringify(period);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout='5000ms'");
    const series = await db.query(`WITH events AS (
      SELECT created_at,'users' AS kind FROM users WHERE created_at >= $1 AND created_at < $2
      UNION ALL SELECT created_at,'products' FROM products WHERE created_at >= $1 AND created_at < $2
      UNION ALL SELECT created_at,'requests' FROM buy_requests WHERE created_at >= $1 AND created_at < $2
      UNION ALL SELECT created_at,'offers' FROM offers WHERE created_at >= $1 AND created_at < $2
      UNION ALL SELECT created_at,'deals' FROM orders WHERE created_at >= $1 AND created_at < $2
    ) SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
      count(*) FILTER(WHERE kind='users')::int AS users,
      count(*) FILTER(WHERE kind='products')::int AS products,
      count(*) FILTER(WHERE kind='requests')::int AS requests,
      count(*) FILTER(WHERE kind='offers')::int AS offers,
      count(*) FILTER(WHERE kind='deals')::int AS deals
      FROM events GROUP BY 1 ORDER BY 1`, [period.from, period.to]);
    const rates = await db.query(`SELECT
      (SELECT 100.0*count(*) FILTER(WHERE EXISTS(SELECT 1 FROM offers o WHERE o.buy_request_id=r.id AND o.status <> 'draft'))/NULLIF(count(*),0)
        FROM buy_requests r WHERE r.created_at >= $1 AND r.created_at < $2) AS response,
      (SELECT 100.0*count(*) FILTER(WHERE accepted_quantity > 0)/NULLIF(count(*),0)
        FROM offers WHERE created_at >= $1 AND created_at < $2 AND status <> 'draft') AS acceptance`, [period.from, period.to]);
    await db.query('COMMIT');
    const totals: Record<string, number | null> = { users: 0, products: 0, requests: 0, offers: 0, deals: 0, dau: null,
      requestResponseRate: rates.rows[0].response === null ? null : Number(rates.rows[0].response),
      offerAcceptanceRate: rates.rows[0].acceptance === null ? null : Number(rates.rows[0].acceptance) };
    for (const row of series.rows) for (const id of ['users', 'products', 'requests', 'offers', 'deals']) totals[id] = (totals[id] ?? 0) + row[id];
    const result: Dashboard = { period, metrics: metricDefinitions.map(def => ({ ...def, value: totals[def.id] })), series: series.rows, generatedAt: new Date().toISOString() };
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 60_000, data: result });
    return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
