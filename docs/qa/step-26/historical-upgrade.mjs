import { Client } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test'
if (process.env.DATABASE_URL !== base) throw new Error('Only the isolated Step 26 server is allowed')
const database = `step26_history_${Date.now()}`
const admin = new Client({ connectionString: base })
await admin.connect()
try {
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) throw new Error('Historical test database already exists; refusing to overwrite it')
  await admin.query(`CREATE DATABASE ${database}`)
} finally { await admin.end() }
const target = new URL(base)
target.pathname = `/${database}`
const client = new Client({ connectionString: target.toString() })
await client.connect()
try {
  const files = (await readdir('backend/db/migrations')).filter(file => file.endsWith('.sql')).sort()
  await client.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  for (const file of files.filter(name => name < '056_')) {
    await client.query('BEGIN')
    try { await client.query(await readFile(`backend/db/migrations/${file}`, 'utf8')); await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]); await client.query('COMMIT') }
    catch (error) { await client.query('ROLLBACK'); throw error }
  }
  const buyer = (await client.query("INSERT INTO users(username,username_normalized,country_code,phone,password_hash) VALUES('history_buyer','history_buyer','UA','+380501234501','test') RETURNING id")).rows[0].id
  const seller = (await client.query("INSERT INTO users(username,username_normalized,country_code,phone,password_hash) VALUES('history_seller','history_seller','UA','+380671234501','test') RETURNING id")).rows[0].id
  const category = (await client.query('SELECT id FROM categories ORDER BY id LIMIT 1')).rows[0].id
  const request = (await client.query("INSERT INTO buy_requests(buyer_id,category_id,title,requested_quantity,unit,currency,geo_area) VALUES($1,$2,'Historical request',1,'kg','UAH','Kyiv') RETURNING id", [buyer, category])).rows[0].id
  const order = (await client.query("INSERT INTO orders(buy_request_id,buyer_id,seller_id,status,currency,subtotal,quantity,unit,unit_price,conditions_snapshot,workflow_version) VALUES($1,$2,$3,'completed','UAH',10,1,'kg',10,$4,1) RETURNING id", [request, buyer, seller, JSON.stringify({ productTitle: 'Historical snapshot', photos: [{ url: '/old-photo.jpg' }] })])).rows[0].id
  await client.query("INSERT INTO reviews(order_id,reviewer_id,reviewee_id,rating,body,published_at) VALUES($1,$2,$3,11,'Historical review',now())", [order, buyer, seller])
  const beforeOrder = (await client.query('SELECT to_jsonb(o) AS value FROM orders o WHERE id=$1', [order])).rows[0].value
  const beforeReview = (await client.query('SELECT to_jsonb(r) AS value FROM reviews r WHERE order_id=$1', [order])).rows[0].value
  for (const file of files.filter(name => name >= '056_')) {
    await client.query('BEGIN')
    try { await client.query(await readFile(`backend/db/migrations/${file}`, 'utf8')); await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]); await client.query('COMMIT') }
    catch (error) { await client.query('ROLLBACK'); throw error }
  }
  const afterOrder = (await client.query('SELECT to_jsonb(o) - \'source\' AS value, source FROM orders o WHERE id=$1', [order])).rows[0]
  const afterReview = (await client.query('SELECT to_jsonb(r) AS value FROM reviews r WHERE order_id=$1', [order])).rows[0].value
  assert.deepEqual(afterOrder.value, beforeOrder)
  assert.equal(afterOrder.source, 'buy_request')
  assert.deepEqual(afterReview, beforeReview)
  console.log('PASS: historical order snapshot, status and review unchanged after migrations 056 and 057')
} finally { await client.end() }
