import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('direct product deals', () => {
        const app = createApp()
        const buyer = request.agent(app), seller = request.agent(app), outsider = request.agent(app)
        const ids: string[] = []
        let categoryId: string
        beforeAll(async () => {
            for (const [index, agent] of [buyer, seller, outsider].entries()) {
                const name = `direct_${index}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
                const response = await agent.post('/api/auth/register').send({ username: name, email: `${name}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                expect(response.status, JSON.stringify(response.body)).toBe(201)
                ids.push(response.body.user.id)
            }
            categoryId = (await buyer.get('/api/categories')).body.categories.find((c: any) => c.code === 'grains').id
        }, 60000)
        afterAll(async () => {
            await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids])
            await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
        })
        const setup = async () => {
            const p = await seller.post('/api/products').send({ categoryId, title: 'Прямий продаж зерна', quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] })
            expect(p.status, JSON.stringify(p.body)).toBe(201)
            const c = await buyer.post(`/api/products/${p.body.product.id}/conversation`)
            expect(c.status).toBe(201)
            return { productId: p.body.product.id, conversationId: c.body.conversation.id }
        }
        const expected = { expectedCurrency: 'UAH', expectedUnit: 'kg', expectedProductPrice: 20, expectedDeliveryOptions: [{ method: 'SELF_PICKUP' }] }
        const propose = async (conversationId: string, overrides: Record<string, unknown> = {}) => {
            const context = (await buyer.get(`/api/conversations/${conversationId}/direct-proposals`)).body.context
            return buyer.post(`/api/conversations/${conversationId}/direct-proposals`).send({ action: 'propose', requestKey: randomUUID(), parentId: null, price: 19, quantity: 5, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0, ...expected, expectedTermsToken: context.termsToken, ...overrides })
        }
        it('bargains, reserves once, completes and allows mutual reviews', async () => {
            const { productId, conversationId } = await setup()
            const path = `/api/conversations/${conversationId}/direct-proposals`
            const context = (await buyer.get(path)).body.context
            const input = { action: 'propose', requestKey: randomUUID(), parentId: null, price: 19, quantity: 5, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0, ...expected, expectedTermsToken: context.termsToken }
            await pool.query('UPDATE conversation_participants SET deleted_at=now() WHERE conversation_id=$1', [conversationId])
            expect((await buyer.post(`/api/products/${productId}/conversation`)).body.conversation.id).toBe(conversationId)
            const first = await buyer.post(path).send(input)
            expect(first.status, JSON.stringify(first.body)).toBe(200)
            expect((await seller.get(path)).status).toBe(200)
            const notifications = await seller.get('/api/notifications')
            expect(notifications.body.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ directProposalId: first.body.proposal.id, conversationId })]))
            expect((await buyer.post(path).send(input)).body.proposal.id).toBe(first.body.proposal.id)
            expect((await outsider.get(path)).status).toBe(404)
            expect((await outsider.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).status).toBe(404)
            expect((await seller.post(path).send({ action: ['withdraw'], proposalId: first.body.proposal.id })).status).toBe(400)
            expect((await buyer.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).status).toBe(403)
            const counter = await seller.post(path).send({ ...input, requestKey: randomUUID(), parentId: first.body.proposal.id, price: 18 })
            expect(counter.status).toBe(200)
            expect((await pool.query('SELECT count(*)::int AS count FROM orders WHERE buyer_id=$1 AND seller_id=$2', [ids[0], ids[1]])).rows[0].count).toBe(0)
            expect((await seller.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).status).toBe(409)
            const accepted = await buyer.post(path).send({ action: 'accept', proposalId: counter.body.proposal.id })
            expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
            const id = accepted.body.orderId
            expect((await buyer.post(path).send({ action: 'accept', proposalId: counter.body.proposal.id })).body.orderId).toBe(id)
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('5.000')
            expect((await seller.patch(`/api/products/${productId}`).send({ unit: 'piece' })).status).toBe(409)
            expect((await buyer.get(`/api/orders/${id}`)).body.order).toMatchObject({ source: 'direct_product', status: 'in_progress' })
            const snapshot = (await buyer.get(`/api/orders/${id}`)).body.order.conditionsSnapshot
            expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Нова назва після угоди', price: 42 })).status).toBe(200)
            expect((await buyer.get(`/api/orders/${id}`)).body.order.conditionsSnapshot).toEqual(snapshot)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({ rating: 12 })).status).toBe(409)
            await pool.query('UPDATE conversation_participants SET deleted_at=now() WHERE conversation_id=$1 AND user_id=$2', [conversationId, ids[1]])
            expect((await buyer.post(`/api/orders/${id}/complete`).send({})).status).toBe(200)
            expect((await buyer.post(`/api/orders/${id}/complete`).send({})).status).toBe(200)
            expect((await outsider.post(`/api/orders/${id}/complete`).send({})).status).toBe(403)
            expect((await seller.get(path)).status).toBe(200)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({ rating: 12 })).status).toBe(409)
            expect((await buyer.patch(`/api/orders/${id}/status`).send({ status: 'cancelled', reason: 'Передумав купувати' })).status).toBe(409)
            expect((await seller.post(`/api/orders/${id}/complete`).send({})).status).toBe(200)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({ rating: 12 })).status).toBe(201)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({ rating: 12 })).status).toBe(409)
            expect((await outsider.post(`/api/orders/${id}/reviews`).send({ rating: 12 })).status).toBe(403)
            expect((await seller.post(`/api/orders/${id}/reviews`).send({ rating: 10 })).status).toBe(201)
            expect((await pool.query('SELECT quantity,reserved_quantity FROM products WHERE id=$1', [productId])).rows[0]).toMatchObject({ quantity: '5.000', reserved_quantity: '0.000' })
        }, 60000)
        it('rejects stale terms, unsupported delivery and releases cancelled stock', async () => {
            const { productId, conversationId } = await setup()
            expect((await propose(conversationId, { delivery: 'POSTAL_DELIVERY', postalOperator: 'NOVA_POSHTA' })).status).toBe(400)
            const first = await propose(conversationId)
            expect(first.status).toBe(200)
            expect((await seller.patch(`/api/products/${productId}`).send({ price: 30 })).status).toBe(200)
            const path = `/api/conversations/${conversationId}/direct-proposals`
            expect((await seller.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).body.error).toBe('TERMS_CHANGED')
            const context = (await seller.get(path)).body.context
            const counter = await seller.post(path).send({ action: 'propose', requestKey: randomUUID(), parentId: first.body.proposal.id, price: 30, quantity: 5, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0, ...expected, expectedProductPrice: 30, expectedTermsToken: context.termsToken })
            const accepted = await buyer.post(path).send({ action: 'accept', proposalId: counter.body.proposal.id })
            expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
            expect((await buyer.patch(`/api/orders/${accepted.body.orderId}/status`).send({ status: 'cancelled', reason: 'Передумав купувати' })).status).toBe(200)
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('0.000')
        }, 60000)
        it('limits concurrent buyers and preserves an open dispute reservation', async () => {
            const { productId, conversationId } = await setup()
            const otherChat = await outsider.post(`/api/products/${productId}/conversation`)
            expect(otherChat.status).toBe(201)
            const otherId = otherChat.body.conversation.id
            const context = (await outsider.get(`/api/conversations/${otherId}/direct-proposals`)).body.context
            const first = await propose(conversationId, { quantity: 7 })
            const other = await outsider.post(`/api/conversations/${otherId}/direct-proposals`).send({ action: 'propose', requestKey: randomUUID(), parentId: null, price: 19, quantity: 7, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0, ...expected, expectedTermsToken: context.termsToken })
            const results = await Promise.all([
                seller.post(`/api/conversations/${conversationId}/direct-proposals`).send({ action: 'accept', proposalId: first.body.proposal.id }),
                seller.post(`/api/conversations/${otherId}/direct-proposals`).send({ action: 'accept', proposalId: other.body.proposal.id }),
            ])
            expect(results.map(r => r.status).sort()).toEqual([200, 409])
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('7.000')
            const accepted = results.find(r => r.status === 200)!
            const orderId = accepted.body.orderId
            expect((await seller.post(`/api/orders/${orderId}/dispute`).send({ reason: 'Проблема з доставкою' })).status).toBe(200)
            expect((await seller.patch(`/api/orders/${orderId}/status`).send({ status: 'cancelled', reason: 'Передумав продавати' })).status).toBe(409)
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('7.000')
        }, 60000)
        it('validates minimum precision and product state seen by the buyer', async () => {
            const { productId, conversationId } = await setup()
            expect((await buyer.get('/api/conversations/not-a-uuid/direct-proposals')).status).toBe(400)
            const context = (await buyer.get(`/api/conversations/${conversationId}/direct-proposals`)).body.context
            expect((await propose(conversationId, { price: 1.2345000001 })).status).toBe(400)
            expect((await propose(conversationId, { quantity: 0 })).status).toBe(400)
            expect((await propose(conversationId, { quantity: 0.0004 })).status).toBe(400)
            expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Змінений товар зерна' })).status).toBe(200)
            expect((await propose(conversationId, { expectedTermsToken: context.termsToken })).body.error).toBe('TERMS_CHANGED')
            await pool.query('UPDATE products SET quantity=1.001,reserved_quantity=1 WHERE id=$1', [productId])
            const current = (await buyer.get(`/api/conversations/${conversationId}/direct-proposals`)).body.context
            expect(current.remaining).toBe(0.001)
            expect((await propose(conversationId, { quantity: 0.001 })).status).toBe(200)
        }, 60000)
        it('rejects self-purchase, withdrawn and declined proposals and inactive products', async () => {
            const { productId, conversationId } = await setup()
            expect((await seller.post(`/api/products/${productId}/conversation`)).status).toBe(404)
            const path = `/api/conversations/${conversationId}/direct-proposals`
            const first = await propose(conversationId)
            expect((await buyer.post(path).send({ action: 'withdraw', proposalId: first.body.proposal.id })).status).toBe(200)
            expect((await seller.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).status).toBe(409)
            const second = await propose(conversationId, { parentId: first.body.proposal.id })
            expect((await seller.post(path).send({ action: 'reject', proposalId: second.body.proposal.id })).status).toBe(200)
            expect((await seller.post(path).send({ action: 'accept', proposalId: second.body.proposal.id })).status).toBe(409)
            const third = await propose(conversationId, { parentId: second.body.proposal.id })
            expect((await seller.patch(`/api/products/${productId}`).send({ status: 'paused' })).status).toBe(200)
            expect((await seller.post(path).send({ action: 'accept', proposalId: third.body.proposal.id })).status).toBe(409)
        }, 60000)
        it('shares stock reservations with request-based deals', async () => {
            const { productId, conversationId } = await setup()
            const direct = await propose(conversationId, { quantity: 7 })
            const created = await outsider.post('/api/buy-requests').send({ categoryId, title: 'Тест спільного залишку', description: 'Потрібен товар', quantity: 7, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 30, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Київ', fulfillmentMode: 'multiple_sellers' })
            expect(created.status, JSON.stringify(created.body)).toBe(201)
            const offer = await seller.post(`/api/buy-requests/${created.body.buyRequest.id}/offers`).send({ creationMode: 'product', productId, quantity: 7, unit: 'kg', price: 20, currency: 'UAH', delivery: 'Самовивіз' })
            expect(offer.status, JSON.stringify(offer.body)).toBe(201)
            const [reverse, directResult] = await Promise.all([
                outsider.post(`/api/offers/${offer.body.offer.id}/accept`).send({ quantity: 7 }),
                seller.post(`/api/conversations/${conversationId}/direct-proposals`).send({ action: 'accept', proposalId: direct.body.proposal.id }),
            ])
            expect([reverse.status, directResult.status].sort()).toEqual(reverse.status === 201 ? [201, 409] : [200, 409])
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('7.000')
        }, 60000)
        it('does not delete a product concurrently with a newly accepted deal', async () => {
            const { productId, conversationId } = await setup()
            const proposal = await propose(conversationId)
            const [acceptance, deletion] = await Promise.all([
                seller.post(`/api/conversations/${conversationId}/direct-proposals`).send({ action: 'accept', proposalId: proposal.body.proposal.id }),
                seller.delete(`/api/products/${productId}`),
            ])
            if (acceptance.status === 200) {
                expect(deletion.status).toBe(409)
                expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('5.000')
            } else {
                expect(deletion.status).toBe(204)
                expect([403, 404, 409]).toContain(acceptance.status)
                expect((await pool.query('SELECT count(*)::int AS count FROM order_items WHERE product_id=$1', [productId])).rows[0].count).toBe(0)
            }
        }, 60000)
        it('serializes repeated acceptance and rejects changed delivery', async () => {
            const { productId, conversationId } = await setup()
            const path = `/api/conversations/${conversationId}/direct-proposals`
            const first = await propose(conversationId)
            expect((await seller.patch(`/api/products/${productId}`).send({ deliveryMode: 'flexible', deliveryOptions: [{ method: 'FLEXIBLE' }] })).status).toBe(200)
            expect((await seller.post(path).send({ action: 'accept', proposalId: first.body.proposal.id })).body.error).toBe('TERMS_CHANGED')
            const context = (await seller.get(path)).body.context
            const counter = await seller.post(path).send({ action: 'propose', requestKey: randomUUID(), parentId: first.body.proposal.id, price: 19, quantity: 5, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions, expectedTermsToken: context.termsToken })
            expect(counter.status, JSON.stringify(counter.body)).toBe(200)
            const answers = await Promise.all([0, 1].map(() => buyer.post(path).send({ action: 'accept', proposalId: counter.body.proposal.id })))
            expect(answers.map(answer => answer.status)).toEqual([200, 200])
            expect(answers[0].body.orderId).toBe(answers[1].body.orderId)
            expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('5.000')
        }, 60000)
        it('requires the postal operator explicitly supported by the product', async () => {
            const created = await seller.post('/api/products').send({ categoryId, title: 'Тест поштового оператора', quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'carrier', deliveryOptions: [{ method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] }], geoZone: 'Київ', status: 'active', photos: [] })
            expect(created.status, JSON.stringify(created.body)).toBe(201)
            const chat = await buyer.post(`/api/products/${created.body.product.id}/conversation`)
            const path = `/api/conversations/${chat.body.conversation.id}/direct-proposals`
            const context = (await buyer.get(path)).body.context
            const input = { action: 'propose', parentId: null, price: 20, quantity: 2, delivery: 'POSTAL_DELIVERY', deliveryPrice: 0, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions, expectedTermsToken: context.termsToken }
            expect((await buyer.post(path).send({ ...input, requestKey: randomUUID(), postalOperator: 'UKRPOSHTA' })).status).toBe(400)
            const proposal = await buyer.post(path).send({ ...input, requestKey: randomUUID(), postalOperator: 'NOVA_POSHTA' })
            expect(proposal.status, JSON.stringify(proposal.body)).toBe(200)
            const accepted = await seller.post(path).send({ action: 'accept', proposalId: proposal.body.proposal.id })
            expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
            expect((await buyer.get(`/api/orders/${accepted.body.orderId}`)).body.order.conditionsSnapshot.delivery.postalOperator).toBe('NOVA_POSHTA')
        }, 60000)
        it('does not infer postal operators from legacy missing terms', async () => {
            const created = await seller.post('/api/products').send({ categoryId, title: 'Тест старої поштової доставки', quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'carrier', deliveryOptions: [{ method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] }], geoZone: 'Київ', status: 'active', photos: [] })
            expect(created.status, JSON.stringify(created.body)).toBe(201)
            await pool.query('UPDATE products SET delivery_options=NULL WHERE id=$1', [created.body.product.id])
            const chat = await buyer.post(`/api/products/${created.body.product.id}/conversation`)
            const path = `/api/conversations/${chat.body.conversation.id}/direct-proposals`
            const context = (await buyer.get(path)).body.context
            const result = await buyer.post(path).send({ action: 'propose', requestKey: randomUUID(), parentId: null, price: 20, quantity: 2, delivery: 'POSTAL_DELIVERY', postalOperator: 'NOVA_POSHTA', deliveryPrice: 0, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions, expectedTermsToken: context.termsToken })
            expect(result.status).toBe(400)
        }, 60000)
    })
}
