import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Client } from 'pg';

const source = process.env.DATABASE_URL;
if (!source) throw new Error('DATABASE_URL is required');
const dbName = `step14_migration_qa_${randomBytes(4).toString('hex')}`;
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });
let migrated;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const qaUrl = new URL(source);
  qaUrl.pathname = `/${dbName}`;
  migrated = new Client({ connectionString: qaUrl.toString() });
  await migrated.connect();
  const dir = resolve('backend/db/migrations');
  const files = (await readdir(dir)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  for (const file of files.filter(name => !name.startsWith('046_'))) {
    await migrated.query('BEGIN');
    try {
      await migrated.query(await readFile(resolve(dir, file), 'utf8'));
      await migrated.query('COMMIT');
    } catch (error) {
      await migrated.query('ROLLBACK');
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }
  }
  const users = (await migrated.query(`INSERT INTO users(username,username_normalized,country_code,phone,password_hash)
    VALUES ('Buyer QA','buyer_qa','UA','+380501234567','x'),('Seller QA','seller_qa','UA','+380671234567','x') RETURNING id`)).rows;
  const category = (await migrated.query('SELECT id FROM categories LIMIT 1')).rows[0].id;
  const product = (await migrated.query(`INSERT INTO products(owner_id,category_id,title,quantity,unit,price,currency,delivery_mode,geo_zone,status)
    VALUES($1,$2,'Legacy Product',10,'kg',100,'UAH','pickup','Рівне','active') RETURNING id`, [users[1].id, category])).rows[0];
  const request = (await migrated.query(`INSERT INTO buy_requests(buyer_id,category_id,title,requested_quantity,unit,currency,geo_area,preferred_delivery)
    VALUES($1,$2,'Legacy Request',2,'kg','UAH','Рівне','Самовивіз') RETURNING id`, [users[0].id, category])).rows[0];
  const offer = (await migrated.query(`INSERT INTO offers(buy_request_id,seller_id,product_id,offered_quantity,unit,unit_price,currency,delivery)
    VALUES($1,$2,$3,2,'kg',100,'UAH','Самовивіз') RETURNING id`, [request.id, users[1].id, product.id])).rows[0];
  const snapshot = { delivery: 'Самовивіз', legacy: true };
  const deal = (await migrated.query(`INSERT INTO orders(buy_request_id,buyer_id,seller_id,offer_id,status,currency,subtotal,quantity,unit,unit_price,conditions_snapshot)
    VALUES($1,$2,$3,$4,'accepted','UAH',200,2,'kg',100,$5::jsonb) RETURNING id`, [request.id, users[0].id, users[1].id, offer.id, JSON.stringify(snapshot)])).rows[0];
  await migrated.query(await readFile(resolve(dir, '046_delivery_options.sql'), 'utf8'));
  const result = await migrated.query(`SELECT
    (SELECT delivery_options FROM products WHERE id=$1) product_options,
    (SELECT delivery_options FROM buy_requests WHERE id=$2) request_options,
    (SELECT delivery_options FROM offers WHERE id=$3) offer_options,
    (SELECT conditions_snapshot FROM orders WHERE id=$4) deal_snapshot,
    (SELECT count(*)::int FROM products) products,
    (SELECT count(*)::int FROM buy_requests) requests,
    (SELECT count(*)::int FROM offers) offers,
    (SELECT count(*)::int FROM orders) deals`, [product.id, request.id, offer.id, deal.id]);
  assert.deepEqual(result.rows[0], { product_options: null, request_options: null, offer_options: null, deal_snapshot: snapshot, products: 1, requests: 1, offers: 1, deals: 1 });
  console.log('Step 14 migration passed with legacy Product, Request, Offer and Deal');
} finally {
  if (migrated) await migrated.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
  await admin.end().catch(() => {});
}
