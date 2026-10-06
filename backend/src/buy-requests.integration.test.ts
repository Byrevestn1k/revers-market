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
                const mine = await buyer.get('/api/buy-requests').query({ mine: 'true', page: 1 })
                expect(mine.status).toBe(200)
                expect(mine.body.pagination).toMatchObject({ page: 1 })
                expect(mine.body.buyRequests.map((item: { id: string }) => item.id)).toContain(requestId)
                expect(mine.body.buyRequests.find((item: { id: string }) => item.id === requestId).offerCount).toBe(2)
                const publicRequest = (await sellerOne.get('/api/buy-requests')).body.buyRequests.find((item: { id: string }) => item.id === requestId)
                expect(publicRequest.offerCount).toBeUndefined()
                expect((await sellerOne.get('/api/buy-requests').query({ mine: 'true' })).body.buyRequests.map((item: { id: string }) => item.id)).not.toContain(requestId)
                const ownOffers = await sellerOne.get('/api/offers/mine').query({ page: 1 })
                expect(ownOffers.status).toBe(200)
                expect(ownOffers.body.pagination).toMatchObject({ page: 1 })
                expect(ownOffers.body.offers.find((item: { id: string }) => item.id === offerOne.body.offer.id)).toMatchObject({ buyRequestId: requestId, requestTitle: 'Потрібна пшениця', requestStatus: 'open', status: 'submitted' })
                expect((await buyer.get('/api/offers/mine')).body.offers.map((item: { id: string }) => item.id)).not.toContain(offerOne.body.offer.id)
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

        it('keeps seller offer history scoped after requests complete, cancel or expire', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const users = ['b', 's1', 's2'].map((role, index) => ({ username: `history_${role}_${suffix}`, email: `history_${role}_${suffix}@example.com`, countryCode: 'UA', phone: `+380${['50', '63', '67'][index]}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }))
            const [buyer, sellerOne, sellerTwo] = users.map(() => request.agent(createApp()))
            try {
                for (const [index, agent] of [buyer, sellerOne, sellerTwo].entries()) expect((await agent.post('/api/auth/register').send(users[index])).status).toBe(201)
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const createRequest = async (title: string) => {
                    const response = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title, description: 'Лише для перевірки історії', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 100, maxPrice: 200, delivery: 'no', geoArea: 'Київська область', address: 'Приватна адреса покупця' })
                    expect(response.status).toBe(201)
                    return response.body.buyRequest.id as string
                }
                const createOffer = async (agent: typeof sellerOne, requestId: string, quantity = 5) => {
                    const response = await agent.post(`/api/buy-requests/${requestId}/offers`).send({ quantity, unit: 'kg', price: 150, currency: 'UAH', delivery: 'Самовивіз' })
                    expect(response.status).toBe(201)
                    return response.body.offer.id as string
                }
                const activeId = await createRequest('Активний запит')
                const activeOfferId = await createOffer(sellerOne, activeId)
                expect((await sellerOne.patch(`/api/offers/${activeOfferId}`).send({ note: 'Умови активного запиту' })).status).toBe(200)
                const completedId = await createRequest('Виконаний запит')
                const completedOfferId = await createOffer(sellerOne, completedId)
                const selectedOfferId = await createOffer(sellerTwo, completedId, 10)
                const selected = await buyer.post(`/api/offers/${selectedOfferId}/accept`).send({ quantity: 10 })
                expect(selected.status).toBe(201)
                expect((await sellerTwo.post(`/api/orders/${selected.body.order.id}/seller-confirm`)).status).toBe(200)
                expect((await buyer.post(`/api/orders/${selected.body.order.id}/complete`)).status).toBe(200)
                expect((await sellerTwo.post(`/api/orders/${selected.body.order.id}/complete`)).status).toBe(200)
                expect((await buyer.get(`/api/buy-requests/${completedId}`)).body.buyRequest.status).toBe('completed')
                const completedEdit = await sellerOne.patch(`/api/offers/${completedOfferId}`).send({ note: 'Запізніла зміна' })
                expect(completedEdit.status).toBe(409)
                expect(completedEdit.body.error).toBe('BUY_REQUEST_CLOSED')
                const cancelledId = await createRequest('Скасований запит')
                const cancelledOfferId = await createOffer(sellerOne, cancelledId)
                expect((await buyer.patch(`/api/buy-requests/${cancelledId}`).send({ status: 'cancelled' })).status).toBe(200)
                const cancelledEdit = await sellerOne.patch(`/api/offers/${cancelledOfferId}`).send({ note: 'Запізніла зміна' })
                expect(cancelledEdit.status).toBe(409)
                expect(cancelledEdit.body.error).toBe('BUY_REQUEST_CLOSED')
                const expiredId = await createRequest('Прострочений запит')
                const expiredOfferId = await createOffer(sellerOne, expiredId)
                expect((await buyer.patch(`/api/buy-requests/${expiredId}`).send({ status: 'expired' })).status).toBe(200)
                const expiredEdit = await sellerOne.patch(`/api/offers/${expiredOfferId}`).send({ note: 'Запізніла зміна' })
                expect(expiredEdit.status).toBe(409)
                expect(expiredEdit.body.error).toBe('BUY_REQUEST_CLOSED')

                const mine = await sellerOne.get('/api/offers/mine')
                expect(mine.status).toBe(200)
                const byId = new Map(mine.body.offers.map((offer: { id: string }) => [offer.id, offer]))
                for (const [id, title, requestStatus] of [
                    [activeOfferId, 'Активний запит', 'open'],
                    [completedOfferId, 'Виконаний запит', 'completed'],
                    [cancelledOfferId, 'Скасований запит', 'cancelled'],
                    [expiredOfferId, 'Прострочений запит', 'expired'],
                ]) {
                    expect(byId.get(id)).toMatchObject({ id, status: 'submitted', requestTitle: title, requestStatus })
                    expect(byId.get(id)).not.toHaveProperty('requestDescription')
                    expect(byId.get(id)).not.toHaveProperty('address')
                    expect(byId.get(id)).not.toHaveProperty('buyer')
                }
                expect((await sellerTwo.get('/api/offers/mine')).body.offers.map((offer: { id: string }) => offer.id)).not.toContain(cancelledOfferId)
                expect((await sellerTwo.get(`/api/buy-requests/${cancelledId}/offers`)).status).toBe(403)
                expect((await sellerOne.get(`/api/buy-requests/${cancelledId}`)).status).toBe(404)
                expect((await sellerTwo.get(`/api/buy-requests/${cancelledId}`)).status).toBe(404)
                expect((await buyer.get(`/api/buy-requests/${cancelledId}`)).status).toBe(200)
                expect((await sellerTwo.get('/api/offers/mine')).body.offers).toContainEqual(expect.objectContaining({ id: selectedOfferId, status: 'accepted', requestStatus: 'completed' }))
            } finally {
                const names = users.map(user => user.username.toLowerCase())
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [names])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [names])
            }
        }, 30000)
    })
} else {
    describe.skip('buy requests and offers HTTP integration (requires DATABASE_URL)', () => { })
}
