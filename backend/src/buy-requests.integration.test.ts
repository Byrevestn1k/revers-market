import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('buy requests and offers HTTP integration', () => {
        it('keeps product terms unchanged and supports several partial deals', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const buyerPayload = { username: `buyer_${suffix}`, email: `buyer_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const sellerOnePayload = { username: `seller_one_${suffix}`, email: `seller_one_${suffix}@example.com`, countryCode: 'PL', phone: `+4850${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const sellerTwoPayload = { username: `seller_two_${suffix}`, email: `seller_two_${suffix}@example.com`, countryCode: 'DE', phone: `+49150${suffix.slice(-7)}`, password: 'ThirdPassword3', passwordConfirmation: 'ThirdPassword3' }
            const buyer = request.agent(createApp())
            const sellerOne = request.agent(createApp())
            const sellerTwo = request.agent(createApp())
            try {
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                expect((await sellerOne.post('/api/auth/register').send(sellerOnePayload)).status).toBe(201)
                expect((await sellerTwo.post('/api/auth/register').send(sellerTwoPayload)).status).toBe(201)
                const category = (await sellerOne.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await sellerOne.post('/api/products').send({ categoryId: category.id, title: 'Базова пшениця', description: 'Базові умови', quantity: 1000, unit: 'kg', price: 250, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active' })
                expect(product.status).toBe(201)
                const baseProduct = product.body.product
                const created = await buyer.post('/api/buy-requests').send({ categoryId: category.id, productId: baseProduct.id, title: 'Потрібна пшениця', description: 'Для двох складів', quantity: 500, unit: 'kg', currency: 'UAH', minPrice: 200, maxPrice: 260, delivery: 'preferred', preferredDelivery: 'До складу', geoArea: 'Київська область', address: 'Приватна адреса', deadline: '2030-01-01T00:00:00.000Z' })
                expect(created.status).toBe(201)
                const requestId = created.body.buyRequest.id
                expect((await sellerOne.patch(`/api/buy-requests/${requestId}`).send({ title: 'Чужа зміна' })).status).toBe(404)
                const offerOne = await sellerOne.post(`/api/buy-requests/${requestId}/offers`).send({ productId: baseProduct.id, quantity: 300, unit: 'kg', price: 240, currency: 'UAH', delivery: 'Доставка до складу', note: 'Умова A', additionalPhotoUrl: 'https://cdn.example.com/offer-a.jpg' })
                const offerTwo = await sellerTwo.post(`/api/buy-requests/${requestId}/offers`).send({ quantity: 200, unit: 'kg', price: 245, currency: 'UAH', delivery: 'Самовивіз', note: 'Умова B' })
                expect(offerOne.status).toBe(201)
                expect(offerTwo.status).toBe(201)
                expect(offerOne.body.offer).toMatchObject({ quantity: 300, price: { amount: 240 }, note: 'Умова A' })
                expect(offerTwo.body.offer).toMatchObject({ quantity: 200, price: { amount: 245 }, note: 'Умова B' })
                expect(offerOne.body.offer.price).not.toEqual(offerTwo.body.offer.price)
                expect((await buyer.get(`/api/buy-requests/${requestId}/offers`)).body.offers).toHaveLength(2)
                const dealOne = await buyer.post(`/api/offers/${offerOne.body.offer.id}/accept`).send({ quantity: 300 })
                const dealTwo = await buyer.post(`/api/offers/${offerTwo.body.offer.id}/accept`).send({ quantity: 100 })
                expect(dealOne.status).toBe(201)
                expect(dealTwo.status).toBe(201)
                expect((await buyer.get(`/api/buy-requests/${requestId}`)).body.buyRequest).toMatchObject({ quantity: 500, selectedQuantity: 400, completedQuantity: 0, remainingQuantity: 100, status: 'partially_selected' })
                expect((await sellerOne.post(`/api/orders/${dealOne.body.order.id}/seller-confirm`)).status).toBe(200)
                expect((await buyer.post(`/api/orders/${dealOne.body.order.id}/complete`)).status).toBe(200)
                expect((await sellerOne.post(`/api/orders/${dealOne.body.order.id}/complete`)).status).toBe(200)
                expect((await buyer.get(`/api/buy-requests/${requestId}`)).body.buyRequest).toMatchObject({ selectedQuantity: 100, completedQuantity: 300, remainingQuantity: 100, status: 'partially_selected' })
                expect((await buyer.post(`/api/orders/${dealTwo.body.order.id}/fail`).send({ reason: 'SELLER_NOT_RESPONDING' })).status).toBe(200)
                expect((await buyer.get(`/api/buy-requests/${requestId}`)).body.buyRequest).toMatchObject({ selectedQuantity: 0, completedQuantity: 300, remainingQuantity: 200, status: 'partially_completed' })
                expect((await sellerOne.get(`/api/buy-requests/${requestId}/offers`)).body.offers[0].acceptedQuantity).toBe(300)
                const unchangedProduct = (await sellerOne.get(`/api/products/${baseProduct.id}`)).body.product
                expect(unchangedProduct).toMatchObject({ id: baseProduct.id, title: 'Базова пшениця', quantity: 700, unit: 'kg', price: { amount: 250, currency: 'UAH' } })
                expect(unchangedProduct).toEqual(expect.objectContaining({ description: baseProduct.description, deliveryMode: baseProduct.deliveryMode, geoZone: baseProduct.geoZone }))
                const singleRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Потрібен один продавець', description: '', quantity: 100, unit: 'kg', currency: 'UAH', minPrice: 200, maxPrice: 260, delivery: 'no', geoArea: 'Київська область', fulfillmentMode: 'single_seller' })
                expect(singleRequest.status).toBe(201)
                const smallOffer = await sellerOne.post(`/api/buy-requests/${singleRequest.body.buyRequest.id}/offers`).send({ quantity: 60, unit: 'kg', price: 240, currency: 'UAH', delivery: 'Самовивіз' })
                const fullOffer = await sellerTwo.post(`/api/buy-requests/${singleRequest.body.buyRequest.id}/offers`).send({ quantity: 100, unit: 'kg', price: 245, currency: 'UAH', delivery: 'Самовивіз' })
                expect((await buyer.post(`/api/offers/${smallOffer.body.offer.id}/accept`).send({})).status).toBe(409)
                const selectedSingle = await buyer.post(`/api/offers/${fullOffer.body.offer.id}/accept`).send({})
                expect(selectedSingle.status).toBe(201)
                expect(selectedSingle.body.order).toMatchObject({ quantity: 100, status: 'selected' })
            } finally {
                await pool.query(
                    `DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))
                     OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))`,
                    [[buyerPayload.username.toLowerCase(), sellerOnePayload.username.toLowerCase(), sellerTwoPayload.username.toLowerCase()]],
                )
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2, $3)', [buyerPayload.username.toLowerCase(), sellerOnePayload.username.toLowerCase(), sellerTwoPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('buy requests and offers HTTP integration (requires DATABASE_URL)', () => { })
}
