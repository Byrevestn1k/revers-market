import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { searchSettlements } from './settlements.js'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('settlement identity through address and map workflows', () => {
        it('persists codes, separates namesakes, preserves private address coordinates and clears old points', async () => {
            const username = `settlement_${Date.now()}`, app = createApp(), agent = request.agent(app)
            const namesakes = searchSettlements('Рівне').settlements.filter(item => item.name === 'Рівне')
            const city = namesakes.find(item => item.type === 'city')!
            const village = namesakes.find(item => item.type === 'village')!
            try {
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + String(Date.now()).slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const directory = await agent.get('/api/settlements').query({ q: 'Рівне' })
                expect(directory.status).toBe(200)
                expect(directory.body.settlements.filter((item: any) => item.name === 'Рівне').map((item: any) => item.code)).toEqual(namesakes.map(item => item.code))
                expect((await agent.get(`/api/settlements/${city.code}`)).body.settlement).toEqual(city)
                const categoryId = (await agent.get('/api/categories')).body.categories[0].id
                const product = { categoryId, title: username, quantity: 1, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', latitude: 50.62, longitude: 26.25 }
                const first = await agent.post('/api/products').send({ ...product, settlementCode: city.code })
                expect(first.status).toBe(201)
                expect(first.body.product.settlement.code).toBe(city.code)
                const second = await agent.post('/api/products').send({ ...product, settlementCode: village.code })
                expect(second.status).toBe(201)
                const markers = await agent.get('/api/map/markers').query({ latitude: 50.62, longitude: 26.25, radiusKm: 10, cityName: city.name, settlementCode: city.code, q: username, showBuyRequests: false })
                expect(markers.status).toBe(200)
                expect(markers.body.markers.map((item: any) => item.id)).toEqual([first.body.product.id])
                const catalog = await agent.get('/api/products').query({ settlementCode: village.code, q: username })
                expect(catalog.body.products.map((item: any) => item.id)).toEqual([second.body.product.id])
                expect((await agent.post('/api/products').send({ ...product, settlementCode: 'wrong' })).status).toBe(400)
                expect((await agent.post('/api/products').send({ ...product, geoZone: 'Київ', settlementCode: city.code })).status).toBe(400)
                const updated = await agent.patch(`/api/products/${first.body.product.id}`).send({ settlementCode: village.code, geoZone: village.name, latitude: null, longitude: null })
                expect(updated.status).toBe(200)
                expect(updated.body.product.coordinates).toBeNull()
                expect(updated.body.product.settlement.code).toBe(village.code)
                const buy = await agent.post('/api/buy-requests').send({ categoryId, title: username, description: '', quantity: 1, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, delivery: 'yes', geoArea: city.name, settlementCode: city.code, latitude: 50.62, longitude: 26.25 })
                expect(buy.status).toBe(201)
                expect(buy.body.buyRequest.settlement.code).toBe(city.code)
                const buyUpdate = await agent.patch(`/api/buy-requests/${buy.body.buyRequest.id}`).send({ geoArea: village.name, settlementCode: village.code, latitude: null, longitude: null })
                expect(buyUpdate.status).toBe(200)
                expect(buyUpdate.body.buyRequest.coordinates).toBeNull()
                const point = { latitude: 50.619, longitude: 26.251 }
                const profile = await agent.patch('/api/profile/me').send({ exactAddress: 'Рівне, Соборна, 1', location: city.name, settlementCode: city.code, addressSettlementCode: city.code, addressCoordinates: point })
                expect(profile.status).toBe(200)
                expect(profile.body.profile.addressSettlement.code).toBe(city.code)
                expect(profile.body.profile.addressCoordinates).toEqual(point)
                const publicProfile = await request(app).get(`/api/profiles/${username}`)
                expect(publicProfile.body.profile.addressCoordinates).toBeUndefined()
                expect(publicProfile.body.profile.addressSettlement).toBeUndefined()
                const pin = await agent.patch('/api/profile/me').send({ location: village.name, settlementCode: village.code, mapLocation: { mode: 'pin', latitude: 49.1, longitude: 25.1, consent: true } })
                expect(pin.status).toBe(200)
                expect(pin.body.profile.addressSettlement.code).toBe(city.code)
                expect(pin.body.profile.addressCoordinates).toEqual(point)
                expect(pin.body.profile.settlement.code).toBe(village.code)
                const legacy = await agent.patch('/api/profile/me').send({ exactAddress: 'Нова адреса' })
                expect(legacy.body.profile.addressCoordinates).toBeNull()
                expect(legacy.body.profile.addressSettlement).toBeNull()
            } finally { await pool.query('DELETE FROM users WHERE username_normalized = $1', [username]) }
        }, 60000)
    })
} else describe.skip('settlement integration requires DATABASE_URL', () => {})
