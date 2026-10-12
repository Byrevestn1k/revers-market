import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('region filtering HTTP integration', () => {
        it('keeps products, buy requests, and map markers inside the selected oblast', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const sellerPayload = { username: `region_seller_${suffix}`, email: `region_seller_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const buyerPayload = { username: `region_buyer_${suffix}`, email: `region_buyer_${suffix}@example.com`, countryCode: 'UA', phone: `+38063${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const seller = request.agent(createApp())
            const buyer = request.agent(createApp())
            const guest = request(createApp())
            try {
                expect((await seller.post('/api/auth/register').send(sellerPayload)).status).toBe(201)
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                const category = (await guest.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const rivne = (await guest.get('/api/settlements').query({ region: 'Рівненська область', limit: 1 })).body.settlements[0]
                const kyiv = (await guest.get('/api/settlements').query({ region: 'Київська область', limit: 1 })).body.settlements[0]
                expect(category).toBeDefined(); expect(rivne).toBeDefined(); expect(kyiv).toBeDefined()

                const rivneProduct = await seller.post('/api/products').send({ categoryId: category.id, title: `Рівненський товар ${suffix}`, description: suffix, quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: rivne.name, settlementCode: rivne.code, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' })
                const kyivProduct = await seller.post('/api/products').send({ categoryId: category.id, title: `Київський товар ${suffix}`, description: suffix, quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: kyiv.name, settlementCode: kyiv.code, latitude: 50.4501, longitude: 30.5234, mapLocationMode: 'pin', status: 'active' })
                const rivneRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: `Рівненський запит ${suffix}`, description: suffix, quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: rivne.name, settlementCode: rivne.code, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', fulfillmentMode: 'multiple_sellers' })
                const kyivRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: `Київський запит ${suffix}`, description: suffix, quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: kyiv.name, settlementCode: kyiv.code, latitude: 50.4501, longitude: 30.5234, mapLocationMode: 'pin', fulfillmentMode: 'multiple_sellers' })
                expect([rivneProduct.status, kyivProduct.status, rivneRequest.status, kyivRequest.status]).toEqual([201, 201, 201, 201])

                const products = await guest.get('/api/products').query({ region: 'Рівненська область', q: suffix })
                expect(products.status).toBe(200)
                expect(products.body.products.map((item: { id: string }) => item.id)).toContain(rivneProduct.body.product.id)
                expect(products.body.products.map((item: { id: string }) => item.id)).not.toContain(kyivProduct.body.product.id)
                const buyRequests = await guest.get('/api/buy-requests').query({ countryCode: 'UA', region: 'Рівненська область' })
                expect(buyRequests.status).toBe(200)
                expect(buyRequests.body.buyRequests.map((item: { id: string }) => item.id)).toContain(rivneRequest.body.buyRequest.id)
                expect(buyRequests.body.buyRequests.map((item: { id: string }) => item.id)).not.toContain(kyivRequest.body.buyRequest.id)
                const markers = await guest.get('/api/map/markers').query({ latitude: 50.6199, longitude: 26.2516, nationwide: 'true', region: 'Рівненська область', q: suffix })
                expect(markers.status).toBe(200)
                const markerIds = markers.body.markers.map((item: { id: string }) => item.id)
                expect(markerIds).toEqual(expect.arrayContaining([rivneProduct.body.product.id, rivneRequest.body.buyRequest.id]))
                expect(markerIds).not.toEqual(expect.arrayContaining([kyivProduct.body.product.id, kyivRequest.body.buyRequest.id]))
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [sellerPayload.username.toLowerCase(), buyerPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('region filtering HTTP integration (requires DATABASE_URL)', () => { })
}
