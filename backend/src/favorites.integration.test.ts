import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('favorites HTTP integration', () => {
        it('keeps product, request and profile favorites private, unique and account-bound', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const credentials = (username: string, phone: string) => ({ username, email: `${username}@example.com`, countryCode: 'UA', phone, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
            const ownerData = credentials(`favorite_owner_${suffix}`, `+38050${suffix.slice(-7)}`)
            const viewerData = credentials(`favorite_viewer_${suffix}`, `+38067${suffix.slice(-7)}`)
            const owner = request.agent(createApp())
            const viewer = request.agent(createApp())
            let productId = '', requestId = '', ownerId = ''
            try {
                expect((await owner.post('/api/auth/register').send(ownerData)).status).toBe(201)
                const ownerMe = await owner.get('/api/auth/me')
                ownerId = ownerMe.body.user.id
                expect((await viewer.post('/api/auth/register').send(viewerData)).status).toBe(201)
                const category = (await owner.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await owner.post('/api/products').send({ categoryId: category.id, title: `Favorite product ${suffix}`, description: 'Public favorite', quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', status: 'active', photos: [] })
                expect(product.status).toBe(201); productId = product.body.product.id
                const buyRequest = await owner.post('/api/buy-requests').send({ categoryId: category.id, title: `Favorite request ${suffix}`, description: 'Public demand', quantity: 1, unit: 'kg', minPrice: 10, maxPrice: 20, currency: 'UAH', geoArea: 'Київ', deliveryRequired: false, fulfillmentMode: 'single_seller' })
                expect(buyRequest.status).toBe(201); requestId = buyRequest.body.buyRequest.id

                expect((await request(createApp()).get('/api/favorites')).status).toBe(401)
                for (const [targetType, targetId] of [['product', productId], ['buy_request', requestId], ['profile', ownerId]]) {
                    expect((await viewer.put('/api/favorites').send({ targetType, targetId })).status).toBe(200)
                }
                expect((await viewer.put('/api/favorites').send({ targetType: 'product', targetId: productId })).status).toBe(200)
                const saved = await viewer.get('/api/favorites')
                expect(saved.status).toBe(200)
                expect(saved.body.favorites).toHaveLength(3)
                expect(saved.body.favorites.map((item: { targetType: string }) => item.targetType).sort()).toEqual(['buy_request', 'product', 'profile'])
                expect(saved.body.favorites.some((item: { phone?: string; exactAddress?: string }) => item.phone || item.exactAddress)).toBe(false)
                expect((await owner.get('/api/favorites')).body.favorites).toEqual([])
                expect((await viewer.delete(`/api/favorites/product/${productId}`)).status).toBe(204)
                expect((await viewer.get('/api/favorites')).body.favorites).toHaveLength(2)
            } finally {
                if (ownerId) await pool.query('DELETE FROM users WHERE id = $1', [ownerId])
                await pool.query('DELETE FROM users WHERE username_normalized = $1', [viewerData.username.toLowerCase()])
            }
        }, 120000)
    })
}
