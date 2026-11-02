import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    const { exchangeRates } = await import('./exchange-rates.js')
    describe('product sorting with PostgreSQL', () => {
        it('orders filtered currencies before pagination without changing products', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const username = `sort_${suffix}`
            const app = createApp(); const agent = request.agent(app)
            const set = { id: '0123456789abcdef01234567', date: '02.11.2026', rates: { UAH: '1', USD: '40', EUR: '50', PLN: '10' }, fetchedAt: Date.now() }
            const mock = vi.spyOn(exchangeRates, 'get').mockResolvedValue(set)
            try {
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const category = (await agent.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const base = { categoryId: category.id, quantity: 1, unit: 'kg', deliveryMode: 'pickup', status: 'active', geoZone: 'Рівне' }
                const ids: string[] = []
                for (const [price, currency] of [[100, 'USD'], [2000, 'UAH'], [80, 'EUR']] as const) {
                    const res = await agent.post('/api/products').send({ ...base, title: `Сортування тест ${currency}`, price, currency })
                    expect(res.status, JSON.stringify(res.body)).toBe(201); ids.push(res.body.product.id)
                }
                const list = async (sort: string, page = 1) => {
                    const res = await agent.get('/api/products').query({ ownerUsername: username, q: 'сортування тест', sort, limit: 1, page, ...(page > 1 && sort.startsWith('price') ? { rateId: set.id } : {}) })
                    expect(res.status, JSON.stringify(res.body)).toBe(200); return res.body
                }
                expect((await list('price_asc', 1)).products[0].id).toBe(ids[1])
                const remaining = [(await list('price_asc', 2)).products[0].id, (await list('price_asc', 3)).products[0].id]
                expect(remaining.sort()).toEqual([ids[0], ids[2]].sort())
                expect((await list('price_desc', 3)).products[0].id).toBe(ids[1])
                for (const sort of ['default', 'newest', 'oldest']) expect((await list(sort)).pagination.total).toBe(3)
                const products = (await pool.query('SELECT price, currency FROM products WHERE id = ANY($1::uuid[]) ORDER BY currency', [ids])).rows
                expect(products).toEqual([{ price: '80.00', currency: 'EUR' }, { price: '2000.00', currency: 'UAH' }, { price: '100.00', currency: 'USD' }])
            } finally { mock.mockRestore(); await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]) }
        }, 120000)
    })
} else describe.skip('product sorting requires DATABASE_URL', () => {})
