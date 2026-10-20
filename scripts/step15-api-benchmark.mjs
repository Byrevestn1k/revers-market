import 'dotenv/config';
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { createApp } from '../backend/src/app.ts';
import { closeDatabase } from '../backend/src/db/client.ts';
import { listingSearchColumns, smartSearchSql } from '../backend/src/smart-search.ts';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) throw new Error('Benchmark requires the local QA database');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const marker = `Step15Perf_${Date.now()}`;
const cases = [
  ['one', 'велосипед', {}], ['three', 'червоний дитячий велосипед', {}],
  ['five', 'червоний дитячий велосипед trek 20', {}], ['typo', 'велосепед', {}],
  ['geography', 'велосипед', { geoZone: 'Рівне' }],
  ['category-price', 'велосипед', { maxPrice: '1000' }],
  ['selective', 'Trek', {}],
];
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const indexes = (plan) => {
  const found = [];
  const visit = (node) => { if (node['Index Name']) found.push(node['Index Name']); for (const child of node.Plans ?? []) visit(child); };
  visit(plan);
  return [...new Set(found)];
};
const explain = async (sql, params) => {
  const data = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)).rows[0]['QUERY PLAN'][0];
  return { ms: Number(data['Execution Time'].toFixed(2)), indexes: indexes(data.Plan), plan: data.Plan['Node Type'] };
};

await db.connect();
let server;
try {
  const user = (await db.query('SELECT id FROM users WHERE username=$1', ['qa_seller_a'])).rows[0];
  const category = (await db.query('SELECT id FROM categories WHERE name=$1', ['Велосипеди'])).rows[0];
  if (!user || !category) throw new Error('Documented QA seller or bicycle category missing');
  const existing = await db.query("SELECT count(*)::int AS count FROM products WHERE owner_id=$1 AND category_id=$2 AND status='active'", [user.id, category.id]);
  if (existing.rows[0].count !== 0) throw new Error('QA seller already owns active bicycle listings; cannot isolate benchmark');
  const inserted = await db.query(`INSERT INTO products
    (owner_id,category_id,title,description,quantity,unit,price,currency,delivery_mode,geo_zone,latitude,longitude,status,pickup_address)
    SELECT $1,$2,
      CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
           WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END,
      CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
           WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END,
      1,'шт',(n % 5000),'UAH','pickup','Рівне',50.6199,26.2516,'active',$3
    FROM generate_series(1,10000) n`, [user.id, category.id, marker]);
  await db.query('ANALYZE products');
  console.log(JSON.stringify({ rows: inserted.rowCount, environment: 'local QA PostgreSQL, one documented seller, one category, tagged cleanup', cache: 'one warm-up then three measured runs' }));
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const selectedCases = process.argv[2]?.split(',');
  for (const [label, phrase, extra] of cases.filter(([label]) => !selectedCases || selectedCases.includes(label))) {
    const params = [user.id, category.id];
    const search = smartSearchSql(listingSearchColumns('product'), phrase, params);
    const extraSql = label === 'geography' ? " AND p.geo_zone = 'Рівне'" : label === 'category-price' ? ' AND p.price <= 1000' : '';
    const from = `FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN categories parent_c ON parent_c.id=c.parent_id JOIN users u ON u.id=p.owner_id WHERE p.status='active' AND p.owner_id=$1 AND p.category_id=$2 AND ${search.condition}${extraSql}`;
    for (const [operation, sql] of Object.entries({
      count: `SELECT count(*) ${from}`,
      page1: `SELECT p.id,count(*) OVER() AS total ${from} ORDER BY ${search.rank} DESC,p.created_at DESC,p.id DESC LIMIT 20 OFFSET 0`,
      page2: `SELECT p.id,count(*) OVER() AS total ${from} ORDER BY ${search.rank} DESC,p.created_at DESC,p.id DESC LIMIT 20 OFFSET 20`,
    })) {
      await explain(sql, params);
      const runs = [];
      for (let n = 0; n < 3; n++) runs.push(await explain(sql, params));
      console.log(JSON.stringify({ case: label, kind: 'SQL', operation, medianMs: median(runs.map(run => run.ms)), indexes: runs[1].indexes }));
    }
    // The Product API has no price filter; the price case is SQL-only.
    if (label === 'category-price') continue;
    for (const page of [1, 2]) {
      const query = new URLSearchParams({ q: phrase, page: String(page), limit: '20', ownerUsername: 'qa_seller_a', categoryId: category.id, ...extra });
      const url = `${baseUrl}/api/products?${query}`;
      const run = async () => {
        const started = performance.now();
        const response = await fetch(url);
        const body = await response.json();
        if (!response.ok) throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
        return { ms: performance.now() - started, total: body.pagination.total, ids: body.products.map(item => item.id) };
      };
      await run();
      const runs = [];
      for (let n = 0; n < 3; n++) runs.push(await run());
      console.log(JSON.stringify({ case: label, kind: 'HTTP', page, medianMs: Number(median(runs.map(run => run.ms)).toFixed(2)), total: runs[1].total, firstId: runs[1].ids[0] }));
    }
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  const cleaned = await db.query('DELETE FROM products WHERE pickup_address=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [marker, 'qa_seller_a']);
  console.log(JSON.stringify({ cleanup: cleaned.rowCount, marker }));
  await closeDatabase();
  await db.end();
}
