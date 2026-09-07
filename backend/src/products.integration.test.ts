import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('products HTTP integration', () => {
        it('supports CRUD, pagination, photos, and owner-only edits', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const firstPayload = { username: `seller_${suffix}`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const secondPayload = { username: `other_${suffix}`, countryCode: 'PL', phone: `+4850${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const seller = request.agent(createApp())
            const other = request.agent(createApp())
            let productId = ''
            try {
                expect((await seller.post('/api/auth/register').send(firstPayload)).status).toBe(201)
                expect((await other.post('/api/auth/register').send(secondPayload)).status).toBe(201)
                const category = (await seller.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                expect(category).toBeDefined()
                const created = await seller.post('/api/products').send({
                    categoryId: category.id, title: 'Пшениця', description: 'Сортова', quantity: 12.5, unit: 'ton', price: 250, currency: 'UAH',
                    deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active', photos: [{ url: 'https://cdn.example.com/wheat.jpg', alt: 'Зерно' }],
                })
                expect(created.status).toBe(201)
                productId = created.body.product.id
                expect(created.body.product.photos).toHaveLength(1)

                expect((await other.patch(`/api/products/${productId}`).send({ title: 'Чужий товар' })).status).toBe(404)
                expect((await other.patch(`/api/products/${productId}`).send({ photos: [{ url: 'https://attacker.example/photo.jpg' }] })).status).toBe(404)
                expect((await other.delete(`/api/products/${productId}`)).status).toBe(404)
                expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Оновлена пшениця' })).status).toBe(200)
                expect((await seller.get(`/api/products/${productId}`)).body.product.title).toBe('Оновлена пшениця')
                expect((await other.get(`/api/products/${productId}`)).status).toBe(200)
                const paused = await seller.patch(`/api/products/${productId}`).send({ status: 'paused' })
                expect(paused.status).toBe(200)
                expect(paused.body.product.status).toBe('paused')
                expect((await other.get(`/api/products/${productId}`)).status).toBe(404)
                expect((await seller.get('/api/products/mine?limit=1')).body.products[0].status).toBe('paused')
                const page = await seller.get('/api/products?limit=1&page=1')
                expect(page.status).toBe(200)
                expect(page.body.pagination).toMatchObject({ page: 1, limit: 1 })
                expect((await seller.delete(`/api/products/${productId}`)).status).toBe(204)
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [firstPayload.username.toLowerCase(), secondPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('products HTTP integration (requires DATABASE_URL)', () => { })
}
