import 'dotenv/config';
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { createApp } from '../backend/src/app.ts';
import { closeDatabase } from '../backend/src/db/client.ts';
import { listingSearchColumns, smartSearchSql } from '../backend/src/smart-search.ts';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) throw new Error('Benchmark requires the local QA database');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const marker = `Step15RequestPerf_${Date.now()}`;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cases = [['one', 'велосипед'], ['three', 'червоний дитячий велосипед'], ['typo', 'велосепед']];
let server;
await db.connect();
try {
  const buyer = (await db.query('SELECT id FROM users WHERE username=$1', ['qa_buyer_a'])).rows[0];
  const category = (await db.query('SELECT id FROM categories WHERE name=$1', ['Велосипеди'])).rows[0];
  if (!buyer || !category) throw new Error('Documented QA buyer or bicycle category missing');
  const existing = await db.query("SELECT count(*)::int AS count FROM buy_requests WHERE buyer_id=$1 AND category_id=$2 AND status='open'", [buyer.id, category.id]);
  if (existing.rows[0].count !== 0) throw new Error('QA buyer already owns open bicycle requests; cannot isolate benchmark');
  const inserted = await db.query(`INSERT INTO buy_requests
    (buyer_id,category_id,title,description,requested_quantity,unit,currency,min_unit_price,max_unit_price,geo_area,latitude,longitude,status,delivery_address)
    SELECT $1,$2,
      CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
           WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END,
      CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
           WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END,
      1,'шт','UAH',(n % 5000),(n % 5000),'Рівне',50.6199,26.2516,'open',$3
    FROM generate_series(1,10000) n`, [buyer.id, category.id, marker]);
  await db.query('ANALYZE buy_requests');
  console.log(JSON.stringify({ rows: inserted.rowCount, kind: 'Buy Request', cache: 'one warm-up then three measured runs' }));
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [label, phrase] of cases.filter(([name]) => !process.argv[2] || process.argv[2] === name)) {
    const params = [buyer.id, category.id];
    const search = smartSearchSql(listingSearchColumns('buyRequest'), phrase, params);
    const from = `FROM buy_requests r JOIN categories c ON c.id=r.category_id LEFT JOIN categories parent_c ON parent_c.id=c.parent_id JOIN users u ON u.id=r.buyer_id WHERE r.status='open' AND r.buyer_id=$1 AND r.category_id=$2 AND ${search.condition}`;
    for (const [operation, sql] of Object.entries({
      count: `SELECT count(*) ${from}`,
      page1: `SELECT r.id,count(*) OVER() AS total ${from} ORDER BY ${search.rank} DESC,r.created_at DESC,r.id DESC LIMIT 20 OFFSET 0`,
      page2: `SELECT r.id,count(*) OVER() AS total ${from} ORDER BY ${search.rank} DESC,r.created_at DESC,r.id DESC LIMIT 20 OFFSET 20`,
    })) {
      const run = async () => {
        const data = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)).rows[0]['QUERY PLAN'][0];
        return data['Execution Time'];
      };
      await run();
      const measured = [];
      for (let n = 0; n < 3; n++) measured.push(await run());
      console.log(JSON.stringify({ case: label, kind: 'SQL', operation, medianMs: Number(median(measured).toFixed(2)) }));
    }
    for (const page of [1, 2]) {
      const url = `${baseUrl}/api/buy-requests?${new URLSearchParams({ q: phrase, page: String(page), limit: '20', buyerUsername: 'qa_buyer_a', categoryId: category.id })}`;
      const run = async () => {
        const started = performance.now();
        const response = await fetch(url);
        const body = await response.json();
        if (!response.ok) throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
        return { ms: performance.now() - started, total: body.pagination.total, firstId: body.buyRequests[0]?.id };
      };
      await run();
      const measured = [];
      for (let n = 0; n < 3; n++) measured.push(await run());
      console.log(JSON.stringify({ case: label, kind: 'HTTP', page, medianMs: Number(median(measured.map(result => result.ms)).toFixed(2)), total: measured[1].total, firstId: measured[1].firstId }));
    }
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  const cleaned = await db.query('DELETE FROM buy_requests WHERE delivery_address=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [marker, 'qa_buyer_a']);
  console.log(JSON.stringify({ cleanup: cleaned.rowCount, marker }));
  await closeDatabase();
  await db.end();
}
