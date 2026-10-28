import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { readFile } from 'node:fs/promises'
import { categoryFilterSql } from './category-filter.js'

const retired = ['honey', 'honey_raw', 'beeswax', 'pollen', 'propolis', 'royal_jelly', 'bee_packages']

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('Step 20 category taxonomy', () => {
        it('shows only the canonical beekeeping products category and keeps old filters useful', async () => {
            const rows = (await pool.query<{ id: string; code: string; is_active: boolean; parent_id: string | null }>(
                'SELECT id, code, is_active, parent_id FROM categories WHERE code = ANY($1::text[])',
                [[...retired, 'apiculture', 'bees']],
            )).rows
            const byCode = new Map(rows.map(row => [row.code, row]))
            const canonical = byCode.get('apiculture')!
            expect(canonical.is_active).toBe(true)
            for (const code of retired) {
                const old = byCode.get(code)!
                expect(old.is_active, code).toBe(false)
                expect(old.parent_id, code).toBe(code === 'bee_packages' ? byCode.get('bees')!.id : canonical.id)
                const target = code === 'bee_packages' ? byCode.get('bees')!.id : canonical.id
                const filtered = await pool.query<{ id: string }>(
                    `SELECT c.id FROM categories c WHERE ${categoryFilterSql('c.id', 1)} AND c.id = $2`,
                    [old.id, target],
                )
                expect(filtered.rows.map(row => row.id), code).toEqual([target])
            }
            const response = await request(createApp()).get('/api/categories')
            expect(response.status).toBe(200)
            expect(response.body.categories.filter((row: { code: string }) => row.code === 'apiculture')).toHaveLength(1)
            expect(response.body.categories.some((row: { code: string }) => retired.includes(row.code))).toBe(false)
            const publicCanonical = response.body.categories.find((row: { code: string }) => row.code === 'apiculture')
            expect(publicCanonical.legacyIds).toContain(byCode.get('honey_raw')!.id)
            expect(publicCanonical.legacyIds).toContain(byCode.get('honey')!.id)
        }, 20_000)

        it('has no orphaned listing links, cycles or exact sibling duplicates', async () => {
            const [links, cycles, duplicates, subscriptions] = await Promise.all([
                pool.query(`SELECT
                    (SELECT count(*) FROM products WHERE category_id IN (SELECT id FROM categories WHERE code = ANY($1::text[])))::int AS products,
                    (SELECT count(*) FROM buy_requests WHERE category_id IN (SELECT id FROM categories WHERE code = ANY($1::text[])))::int AS requests`, [retired]),
                pool.query(`WITH RECURSIVE ancestry AS (
                    SELECT id, parent_id, ARRAY[id] AS trail, false AS cycle FROM categories
                    UNION ALL
                    SELECT c.id, c.parent_id, a.trail || c.id, c.id = ANY(a.trail)
                    FROM ancestry a JOIN categories c ON c.id = a.parent_id WHERE NOT a.cycle
                ) SELECT count(*)::int AS count FROM ancestry WHERE cycle`),
                pool.query(`SELECT parent_id, lower(name), count(*) FROM categories WHERE is_active
                    GROUP BY parent_id, lower(name) HAVING count(*) > 1`),
                pool.query('SELECT count(*)::int AS count FROM demand_subscriptions s JOIN categories c ON c.id = s.category_id WHERE c.code = ANY($1::text[])', [retired]),
            ])
            expect(links.rows[0]).toEqual({ products: 0, requests: 0 })
            expect(cycles.rows[0].count).toBe(0)
            expect(duplicates.rows).toHaveLength(0)
            expect(subscriptions.rows[0].count).toBe(0)
        })

        it('does not redirect an unrelated inactive category to its parent', async () => {
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                const parent = (await client.query<{ id: string }>("SELECT id FROM categories WHERE code = 'apiculture'")).rows[0].id
                const old = (await client.query<{ id: string }>(
                    "INSERT INTO categories (code, name, parent_id, is_active) VALUES ($1, 'Тестова неактивна', $2, false) RETURNING id",
                    [`step20-inactive-${Date.now()}-${Math.random()}`, parent],
                )).rows[0].id
                const result = await client.query(`SELECT c.id FROM categories c WHERE ${categoryFilterSql('c.id', 1)}`, [old])
                expect(result.rows).toHaveLength(0)
            } finally {
                await client.query('ROLLBACK')
                client.release()
            }
        })

        it('shows corrected Ukrainian names', async () => {
            const result = await pool.query<{ code: string; name: string }>(
                'SELECT code, name FROM categories WHERE code = ANY($1::text[]) AND is_active',
                [['market-auto--avtomobili-z-polshchi--pozosta-e-osobowe', 'market-auto-parts--avtozapchastyny--inshi-avtozapchastyn']],
            )
            expect(new Map(result.rows.map(row => [row.code, row.name]))).toEqual(new Map([
                ['market-auto--avtomobili-z-polshchi--pozosta-e-osobowe', 'Інші легкові автомобілі'],
                ['market-auto-parts--avtozapchastyny--inshi-avtozapchastyn', 'Інші автозапчастини'],
            ]))
        })

        it('protects subscriptions and safely replays migration 053 on old listings', async () => {
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
                const user = (await client.query<{ id: string }>(
                    'INSERT INTO users (username, username_normalized, country_code, phone, password_hash) VALUES ($1,$1,$2,$3,$4) RETURNING id',
                    [`s20_${suffix}`, 'UA', `+380${suffix.slice(-9)}`, 'test-only'],
                )).rows[0].id
                const codes = (await client.query<{ code: string; id: string }>(
                    'SELECT code, id FROM categories WHERE code = ANY($1::text[])', [['honey', 'honey_raw', 'apiculture', 'livestock', 'bees', 'market-agriculture']],
                )).rows
                const byCode = new Map(codes.map(row => [row.code, row.id]))
                const unrelated = (await client.query<{ id: string }>(
                    "INSERT INTO demand_subscriptions (user_id,category_id,active,country_code) VALUES ($1,$2,true,'UA') RETURNING id",
                    [user, byCode.get('market-agriculture')],
                )).rows[0].id
                await client.query('UPDATE categories SET is_active = true WHERE code = ANY($1::text[])', [retired])
                await client.query("UPDATE categories SET parent_id = (SELECT id FROM categories WHERE code = 'market-agriculture') WHERE code = 'honey'")
                const product = (await client.query<{ id: string }>(
                    "INSERT INTO products (owner_id,category_id,title,description,quantity,unit,price,currency,delivery_mode,geo_zone) VALUES ($1,$2,'QA мед','Опис',2,'kg',100,'UAH','pickup','Рівне') RETURNING id",
                    [user, byCode.get('honey')],
                )).rows[0].id
                const buyRequest = (await client.query<{ id: string }>(
                    "INSERT INTO buy_requests (buyer_id,category_id,title,description,requested_quantity,unit,currency,geo_area) VALUES ($1,$2,'QA мед запит','Опис',3,'kg','UAH','Рівне') RETURNING id",
                    [user, byCode.get('honey_raw')],
                )).rows[0].id
                const sql = await readFile(new URL('../db/migrations/053_category_taxonomy_cleanup.sql', import.meta.url), 'utf8')
                // A broad honey category can expand apiculture even if live bees were already moved.
                await client.query('SAVEPOINT honey_parent_guard')
                await client.query('UPDATE demand_subscriptions SET category_id = $1 WHERE category_id = ANY($2::uuid[])',
                    [byCode.get('market-agriculture'), [byCode.get('apiculture'), byCode.get('livestock'), byCode.get('bees')]])
                await client.query("INSERT INTO demand_subscriptions (user_id,category_id,active,country_code) VALUES ($1,$2,false,'UA')", [user, byCode.get('apiculture')])
                await expect(client.query(sql)).rejects.toThrow(/review of parent subscriptions/)
                await client.query('ROLLBACK TO SAVEPOINT honey_parent_guard')
                for (const parent of ['apiculture', 'livestock', 'bees']) {
                    await client.query('SAVEPOINT parent_guard')
                    await client.query("UPDATE categories SET parent_id = $1 WHERE code = 'bees'", [byCode.get('apiculture')])
                    await client.query('UPDATE demand_subscriptions SET category_id = $1 WHERE category_id = ANY($2::uuid[])',
                        [byCode.get('market-agriculture'), [byCode.get('apiculture'), byCode.get('livestock'), byCode.get('bees')]])
                    await client.query("INSERT INTO demand_subscriptions (user_id,category_id,active,country_code) VALUES ($1,$2,false,'UA')", [user, byCode.get(parent)])
                    await expect(client.query(sql)).rejects.toThrow(/review of parent subscriptions/)
                    await client.query('ROLLBACK TO SAVEPOINT parent_guard')
                }
                await client.query('UPDATE demand_subscriptions SET category_id = $1 WHERE category_id = ANY($2::uuid[])',
                    [byCode.get('market-agriculture'), [byCode.get('apiculture'), byCode.get('livestock'), byCode.get('bees')]])
                const subscription = (await client.query<{ id: string }>(
                    "INSERT INTO demand_subscriptions (user_id,category_id,active,country_code) VALUES ($1,$2,true,'UA') RETURNING id",
                    [user, byCode.get('honey_raw')],
                )).rows[0].id
                await client.query('SAVEPOINT subscription_guard')
                await expect(client.query(sql)).rejects.toThrow(/explicit review of honey subscriptions/)
                await client.query('ROLLBACK TO SAVEPOINT subscription_guard')
                expect((await client.query('SELECT category_id, active FROM demand_subscriptions WHERE id = $1', [subscription])).rows[0])
                    .toEqual({ category_id: byCode.get('honey_raw'), active: true })
                await client.query('UPDATE demand_subscriptions SET active = false WHERE id = $1', [subscription])
                await client.query('SAVEPOINT paused_subscription_guard')
                await expect(client.query(sql)).rejects.toThrow(/explicit review of honey subscriptions/)
                await client.query('ROLLBACK TO SAVEPOINT paused_subscription_guard')
                expect((await client.query('SELECT category_id, active FROM demand_subscriptions WHERE id = $1', [subscription])).rows[0])
                    .toEqual({ category_id: byCode.get('honey_raw'), active: false })
                await client.query('DELETE FROM demand_subscriptions WHERE id = $1', [subscription])
                // Recreate the old parentage while keeping unrelated local subscriptions out of this fixture.
                await client.query("UPDATE categories SET parent_id = $1 WHERE code IN ('bees', 'queen_bees')", [byCode.get('apiculture')])
                const snapshot = async () => (await client.query(`SELECT
                    (SELECT to_jsonb(p) - 'category_id' FROM products p WHERE id = $1) AS product,
                    (SELECT to_jsonb(r) - 'category_id' FROM buy_requests r WHERE id = $2) AS request,
                    (SELECT to_jsonb(s) FROM demand_subscriptions s WHERE id = $3) AS subscription,
                    (SELECT count(*)::int FROM notifications) AS notifications`, [product, buyRequest, unrelated])).rows[0]
                const before = await snapshot()
                await client.query(sql)
                const state = (await client.query(`SELECT
                    (SELECT category_id FROM products WHERE id = $1) AS product,
                    (SELECT category_id FROM buy_requests WHERE id = $2) AS request`, [product, buyRequest])).rows[0]
                expect(state).toEqual({ product: byCode.get('apiculture'), request: byCode.get('apiculture') })
                expect(await snapshot()).toEqual(before)
                await client.query(sql)
                expect(await snapshot()).toEqual(before)
            } finally {
                await client.query('ROLLBACK')
                client.release()
            }
        }, 30_000)
    })
} else {
    describe.skip('Step 20 category taxonomy (requires DATABASE_URL)', () => {})
}
