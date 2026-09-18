import { describe, expect, it } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('unified listing search and location', () => {
        it('keeps title search, map results and private editable addresses consistent', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const username = `listing_${suffix}`
            const app = createApp(), agent = request.agent(app)
            try {
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const categories = (await agent.get('/api/categories')).body.categories
                const root = categories.find((item: any) => item.code === 'market-children')
                const leaf = categories.find((item: any) => item.parentId === root.id)
                const location = { address: 'Рівне, Тестова приватна вулиця, 17', latitude: 50.625951, longitude: 26.270642 }
                const created = await agent.post('/api/products').send({ categoryId: leaf.id, title: `Велосипед Trek ${suffix}`, description: `Самокат ${suffix}`, quantity: 3, unit: 'piece', price: 1200, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', ...location, photos: [{ url: 'https://example.com/bike-1.jpg' }, { url: 'https://example.com/bike-2.jpg' }] })
                expect(created.status).toBe(201)
                const product = created.body.product
                expect(product.address).toBe(location.address)
                expect(product.coordinates).toEqual({ latitude: location.latitude, longitude: location.longitude })
                const publicProduct = await request(app).get('/api/products/' + product.id)
                expect(publicProduct.body.product.address).toBeNull()
                expect(publicProduct.body.product.coordinates).toEqual({ latitude: 50.63, longitude: 26.27 })
                const common = { latitude: 50.62, longitude: 26.25, radiusKm: 10, searchIn: 'title', showBuyRequests: false, categoryId: root.id }
                const q = `  ${suffix}   TREK велосипед `
                const map = await request(app).get('/api/map/markers').query({ ...common, q })
                const catalog = await request(app).get('/api/products').query({ searchIn: 'title', categoryId: root.id, q })
                expect(map.status).toBe(200); expect(catalog.status).toBe(200)
                expect(map.body.markers.map((item: any) => item.id)).toEqual([product.id])
                expect(catalog.body.products.map((item: any) => item.id)).toEqual([product.id])
                expect(map.body.markers[0]).toMatchObject({ quantity: 3, unit: 'piece', deliveryMode: 'pickup' })
                expect(JSON.stringify(map.body)).not.toContain(location.address)
                const titleOnly = await request(app).get('/api/map/markers').query({ ...common, q: `Самокат ${suffix}` })
                expect(titleOnly.body.markers).toEqual([])
                const descriptions = await request(app).get('/api/map/markers').query({ ...common, searchIn: 'all', q: `Самокат ${suffix}` })
                expect(descriptions.body.markers.map((item: any) => item.id)).toEqual([product.id])
                const literalWildcard = await request(app).get('/api/map/markers').query({ ...common, q: `${suffix} %` })
                expect(literalWildcard.body.markers).toEqual([])
                const outside = await request(app).get('/api/map/markers').query({ ...common, q: suffix, south: 50.60, north: 50.61, west: 26.20, east: 26.22 })
                expect(outside.body.markers).toEqual([])
                const updated = await agent.patch('/api/products/' + product.id).send({ address: 'Рівне, Інша приватна вулиця, 5', latitude: 50.621, longitude: 26.261, title: product.title })
                expect(updated.status).toBe(200)
                expect(updated.body.product.photos).toHaveLength(2)
                expect(updated.body.product.address).toContain('Інша приватна')
                const mine = await agent.get('/api/products/mine').query({ q: suffix })
                expect(mine.body.products[0].address).toContain('Інша приватна')
                const buy = await agent.post('/api/buy-requests').send({ categoryId: leaf.id, title: `Велосипед запит ${suffix}`, description: '', quantity: 1, unit: 'piece', currency: 'UAH', minPrice: 100, maxPrice: 1500, delivery: 'preferred', preferredDelivery: 'carrier', geoArea: 'Рівне', ...location })
                expect(buy.status).toBe(201)
                expect(buy.body.buyRequest.delivery.address).toBe(location.address)
                const publicBuy = await request(app).get('/api/buy-requests/' + buy.body.buyRequest.id)
                expect(publicBuy.body.buyRequest.delivery.address).toBeNull()
                const requests = await request(app).get('/api/map/markers').query({ ...common, showProducts: false, showBuyRequests: true, q: `запит ${suffix}` })
                expect(requests.body.markers.map((item: any) => item.id)).toEqual([buy.body.buyRequest.id])
            } finally { await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]) }
        }, 60000)
    })
} else { describe.skip('unified listing workflow (requires DATABASE_URL)', () => {}) }
