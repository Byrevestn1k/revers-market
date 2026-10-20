import 'dotenv/config';
import pg from 'pg';
import { smartSearchSql } from '../backend/src/smart-search.ts';

// Reproducible isolated benchmark: all rows and indexes are temporary per connection.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const size of [100, 1000, 10000]) {
    await client.query('DROP TABLE IF EXISTS pg_temp.step15_bench');
    await client.query(`CREATE TEMP TABLE step15_bench AS
      SELECT n AS id,
        CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
             WHEN n % 7 = 0 THEN 'Велосипед дитячий'
             ELSE 'Товар номер ' || n END AS title,
        CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
             WHEN n % 7 = 0 THEN 'Червоний велосипед'
             ELSE 'Звичайний опис' END AS description,
        'Велосипеди'::text AS category, ''::text AS parent_category,
        'шт'::text AS unit, 'тест'::text AS owner,
        'Рівне'::text AS region, (n % 5000)::numeric AS price,
        lower(CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
             WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END || ' ' ||
             CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
             WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END || ' шт') AS search_text
      FROM generate_series(1, $1) n`, [size]);
    await client.query('CREATE INDEX step15_bench_trgm ON step15_bench USING gin (search_text gin_trgm_ops)');
    await client.query('ANALYZE step15_bench');
    const cases = [
      ['one', 'велосипед'], ['three', 'червоний дитячий велосипед'],
      ['five', 'червоний дитячий велосипед trek 20'], ['typo', 'велосепед'],
      ['geography', 'велосипед'], ['category-price', 'велосипед'],
    ];
    for (const [label, phrase] of cases) {
      const params = [];
      const search = smartSearchSql({ title: 'p.title', description: 'p.description', category: 'p.category', parentCategory: 'p.parent_category', unit: 'p.unit', owner: 'p.owner', indexedText: 'p.search_text' }, phrase, params);
      const extra = label === 'geography' ? " AND p.region = 'Рівне'" : label === 'category-price' ? " AND p.category = 'Велосипеди' AND p.price <= 1000" : '';
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT p.id FROM step15_bench p WHERE ${search.condition}${extra}
        ORDER BY ${search.rank} DESC, p.id DESC LIMIT 20`, params);
      console.log(JSON.stringify({ size, case: label, ms: Number(plan.rows[0]['QUERY PLAN'][0]['Execution Time'].toFixed(2)), rows: plan.rows[0]['QUERY PLAN'][0].Plan['Actual Rows'] }));
    }
  }
} finally {
  await client.end();
}
