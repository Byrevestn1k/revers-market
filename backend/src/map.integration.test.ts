import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('map points and privacy HTTP integration', () => {
        it('returns relevant points by radius and filters without exposing exact address', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const buyerPayload = { username: `map_buyer_${suffix}`, email: `map_buyer_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const sellerPayload = { username: `map_seller_${suffix}`, email: `map_seller_${suffix}@example.com`, countryCode: 'UA', phone: `+38067${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const buyer = request.agent(createApp())
            const seller = request.agent(createApp())
            try {
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                expect((await seller.post('/api/auth/register').send(sellerPayload)).status).toBe(201)
                expect((await seller.patch('/api/profile/me').send({ nickname: 'Продавець для мапи', avatarUrl: 'https://example.com/map-avatar.jpg' })).status).toBe(200)
                expect((await buyer.patch('/api/profile/me').send({ nickname: 'Покупець для мапи' })).status).toBe(200)
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

                // Nearby uses the saved exact point on the server, even though the map returns the rounded point.
                for (const zoom of [7, 12, 19]) {
                    const fixed = await seller.get('/api/map/markers').query({ latitude: 50.4506, longitude: 30.5239, radiusKm: .2, zoom, nearby: true, searchIn: 'owner', includeOwnerListings: true, q: sellerPayload.username, showBuyRequests: false })
                    expect(fixed.status).toBe(200)
                    expect(fixed.body.filters.radiusKm).toBe(.2)
                    expect(fixed.body.markers.map((marker: { id: string }) => marker.id)).toEqual([nearProduct.body.product.id])
                    expect(fixed.body.markers[0]).toMatchObject({ latitude: 50.45, longitude: 30.52, approximate: true, distanceBand: 'до 1 км' })
                    expect(fixed.body.markers[0]).not.toHaveProperty('distanceKm')
                }
                const expanded = await seller.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, radiusKm: 60, zoom: 19, nearby: true, searchIn: 'owner', q: sellerPayload.username, showBuyRequests: false })
                expect(expanded.body.filters.radiusKm).toBe(60)
                expect(expanded.body.markers.map((marker: { id: string }) => marker.id)).toEqual(expect.arrayContaining([nearProduct.body.product.id, farProduct.body.product.id]))
                expect((await seller.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, nearby: true, nationwide: true })).status).toBe(400)

                // Zoom around the public point: the private address is outside these bounds.
                for (const zoom of [17, 18, 19]) {
                    const close = await seller.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, radiusKm: 10, zoom, south: 50.4498, north: 50.4502, west: 30.5198, east: 30.5202, categoryId: grains.id })
                    expect(close.status).toBe(200)
                    expect(close.body.markers.map((marker: { id: string }) => marker.id)).toEqual(expect.arrayContaining([nearProduct.body.product.id, requestId]))
                    expect(close.body.markers.every((marker: { latitude: number; longitude: number }) => marker.latitude === 50.45 && marker.longitude === 30.52)).toBe(true)
                }

                const filtered = await seller.get(`/api/map/markers?latitude=50.45&longitude=30.52&radiusKm=10&zoom=10&categoryId=${grains.id}&showBuyRequests=false`)
                expect(filtered.status).toBe(200)
                expect(filtered.body.markers).toHaveLength(1)
                expect(filtered.body.markers[0]).toMatchObject({ title: 'Тестова пшениця поруч', kind: 'product' })
                expect(filtered.body.markers[0].owner).toMatchObject({ username: sellerPayload.username, nickname: 'Продавець для мапи', avatarUrl: 'https://example.com/map-avatar.jpg' })
                expect(filtered.body.markers[0].owner).not.toHaveProperty('email')
                expect(filtered.body.markers[0].owner).not.toHaveProperty('phone')
                expect(filtered.body.markers[0].owner).not.toHaveProperty('exactAddress')
                const byBuyerName = await buyer.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, radiusKm: 10, showProducts: false, q: 'Покупець для мапи' })
                expect(byBuyerName.status).toBe(200)
                expect(byBuyerName.body.markers).toHaveLength(1)
                expect(byBuyerName.body.markers[0].owner).toMatchObject({ username: buyerPayload.username, nickname: 'Покупець для мапи' })
                expect(byBuyerName.body.markers[0].category.imageIndex).toBeTypeOf('number')
                expect(JSON.stringify(byBuyerName.body)).not.toContain('Точна тестова адреса 42')

                const publicRequest = await seller.get(`/api/buy-requests/${requestId}`)
                expect(publicRequest.status).toBe(200)
                expect(publicRequest.body.buyRequest.delivery.address).toBeNull()
                const ownerRequest = await buyer.get(`/api/buy-requests/${requestId}`)
                expect(ownerRequest.status).toBe(200)
                expect(ownerRequest.body.buyRequest.delivery.address).toBe('Точна тестова адреса 42')

                const publicProduct = await seller.post('/api/products').send({ categoryId: vegetables.id, title: 'Тестовий публічний магазин', description: '', quantity: 10, unit: 'kg', price: 40, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', address: 'Київ, Публічна, 1', addressVisibility: 'public', addressVisibilityConsent: true, latitude: 50.452, longitude: 30.524, status: 'active' })
                expect(publicProduct.status).toBe(201)
                const visibleProduct = await buyer.get(`/api/products/${publicProduct.body.product.id}`)
                expect(visibleProduct.body.product).toMatchObject({ addressVisibility: 'public', address: 'Київ, Публічна, 1', coordinates: { latitude: 50.452, longitude: 30.524 } })
                const publicPoint = await buyer.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, radiusKm: 10, categoryId: vegetables.id, showBuyRequests: false })
                expect(publicPoint.body.markers.find((marker: { id: string }) => marker.id === publicProduct.body.product.id)).toMatchObject({ approximate: false, publicAddress: 'Київ, Публічна, 1', latitude: 50.452, longitude: 30.524 })

                expect((await seller.patch('/api/profile/me').send({ mapLocation: { mode: 'pin', latitude: 49.84, longitude: 24.03, consent: true } })).status).toBe(200)
                const remoteProfileProduct = await seller.post('/api/products').send({ categoryId: vegetables.id, title: 'Тестове оголошення в іншому місті', description: '', quantity: 10, unit: 'kg', price: 40, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Житомир', latitude: 50.2547, longitude: 28.6587, status: 'active' })
                expect(remoteProfileProduct.status).toBe(201)
                const atProfilePoint = await buyer.get('/api/map/markers').query({ latitude: 49.84, longitude: 24.03, radiusKm: .2, showBuyRequests: false })
                expect(atProfilePoint.body.markers.map((marker: { id: string }) => marker.id)).not.toContain(remoteProfileProduct.body.product.id)
                const ownPointProduct = await seller.post('/api/products').send({ categoryId: vegetables.id, title: 'Тестова власна точка товару', description: '', quantity: 10, unit: 'kg', price: 40, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', mapLocationMode: 'pin', latitude: 50.452, longitude: 30.524, status: 'active' })
                expect(ownPointProduct.status).toBe(201)
                const ownPoint = await buyer.get('/api/map/markers').query({ latitude: 50.45, longitude: 30.52, radiusKm: 10, categoryId: vegetables.id, showBuyRequests: false })
                expect(ownPoint.body.markers.find((marker: { id: string }) => marker.id === ownPointProduct.body.product.id)).toMatchObject({ approximate: false, latitude: 50.452, longitude: 30.524 })
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [buyerPayload.username.toLowerCase(), sellerPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('map points and privacy HTTP integration (requires DATABASE_URL)', () => { })
}
