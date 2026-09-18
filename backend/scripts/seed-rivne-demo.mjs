import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { CATALOG, DATASET, PASSWORD, availablePhotoUrls, locationFor, sampleFor, randomSource } from './rivne-demo-catalog.mjs'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })
const scope = process.argv.includes('--all') ? 'all' : 'roots'
const apply = process.argv.includes('--apply')
if (process.argv.includes('--check-photos')) {
    const results = await Promise.all(availablePhotoUrls().map(async (url) => {
        try { const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) }); return { url, status: response.status } }
        catch (error) { return { url, error: error.message } }
    }))
    console.log(JSON.stringify(results, null, 2))
    if (results.some((item) => item.status !== 200)) process.exitCode = 1
    process.exit(process.exitCode ?? 0)
}
if (process.env.NODE_ENV === 'production') throw new Error('Demo data cannot be seeded in production')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()
try {
    const { rows: categories } = await client.query('SELECT id, code, name, parent_id FROM categories WHERE is_active ORDER BY path, code')
    const byId = new Map(categories.map((item) => [item.id, item]))
    const rootFor = (item) => { const seen = new Set(); while (item.parent_id && !seen.has(item.id)) { seen.add(item.id); item = byId.get(item.parent_id) ?? item; } return item }
    const roots = categories.filter((item) => !item.parent_id)
    const selected = scope === 'all' ? [...roots, ...categories.filter((item) => item.parent_id)] : roots
    const sampleCategories = new Map(roots.map((root) => [root.id, categories.filter((category) => rootFor(category).id === root.id && category.id !== root.id && sampleFor(category, root))]))
    const plan = []
    for (const category of selected) {
        const root = rootFor(category)
        if (!CATALOG[root.code]) throw new Error(`Missing catalog for ${root.code}`)
        for (let seller = 0; seller < 10; seller++) {
            const index = plan.length + 1
            const random = randomSource(index * 37 + 901)
            plan.push({ index, category, root, count: 2 + Math.floor(random() * 9), location: locationFor(index) })
        }
    }
    console.log(JSON.stringify({ dataset: DATASET, scope, categories: selected.length, sellers: plan.length, products: plan.reduce((total, item) => total + item.count, 0), apply }, null, 2))
    if (apply) {
        const passwordHash = await bcrypt.hash(PASSWORD, 12)
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(731882)')
        const { rows: occupied } = await client.query('SELECT username_normalized, email FROM users WHERE username_normalized LIKE $1', ['тестерпродавець%'])
        for (const item of occupied) if (!item.email?.endsWith('@rivne-demo.example.invalid')) throw new Error(`Existing account is not owned by this dataset: ${item.username_normalized}`)
        let createdUsers = 0, createdProducts = 0
        for (const item of plan) {
            const username = `ТестерПродавець${item.index}`
            const email = `seller${item.index}@rivne-demo.example.invalid`
            const existing = await client.query('SELECT id FROM users WHERE username_normalized = $1', [username.toLowerCase()])
            let userId = existing.rows[0]?.id
            if (!userId) {
                userId = randomUUID()
                await client.query(`INSERT INTO users (id, username, username_normalized, email, email_normalized, email_verified, country_code, phone, password_hash, nickname, bio, location_display, exact_address)
                    VALUES ($1,$2,$3,$4,$4,true,'UA',$5,$6,$2,$7,'Рівне',$8)`,
                [userId, username, username.toLowerCase(), email, `+38000${String(item.index).padStart(7, '0')}`, passwordHash, `Тестовий продавець. ${DATASET}. Розділ: ${item.root.name}. Категорія: ${item.category.name}.`, item.location.address])
                createdUsers++
            }
            const template = CATALOG[item.root.code]
            const random = randomSource(item.index * 199 + 39)
            for (let number = 1; number <= item.count; number++) {
                const token = `[${DATASET}:${item.category.code}:${item.index}:${number}]`
                const existingProduct = await client.query('SELECT id FROM products WHERE owner_id = $1 AND description LIKE $2', [userId, `%${token}%`])
                if (existingProduct.rowCount) continue
                // Root-level sellers distribute listings across suitable subcategories.
                const candidates = scope === 'roots' ? sampleCategories.get(item.root.id) : []
                const productCategory = candidates.length ? candidates[(item.index * 7 + number) % candidates.length] : item.category
                const sample = sampleFor(productCategory, item.root) ?? { name: productCategory.name, url: sampleFor(item.root, item.root).url }
                const title = `${sample.name} — ${['класичний', 'компактний', 'сімейний', 'преміум', 'базовий'][number % 5]} варіант ${item.index}-${number}`
                const productId = randomUUID()
                const price = Math.round(template[5] + random() * (template[6] - template[5]))
                await client.query(`INSERT INTO products (id, owner_id, category_id, title, description, quantity, unit, price, currency, delivery_mode, geo_zone, latitude, longitude, status)
                    VALUES ($1,$2,$3,$4,$5,$6,'piece',$7,'UAH',$8,'Рівне',$9,$10,'active')`,
                [productId, userId, productCategory.id, title.slice(0, 160), `Демонстраційне оголошення: ${title}. Категорія: ${productCategory.name}. Продавець: ${username}. Самовивіз або доставка в Рівному. Варіант ${number}: ${['новий', 'вживаний, гарний стан', 'після перевірки'][number % 3]}. ${token}`, 1 + Math.floor(random() * 15), price, ['pickup', 'seller_delivery', 'carrier'][number % 3], item.location.latitude, item.location.longitude])
                await client.query('INSERT INTO product_photos (product_id, storage_key, url, alt, sort_order) VALUES ($1,$2,$3,$4,0)', [productId, `demo/${productId}/0`, sample.url, `Ілюстрація: ${sample.name}`])
                createdProducts++
            }
            await client.query('UPDATE users SET listings_count = (SELECT count(*) FROM products WHERE owner_id = $1) WHERE id = $1', [userId])
            if (item.index % 100 === 0) console.log(`Prepared ${item.index}/${plan.length} sellers`)
        }
        await client.query('COMMIT')
        console.log(JSON.stringify({ createdUsers, createdProducts, firstLogin: 'ТестерПродавець1', lastLogin: `ТестерПродавець${plan.length}`, password: PASSWORD, city: 'Рівне' }, null, 2))
    }
} catch (error) { await client.query('ROLLBACK'); throw error }
finally { client.release(); await pool.end() }
