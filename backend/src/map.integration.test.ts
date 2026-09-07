import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('map points and privacy HTTP integration', () => {
        it('returns relevant points by radius and filters without exposing exact address', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const buyerPayload = { username: `map_buyer_${suffix}`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const sellerPayload = { username: `map_seller_${suffix}`, countryCode: 'UA', phone: `+38067${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const buyer = request.agent(createApp())
            const seller = request.agent(createApp())
            try {
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                expect((await seller.post('/api/auth/register').send(sellerPayload)).status).toBe(201)
                const categories = (await seller.get('/api/categories')).body.categories
                const grains = categories.find((item: { code: string }) => item.code === 'grains')
                const vegetables = categories.find((item: { code: string }) => item.code === 'vegetables')
                const nearProduct = await seller.post('/api/products').send({ categoryId: grains.id, title: 'Тестова пшениця поруч', description: '', quantity: 100, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', latitude: 50.4506, longitude: 30.5239, status: 'active' })
                const farProduct = await seller.post('/api/products').send({ categoryId: vegetables.id, title: 'Тестові овочі далеко', description: '', quantity: 100, unit: 'kg', price: 30, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Житомир', latitude: 50.9, longitude: 30.5, status: 'active' })
                expect(nearProduct.status).toBe(201)
                expect(farProduct.status).toBe(201)
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: grains.id, title: 'Тестовий запит поруч', description: 'Тест мапи', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 10, maxPrice: 20, delivery: 'yes', geoArea: 'Київ', address: 'Точна тестова адреса 42', latitude: 50.451, longitude: 30.524, deadline: '2030-01-01T00:00:00.000Z' })
                expect(createdRequest.status).toBe(201)
                const requestId = createdRequest.body.buyRequest.id

                const nearby = await seller.get('/api/map/markers?latitude=50.45&longitude=30.52&radiusKm=10&zoom=10')
                expect(nearby.status).toBe(200)
                expect(nearby.body.markers.map((marker: { title: string }) => marker.title)).toEqual(expect.arrayContaining(['Тестова пшениця поруч', 'Тестовий запит поруч']))
                expect(nearby.body.markers.map((marker: { title: string }) => marker.title)).not.toContain('Тестові овочі далеко')
                expect(nearby.body.markers.every((marker: { approximate: boolean }) => marker.approximate)).toBe(true)

                const filtered = await seller.get(`/api/map/markers?latitude=50.45&longitude=30.52&radiusKm=10&zoom=10&categoryId=${grains.id}&showBuyRequests=false`)
                expect(filtered.status).toBe(200)
                expect(filtered.body.markers).toHaveLength(1)
                expect(filtered.body.markers[0]).toMatchObject({ title: 'Тестова пшениця поруч', kind: 'product' })

                const publicRequest = await seller.get(`/api/buy-requests/${requestId}`)
                expect(publicRequest.status).toBe(200)
                expect(publicRequest.body.buyRequest.delivery.address).toBeNull()
                const ownerRequest = await buyer.get(`/api/buy-requests/${requestId}`)
                expect(ownerRequest.status).toBe(200)
                expect(ownerRequest.body.buyRequest.delivery.address).toBe('Точна тестова адреса 42')
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [buyerPayload.username.toLowerCase(), sellerPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('map points and privacy HTTP integration (requires DATABASE_URL)', () => { })
}