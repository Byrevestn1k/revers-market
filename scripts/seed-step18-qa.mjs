import { Pool } from 'pg'

const databaseUrl = new URL(process.env.DATABASE_URL)
if (databaseUrl.pathname !== '/navpaky_step18_qa') throw new Error('This seed only runs against navpaky_step18_qa')
const pool = new Pool({ connectionString: databaseUrl.toString() })
const client = await pool.connect()
try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT count(*)::integer AS count FROM products')
    if (existing.rows[0].count) {
        console.log('QA data already exists; skipping seed')
    } else {
        const user = await client.query(`INSERT INTO users(username, username_normalized, country_code, phone, password_hash)
            VALUES ('step18_qa', 'step18_qa', 'UA', '+380500000001', NULL) RETURNING id`)
        const category = await client.query("SELECT id FROM categories WHERE code = 'grains'")
        const userId = user.rows[0].id, categoryId = category.rows[0].id
        const product = await client.query(`INSERT INTO products(owner_id, category_id, title, quantity, unit, price, currency, delivery_mode, geo_zone, latitude, longitude, status, settlement_code, map_location_mode)
            SELECT $1, $2, 'Step18 QA товар ' || n, 1, 'kg', 10, 'UAH', 'pickup',
                CASE WHEN n % 2 = 0 THEN 'Рівне' ELSE 'Київ' END,
                CASE WHEN n % 2 = 0 THEN 50.62 ELSE 50.45 END,
                CASE WHEN n % 2 = 0 THEN 26.25 ELSE 30.52 END,
                'active', CASE WHEN n % 2 = 0 THEN 'UA56060470010041018' ELSE 'UA80000000000093317' END, 'pin'
            FROM generate_series(1, 8000) n`, [userId, categoryId])
        const requests = await client.query(`INSERT INTO buy_requests(buyer_id, category_id, title, requested_quantity, unit, currency, geo_area, latitude, longitude, status, settlement_code, country_code, receipt_method, map_location_mode)
            SELECT $1, $2, 'Step18 QA запит ' || n, 1, 'kg', 'UAH',
                CASE WHEN n % 2 = 0 THEN 'Рівне' ELSE 'Київ' END,
                CASE WHEN n % 2 = 0 THEN 50.62 ELSE 50.45 END,
                CASE WHEN n % 2 = 0 THEN 26.25 ELSE 30.52 END,
                'open', CASE WHEN n % 2 = 0 THEN 'UA56060470010041018' ELSE 'UA80000000000093317' END, 'UA', 'SELF_PICKUP', 'pin'
            FROM generate_series(1, 2000) n`, [userId, categoryId])
        console.log(`Seeded ${product.rowCount} Products and ${requests.rowCount} Buy Requests in isolated QA database`)
    }
    await client.query('COMMIT')
} catch (error) {
    await client.query('ROLLBACK')
    throw error
} finally {
    client.release()
    await pool.end()
}
