import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import request from 'supertest'

const enabled = Boolean(process.env.DATABASE_URL)

describe.skipIf(!enabled)('structured category attributes', () => {
    it('persists separate request, product, offer and deal values and rejects invalid or foreign edits', async () => {
        const { createApp } = await import('./app.js')
        const { pool } = await import('./db/client.js')
        const buyer = request.agent(createApp()), seller = request.agent(createApp())
        const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
        for (const [index, agent] of [buyer, seller].entries()) {
            const username = `attrs_${index}_${suffix}`
            expect((await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201)
        }
        const categories = (await buyer.get('/api/categories')).body.categories
        const category = categories.find((item: any) => item.code === 'grains')
        const bike = categories.find((item: any) => item.code === 'market-hobbies--velo--velosypedy')
        const recommendation = await buyer.post('/api/categories/recommend').send({ title: 'байк' })
        expect(recommendation.body.suggestions.map((item: any) => item.id)).toContain(bike.id)
        expect((await buyer.post('/api/categories/recommend').send({ title: 'квізорп 7842' })).body.suggestions).toEqual([])
        expect((await buyer.post('/api/categories/recommend').send({ title: 'квізорп 7842', attributeHints: ['байк'] })).body.suggestions.map((item: any) => item.id)).toContain(bike.id)
        const definitions = await buyer.get(`/api/categories/${category.id}/attributes`)
        expect(definitions.body.attributes.map((item: any) => item.code)).toContain('grain_type')
        const product = await seller.post('/api/products').send({ categoryId: category.id, title: `Зерно ${suffix}`, quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', attributes: { grain_type: 'Пшениця', harvest_year: 2024 } })
        expect(product.status).toBe(201)
        const id = product.body.product.id
        expect((await buyer.patch(`/api/products/${id}`).send({ attributes: { grain_type: 'Чуже' } })).status).not.toBe(200)
        expect((await seller.patch(`/api/products/${id}`).send({ attributes: { storage: 128 } })).status).toBe(400)
        expect((await seller.patch(`/api/products/${id}`).send({ attributes: { harvest_year: null } })).status).toBe(400)
        expect((await seller.patch(`/api/products/${id}`).send({ attributes: { harvest_year: '' } })).status).toBe(400)
        expect((await seller.patch(`/api/products/${id}`).send({ title: `Зерно нове ${suffix}` })).body.product.attributes).toEqual({ grain_type: 'Пшениця', harvest_year: 2024 })
        const wanted = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: `Запит зерна ${suffix}`, description: 'Потрібен товар', quantity: 10, unit: 'kg', currency: 'UAH', receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers', attributes: { grain_type: 'Жито' } })
        expect(wanted.status).toBe(201)
        const requestId = wanted.body.buyRequest.id
        expect((await buyer.patch(`/api/buy-requests/${requestId}`).send({ title: `Зерно потрібне ${suffix}` })).body.buyRequest.attributes).toEqual({ grain_type: 'Жито' })
        const created = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ requestKey: randomUUID(), creationMode: 'product', productId: id, quantity: 5, unit: 'kg', price: 10, currency: 'UAH', delivery: 'Самовивіз' })
        expect(created.status).toBe(201)
        expect(created.body.offer.attributes).toEqual({ grain_type: 'Пшениця', harvest_year: 2024 })
        const offerId = created.body.offer.id
        const changed = await seller.patch(`/api/offers/${offerId}`).send({ attributes: { grain_type: 'Ячмінь' } })
        expect(changed.status).toBe(200)
        expect((await seller.get(`/api/products/${id}`)).body.product.attributes.grain_type).toBe('Пшениця')
        expect((await buyer.patch(`/api/offers/${offerId}`).send({ attributes: {} })).status).toBe(404)
        const accepted = await buyer.post(`/api/offers/${offerId}/accept`).send({ quantity: 5, expectedRevision: changed.body.offer.revision })
        expect(accepted.status).toBe(201)
        expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE offer_id=$1', [offerId])).rows[0].conditions_snapshot.attributes).toEqual({ grain_type: 'Ячмінь' })
        expect((await seller.patch(`/api/products/${id}`).send({ attributes: { grain_type: 'Кукурудза' } })).status).toBe(200)
        expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE offer_id=$1', [offerId])).rows[0].conditions_snapshot.attributes).toEqual({ grain_type: 'Ячмінь' })
    }, 60000)
})
