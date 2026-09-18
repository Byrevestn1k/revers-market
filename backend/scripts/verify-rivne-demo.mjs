import dotenv from 'dotenv'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { DATASET, PASSWORD, STREETS } from './rivne-demo-catalog.mjs'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.DEMO_API_URL ?? 'http://127.0.0.1:3000'
const get = async (route, params = {}) => { const response = await fetch(`${base}${route}?${new URLSearchParams(params)}`); assert.equal(response.status, 200, route); return response.json() }
try {
    const { rows: sellers } = await pool.query(`SELECT u.id, u.username, u.password_hash, u.location_display, u.exact_address,
        count(p.id)::int AS products, count(ph.id)::int AS photos, min(p.latitude)::float AS latitude, min(p.longitude)::float AS longitude
        FROM users u JOIN products p ON p.owner_id = u.id LEFT JOIN product_photos ph ON ph.product_id = p.id
        WHERE u.email LIKE '%@rivne-demo.example.invalid' AND p.description LIKE $1
        GROUP BY u.id ORDER BY u.username`, [`%${DATASET}%`])
    assert.ok(sellers.length >= 180)
    assert.equal(new Set(sellers.map((seller) => seller.exact_address)).size, sellers.length)
    for (const seller of sellers) {
        assert.equal(seller.location_display, 'Рівне')
        assert.ok(seller.exact_address.startsWith('м. Рівне, вул. '))
        assert.ok(seller.products >= 2 && seller.products <= 10)
        assert.equal(seller.products, seller.photos)
        // HERE-resolved buildings include eastern streets outside the old synthetic seed box.
        assert.ok(seller.latitude > 50.58 && seller.latitude < 50.67)
        assert.ok(seller.longitude > 26.18 && seller.longitude < 26.33)
    }
    const first = sellers.find((seller) => seller.username === 'ТестерПродавець1')
    assert.ok(await bcrypt.compare(PASSWORD, first.password_hash))
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: first.username, password: PASSWORD }) })
    assert.equal(login.status, 200)
    assert.equal((await login.json()).user.username, first.username)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
    assert.equal(logout.status, 204)
    const { categories } = await get('/api/categories')
    const roots = categories.filter((item) => !item.parentId)
    let markersChecked = 0
    for (const root of roots) {
        const params = { latitude: '50.6199', longitude: '26.2516', radiusKm: '10', zoom: '13', geoZone: 'Рівне', categoryId: root.id, showBuyRequests: 'false', q: 'ТестерПродавець' }
        const map = await get('/api/map/markers', params)
        assert.equal(new Set(map.markers.map((marker) => marker.owner.id)).size >= 10, true, root.name)
        if (sellers.length === 180) assert.equal(new Set(map.markers.map((marker) => marker.owner.id)).size, 10, root.name)
        assert.ok(map.markers.every((marker) => marker.geoZone === 'Рівне' && marker.approximate))
        markersChecked += map.markers.length
        const products = await get('/api/products', { categoryId: root.id, geoZone: 'Рівне', q: 'ТестерПродавець', limit: '50' })
        assert.ok(products.pagination.total >= 20, root.name)
        assert.ok(products.products.every((product) => product.geoZone === 'Рівне' && product.photos.length))
    }
    const exactSellerProducts = await get('/api/products', { q: 'ТестерПродавець1', geoZone: 'Рівне', limit: '50' })
    assert.ok(exactSellerProducts.products.length > 0)
    const none = await get('/api/map/markers', { latitude: '50.6199', longitude: '26.2516', radiusKm: '10', q: 'неіснуючий-демо-продавець-999999' })
    assert.deepEqual(none.markers, [])
    const far = await get('/api/map/markers', { latitude: '50.45', longitude: '30.52', radiusKm: '10', q: 'ТестерПродавець' })
    assert.deepEqual(far.markers, [])
    const { rows: example } = await pool.query(`SELECT c.id, c.name, c.parent_id, count(*)::int AS count FROM products p JOIN categories c ON c.id = p.category_id WHERE p.description LIKE $1 AND c.parent_id IS NOT NULL GROUP BY c.id ORDER BY count DESC LIMIT 1`, [`%${DATASET}%`])
    const child = await get('/api/products', { categoryId: example[0].id, q: 'ТестерПродавець', geoZone: 'Рівне' })
    assert.ok(child.products.every((product) => product.category.id === example[0].id || categories.some((category) => category.id === product.category.id && category.parentId === example[0].id)))
    console.log(JSON.stringify({ verified: true, sellers: sellers.length, products: sellers.reduce((sum, seller) => sum + seller.products, 0), rootFilters: roots.length, markersChecked, nestedCategory: example[0].name, syntheticStreetNames: STREETS.length, login: first.username, city: 'Рівне' }, null, 2))
} finally { await pool.end() }
