import { describe, expect, it } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('city and nationwide map search', () => {
        it('limits a city search by city and radius, while an empty city searches all Ukraine', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const username = `city_${suffix}`, app = createApp(), agent = request.agent(app)
            try {
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const categoryId = (await agent.get('/api/categories')).body.categories[0].id
                const ids: string[] = []
                for (const [latitude, longitude, geoZone] of [[50.62, 26.25, 'Рівне'], [50.75, 26.4, 'м. Рівне'], [50.63, 26.26, 'Рівненська область']]) {
                    const created = await agent.post('/api/products').send({ categoryId, title: `Мед ${suffix}`, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', status: 'active', latitude, longitude, geoZone })
                    expect(created.status).toBe(201); ids.push(created.body.product.id)
                }
                const base = { latitude: 50.62, longitude: 26.25, radiusKm: 1, zoom: 19, q: suffix, searchIn: 'title', showBuyRequests: false }
                const city = await request(app).get('/api/map/markers').query({ ...base, cityName: 'Рівне', categoryId })
                expect(city.status).toBe(200)
                expect(city.body.markers.map((item: any) => item.id)).toEqual([ids[0]])
                const broadCity = await request(app).get('/api/map/markers').query({ ...base, radiusKm: 100, cityName: ' РІВНЕ ' })
                expect(broadCity.body.markers.map((item: any) => item.id)).toEqual(ids.slice(0, 2))
                const otherOrigin = await request(app).get('/api/map/markers').query({ ...base, latitude: 50.75, longitude: 26.4, cityName: 'Рівне' })
                expect(otherOrigin.body.markers.map((item: any) => item.id)).toEqual([ids[1]])
                const owner = await request(app).get('/api/map/markers').query({ ...base, cityName: 'Рівне', q: username, searchIn: 'owner', includeOwnerListings: true })
                expect(owner.body.markers.map((item: any) => item.id)).toEqual(ids.slice(0, 2))
                expect((await request(app).get('/api/map/markers').query(base)).body.markers.map((item: any) => item.id)).toEqual([ids[0]])
                const nationwide = await request(app).get('/api/map/markers').query({ ...base, nationwide: true })
                expect(nationwide.body.markers.map((item: any) => item.id)).toEqual(expect.arrayContaining(ids))
                expect((await request(app).get('/api/map/markers').query({ ...base, cityName: 'Рівне', q: 'Неіснуючий' + suffix })).body.markers).toEqual([])
                expect((await request(app).get('/api/map/markers').query({ ...base, cityName: '' })).status).toBe(400)
                expect((await request(app).get('/api/map/markers').query({ ...base, cityName: 'x'.repeat(121) })).status).toBe(400)
                expect((await request(app).get('/api/map/markers').query({ ...base, cityName: "Рівне' OR 1=1 --" })).body.markers).toEqual([])
                expect((await request(app).get('/api/map/markers').query({ ...base, cityName: 'Рівне', nationwide: true })).status).toBe(400)
                const buy = await agent.post('/api/buy-requests').send({ categoryId, title: `Мед ${suffix}`, description: '', quantity: 1, unit: 'kg', currency: 'UAH', minPrice: 10, maxPrice: 100, delivery: 'yes', geoArea: 'Рівне', latitude: 50.75, longitude: 26.4 })
                expect(buy.status).toBe(201)
                const requests = await request(app).get('/api/map/markers').query({ ...base, radiusKm: 100, cityName: 'Рівне', showProducts: false, showBuyRequests: true })
                expect(requests.body.markers.map((item: any) => item.id)).toEqual([buy.body.buyRequest.id])
            } finally { await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]) }
        }, 60000)
    })
} else { describe.skip('city search (requires DATABASE_URL)', () => {}) }
