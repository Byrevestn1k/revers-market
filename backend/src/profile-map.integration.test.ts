import { describe, expect, it } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('seller public map location', () => {
        it('requires consent, moves all products, preserves private addresses and revokes sharing', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const username = `point_${suffix}`, app = createApp(), agent = request.agent(app)
            const pin = { mode: 'pin', latitude: 50.625951, longitude: 26.270642, consent: true }
            const address = 'Рівне, Приватна тестова вулиця, 17'
            const mapQuery = { latitude: pin.latitude, longitude: pin.longitude, radiusKm: 1, zoom: 19, south: pin.latitude - .0001, north: pin.latitude + .0001, west: pin.longitude - .0001, east: pin.longitude + .0001, q: suffix, showBuyRequests: false }
            const getMap = () => request(app).get('/api/map/markers').query(mapQuery)
            const getPublic = () => request(app).get(`/api/profiles/${username}`)
            try {
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const categoryId = (await agent.get('/api/categories')).body.categories[0].id
                const ids: string[] = []
                for (const position of [{ latitude: 49.84, longitude: 24.03 }, {}]) {
                    const created = await agent.post('/api/products').send({ categoryId, title: `Мед ${suffix} ${ids.length}`, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Львів', address: 'Окрема адреса товару', status: 'active', ...position })
                    expect(created.status).toBe(201); ids.push(created.body.product.id)
                }
                expect((await agent.patch('/api/profile/me').send({ exactAddress: address, location: 'Рівне' })).status).toBe(200)
                expect((await getPublic()).body.profile).not.toHaveProperty('exactAddress')
                expect((await getMap()).body.markers).toEqual([])
                for (const mapLocation of [null, { ...pin, consent: false }, { ...pin, latitude: 91 }, { ...pin, longitude: null }, { ...pin, latitude: '50' }, { ...pin, mode: 'unknown' }]) {
                    expect((await agent.patch('/api/profile/me').send({ mapLocation })).status).toBe(400)
                }
                const saved = await agent.patch('/api/profile/me').send({ mapLocation: pin })
                expect(saved.status).toBe(200)
                expect((await agent.get('/api/profile/me')).body.profile.mapLocation).toEqual(pin)
                const publicPin = (await getPublic()).body.profile
                expect(publicPin).not.toHaveProperty('exactAddress')
                expect(publicPin.mapLocation).toMatchObject({ mode: 'pin', latitude: pin.latitude, longitude: pin.longitude })
                const points = await getMap()
                expect(points.status).toBe(200)
                expect(points.body.markers.map((item: any) => item.id).sort()).toEqual(ids.sort())
                expect(points.body.markers.every((item: any) => item.latitude === pin.latitude && item.longitude === pin.longitude && item.approximate === false && item.publicAddress === undefined)).toBe(true)
                expect(JSON.stringify(points.body)).not.toContain(address)
                const oldArea = await request(app).get('/api/map/markers').query({ latitude: 49.84, longitude: 24.03, radiusKm: 1, q: suffix, showBuyRequests: false })
                expect(oldArea.body.markers).toEqual([])
                const filtered = await request(app).get('/api/map/markers').query({ ...mapQuery, categoryId, geoZone: 'Рівне', searchIn: 'title' })
                expect(filtered.body.markers).toHaveLength(2)
                const unchanged = await agent.get('/api/products/mine').query({ q: suffix })
                expect(unchanged.status).toBe(200)
                expect(unchanged.body.products.every((item: any) => item.address === 'Окрема адреса товару')).toBe(true)
                const moved = await agent.patch('/api/profile/me').send({ mapLocation: { ...pin, longitude: 26.28 } })
                expect(moved.status).toBe(200); expect((await getMap()).body.markers).toEqual([])
                expect((await agent.patch('/api/profile/me').send({ mapLocation: { ...pin, mode: 'address' } })).status).toBe(200)
                expect((await getPublic()).body.profile.exactAddress).toBe(address)
                expect((await getMap()).body.markers.every((item: any) => item.publicAddress === address)).toBe(true)
                expect((await request(app).get('/api/products/' + ids[0])).body.product.publicAddress).toBe(address)
                // Editing a published address without reconfirming its point must revoke sharing.
                expect((await agent.patch('/api/profile/me').send({ exactAddress: 'Інша приватна адреса' })).status).toBe(200)
                expect((await getPublic()).body.profile).not.toHaveProperty('exactAddress')
                expect((await getMap()).body.markers).toEqual([])
                expect((await agent.patch('/api/profile/me').send({ mapLocation: pin })).status).toBe(200)
                expect((await agent.patch('/api/profile/me').send({ mapLocation: { mode: 'approximate' } })).status).toBe(200)
                const revoked = (await agent.get('/api/profile/me')).body.profile.mapLocation
                expect(revoked).toEqual({ mode: 'approximate', latitude: null, longitude: null, consent: false })
                expect((await getPublic()).body.profile).not.toHaveProperty('mapLocation')
                expect((await getMap()).body.markers).toEqual([])
            } finally { await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]) }
        }, 60000)
    })
} else { describe.skip('seller public map location (requires DATABASE_URL)', () => {}) }
