import { describe, expect, it } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    type Category = { id: string; code: string; name: string; parentId: string | null; imageIndex: number | null }

    describe('shared category hierarchy', () => {
        it('preserves legacy categories and filters products, requests and map by ancestors', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const username = `cat_${suffix}`
            const app = createApp()
            const agent = request.agent(app)
            try {
                const response = await request(app).get('/api/categories')
                expect(response.status).toBe(200)
                const categories: Category[] = response.body.categories
                const roots = categories.filter((item) => !item.parentId)
                expect(roots).toHaveLength(18)
                expect(categories.length).toBeGreaterThan(1155)
                expect(new Set(roots.map((item) => item.imageIndex)).size).toBe(18)
                const agriculture = categories.find((item) => item.code === 'market-agriculture')!
                expect(categories.find((item) => item.code === 'grains')?.parentId).toBe(agriculture.id)
                const byId = new Map(categories.map((item) => [item.id, item]))
                for (const item of categories) {
                    const seen = new Set<string>()
                    let current: Category | undefined = item
                    while (current) {
                        expect(seen.has(current.id)).toBe(false)
                        seen.add(current.id)
                        if (current.parentId) expect(byId.has(current.parentId)).toBe(true)
                        current = current.parentId ? byId.get(current.parentId) : undefined
                    }
                }
                const root = categories.find((item) => item.code === 'market-children')!
                const branch = categories.find((item) => item.parentId === root.id && categories.some((child) => child.parentId === item.id))!
                const leaf = categories.find((item) => item.parentId === branch.id)!
                const other = categories.find((item) => item.code === 'market-auto')!
                expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
                const product = await agent.post('/api/products').send({ categoryId: leaf.id, title: `Category test ${suffix}`, description: '', quantity: 1, unit: 'piece', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', latitude: 50.45, longitude: 30.52, status: 'active' })
                expect(product.status).toBe(201)
                const buyRequest = await agent.post('/api/buy-requests').send({ categoryId: leaf.id, title: `Category request ${suffix}`, description: '', quantity: 1, unit: 'piece', currency: 'UAH', minPrice: 0, maxPrice: 100, delivery: 'preferred', geoArea: 'Київ', latitude: 50.45, longitude: 30.52 })
                expect(buyRequest.status).toBe(201)
                for (const categoryId of [leaf.id, branch.id, root.id]) {
                    const foundProducts = await request(app).get('/api/products').query({ categoryId, q: suffix })
                    expect(foundProducts.status).toBe(200)
                    expect(foundProducts.body.products.map((item: { id: string }) => item.id)).toContain(product.body.product.id)
                    const foundRequests = await agent.get('/api/buy-requests').query({ categoryId })
                    expect(foundRequests.status).toBe(200)
                    expect(foundRequests.body.buyRequests.map((item: { id: string }) => item.id)).toContain(buyRequest.body.buyRequest.id)
                    const map = await agent.get('/api/map/markers').query({ categoryId, latitude: 50.45, longitude: 30.52, radiusKm: 10, zoom: 10 })
                    expect(map.status).toBe(200)
                    expect(map.body.markers.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([product.body.product.id, buyRequest.body.buyRequest.id]))
                }
                const wrongProducts = await request(app).get('/api/products').query({ categoryId: other.id, q: suffix })
                const sellerProducts = await request(app).get('/api/products').query({ categoryId: root.id, q: username })
                expect(sellerProducts.status).toBe(200)
                expect(sellerProducts.body.products.map((item: { id: string }) => item.id)).toContain(product.body.product.id)
                const sellerMap = await request(app).get('/api/map/markers').query({ categoryId: root.id, q: username, latitude: 50.45, longitude: 30.52, radiusKm: 10, showBuyRequests: false })
                expect(sellerMap.status).toBe(200)
                expect(sellerMap.body.markers).toHaveLength(1)
                expect(sellerMap.body.markers[0].owner).toEqual({ id: product.body.product.owner.id, username, nickname: null, avatarUrl: null })
                const bothRoles = await request(app).get('/api/map/markers').query({ categoryId: root.id, q: username, latitude: 50.45, longitude: 30.52, radiusKm: 10 })
                expect(bothRoles.body.markers.map((item: { id: string }) => item.id).sort()).toEqual([product.body.product.id, buyRequest.body.buyRequest.id].sort())
                const absentSellerMap = await request(app).get('/api/map/markers').query({ q: `absent-${suffix}`, latitude: 50.45, longitude: 30.52, radiusKm: 10 })
                expect(absentSellerMap.body.markers).toEqual([])
                expect(wrongProducts.body.products).toEqual([])
                const wrongRequests = await agent.get('/api/buy-requests').query({ categoryId: other.id })
                expect(wrongRequests.body.buyRequests.map((item: { id: string }) => item.id)).not.toContain(buyRequest.body.buyRequest.id)
                const wrongMap = await agent.get('/api/map/markers').query({ categoryId: other.id, latitude: 50.45, longitude: 30.52, radiusKm: 10 })
                expect(wrongMap.body.markers.map((item: { id: string }) => item.id)).not.toContain(product.body.product.id)
                const invalid = await agent.patch(`/api/buy-requests/${buyRequest.body.buyRequest.id}`).send({ categoryId: '00000000-0000-4000-8000-000000000099' })
                expect(invalid.status).toBe(400)
                expect(invalid.body.error).toBe('CATEGORY_NOT_AVAILABLE')
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()])
            }
        }, 60000)
    })
} else {
    describe.skip('shared category hierarchy (requires DATABASE_URL)', () => {})
}
