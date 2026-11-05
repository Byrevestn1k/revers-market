import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    describe('step 27 profile chat and personal history', () => {
        const app = createApp()
        const agents = [request.agent(app), request.agent(app), request.agent(app)]
        const ids: string[] = []
        let chatId: string
        beforeAll(async () => {
            for (const agent of agents) {
                const name = `chat_${randomUUID().replaceAll('-', '').slice(0, 16)}`
                const response = await agent.post('/api/auth/register').send({ username: name, email: `${name}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                expect(response.status, JSON.stringify(response.body)).toBe(201)
                ids.push(response.body.user.id)
            }
        }, 60000)
        afterAll(async () => {
            await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids])
            await pool.query('DELETE FROM conversations WHERE profile_user_low = ANY($1::uuid[]) OR profile_user_high = ANY($1::uuid[])', [ids])
            await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
        })
        it('creates one profile chat for concurrent requests and protects access', async () => {
            expect((await agents[0].post(`/api/users/${ids[0]}/conversation`)).status).toBe(400)
            const results = await Promise.all(Array.from({ length: 4 }, () => agents[0].post(`/api/users/${ids[1]}/conversation`)))
            expect(results.map(result => result.status).sort()).toEqual([200, 200, 200, 201])
            chatId = results[0].body.conversation.id
            expect(new Set(results.map(result => result.body.conversation.id)).size).toBe(1)
            expect((await agents[1].post(`/api/users/${ids[0]}/conversation`)).body.conversation.id).toBe(chatId)
            expect((await agents[0].get('/api/conversations')).body.conversations.find((item: any) => item.id === chatId).contextKind).toBe('direct')
            expect((await agents[2].get(`/api/conversations/${chatId}/messages`)).status).toBe(404)
            expect((await agents[2].get('/api/conversations')).body.conversations.some((item: any) => item.id === chatId)).toBe(false)
            expect((await agents[2].patch(`/api/conversations/${chatId}/read`)).status).toBe(404)
            expect((await agents[2].patch(`/api/conversations/${chatId}/archived`).send({ archived: true })).status).toBe(404)
            expect((await agents[2].delete(`/api/conversations/${chatId}/personal`)).status).toBe(404)
            expect((await agents[2].post(`/api/conversations/${chatId}/messages`).send({ body: 'outside' })).status).toBe(404)
        }, 60000)
        it('classifies a product chat independently of its legacy type and leaves unknown history unclassified', async () => {
            const categories = (await agents[1].get('/api/categories')).body.categories
            const product = await agents[1].post('/api/products').send({ categoryId: categories.find((item: any) => item.code === 'grains').id, title: 'Товар для перевірки чату', quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] })
            expect(product.status).toBe(201)
            const starts = await Promise.all([agents[0].post(`/api/products/${product.body.product.id}/conversation`), agents[0].post(`/api/products/${product.body.product.id}/conversation`)])
            expect(starts[0].body.conversation.id).toBe(starts[1].body.conversation.id)
            const unknown = (await pool.query('INSERT INTO conversations DEFAULT VALUES RETURNING id')).rows[0].id
            await pool.query("INSERT INTO conversation_participants (conversation_id,user_id,role) VALUES ($1,$2,'buyer'),($1,$3,'seller')", [unknown, ids[0], ids[1]])
            const rows = (await agents[0].get('/api/conversations')).body.conversations
            expect(rows.find((item: any) => item.id === starts[0].body.conversation.id)).toMatchObject({ type: 'direct', contextKind: 'product', userRole: 'buying' })
            expect(Number(rows.find((item: any) => item.id === starts[0].body.conversation.id).quantity)).toBe(10)
            expect(rows.find((item: any) => item.id === unknown).contextKind).toBe('unknown')
            await pool.query('DELETE FROM conversations WHERE id=$1', [unknown])
        }, 60000)
        it('keeps request, offer and reused deal chats contextual for both roles', async () => {
            const categoryId = (await agents[0].get('/api/categories')).body.categories.find((item: any) => item.code === 'grains').id
            const created = await agents[0].post('/api/buy-requests').send({ categoryId, title: 'Запит на зерно для чату', description: '', delivery: 'no', minPrice: 0, maxPrice: 150, quantity: 10, unit: 'kg', currency: 'UAH', geoArea: 'Київська область', fulfillmentMode: 'multiple_sellers' })
            expect(created.status).toBe(201)
            const requestId = created.body.buyRequest.id
            const requestChat = await agents[1].post(`/api/buy-requests/${requestId}/conversation`)
            expect(requestChat.status).toBe(201)
            const offer = await agents[1].post(`/api/buy-requests/${requestId}/offers`).send({ quantity: 10, unit: 'kg', price: 145, currency: 'UAH', delivery: 'Самовивіз' })
            expect(offer.status).toBe(201)
            const offerId = offer.body.offer.id
            const offerChat = await agents[0].post(`/api/offers/${offerId}/conversation`)
            expect(offerChat.status).toBe(201)
            const selected = await agents[0].post(`/api/offers/${offerId}/accept`).send({ quantity: 5, selectionKey: randomUUID() })
            expect(selected.status, JSON.stringify(selected.body)).toBe(201)
            const offerChatId = offerChat.body.conversation.id
            expect((await agents[0].get(`/api/orders/${selected.body.order.id}/conversation`)).body.conversation.id).toBe(offerChatId)
            const beforeDelete = (await agents[1].get(`/api/conversations/${offerChatId}/messages`)).body.messages.length
            expect(beforeDelete).toBeGreaterThan(0)
            expect((await agents[0].patch(`/api/conversations/${offerChatId}/archived`).send({ archived: true })).status).toBe(200)
            expect((await agents[0].delete(`/api/conversations/${offerChatId}/personal`)).status).toBe(200)
            expect((await agents[0].get(`/api/orders/${selected.body.order.id}/conversation`)).body.conversation.id).toBe(offerChatId)
            expect((await agents[0].get(`/api/conversations/${offerChatId}/messages`)).body.messages).toHaveLength(0)
            expect((await agents[1].get(`/api/conversations/${offerChatId}/messages`)).body.messages).toHaveLength(beforeDelete)
            for (const [index, role] of [[0, 'buying'], [1, 'selling']] as const) {
                const rows = (await agents[index].get('/api/conversations')).body.conversations
                expect(rows.find((item: any) => item.id === requestChat.body.conversation.id)).toMatchObject({ contextKind: 'request', userRole: role })
                const offerRow = rows.find((item: any) => item.id === offerChat.body.conversation.id)
                expect(offerRow).toMatchObject({ contextKind: 'offer', userRole: role, unit: 'kg' })
                expect(Number(offerRow.price)).toBe(145)
                expect(Number(offerRow.quantity)).toBe(10)
            }
        }, 60000)
        it('restores a deleted conversation without exposing its earlier messages', async () => {
            const path = `/api/conversations/${chatId}`
            expect((await agents[1].post(`${path}/messages`).send({ body: 'before deletion' })).status).toBe(201)
            expect((await agents[0].patch(`${path}/archived`).send({ archived: true })).status).toBe(200)
            expect((await agents[0].delete(`${path}/personal`)).status).toBe(200)
            expect((await agents[0].get(`${path}/messages`)).status).toBe(404)
            expect((await agents[1].post(`${path}/messages`).send({ body: 'after deletion' })).status).toBe(201)
            const messages = (await agents[0].get(`${path}/messages`)).body.messages
            expect(messages.map((item: any) => item.body)).toEqual(['after deletion'])
            expect((await agents[1].get(`${path}/messages`)).body.messages.map((item: any) => item.body)).toEqual(['before deletion', 'after deletion'])
            const row = (await agents[0].get('/api/conversations')).body.conversations.find((item: any) => item.id === chatId)
            expect(row).toMatchObject({ lastMessage: 'after deletion', unreadCount: 1 })
            expect((await agents[0].patch(`${path}/read`)).status).toBe(200)
            expect((await agents[0].get('/api/conversations')).body.conversations.find((item: any) => item.id === chatId).unreadCount).toBe(0)
        })
        it('keeps archive and saved flags when a message arrives', async () => {
            const path = `/api/conversations/${chatId}`
            await agents[0].patch(`${path}/pinned`).send({ pinned: true })
            await agents[0].patch(`${path}/archived`).send({ archived: true })
            await agents[1].post(`${path}/messages`).send({ body: 'archived' })
            const row = (await agents[0].get('/api/conversations')).body.conversations.find((item: any) => item.id === chatId)
            expect(row.pinnedAt).toBeTruthy()
            expect(row.archivedAt).toBeTruthy()
            expect((await agents[0].patch(`${path}/archived`).send({ archived: false })).status).toBe(200)
        })
        it('replays a retry key without sending a second message or notification', async () => {
            const path = `/api/conversations/${chatId}/messages`
            const requestKey = randomUUID()
            const results = await Promise.all([
                agents[1].post(path).send({ body: 'retry-safe', requestKey }),
                agents[1].post(path).send({ body: 'retry-safe', requestKey }),
            ])
            expect(results.map(result => result.status).sort()).toEqual([200, 201])
            expect(results[0].body.message.id).toBe(results[1].body.message.id)
            expect((await agents[1].post(path).send({ body: 'different', requestKey })).status).toBe(409)
            expect((await agents[0].get(path)).body.messages.filter((item: any) => item.body === 'retry-safe')).toHaveLength(1)
            expect((await pool.query("SELECT count(*)::int AS count FROM notifications WHERE conversation_id=$1 AND body='retry-safe'", [chatId])).rows[0].count).toBe(1)
        })
        it('serializes an incoming message against personal deletion', async () => {
            const path = `/api/conversations/${chatId}`
            await agents[1].post(`${path}/messages`).send({ body: 'before concurrent deletion' })
            await agents[0].patch(`${path}/archived`).send({ archived: true })
            const [deleted, sent] = await Promise.all([
                agents[0].delete(`${path}/personal`),
                agents[1].post(`${path}/messages`).send({ body: 'during concurrent deletion' }),
            ])
            expect(deleted.status).toBe(200)
            expect(sent.status).toBe(201)
            expect((await agents[1].post(`${path}/messages`).send({ body: 'after concurrent deletion' })).status).toBe(201)
            const personal = (await agents[0].get(`${path}/messages`)).body.messages.map((item: any) => item.body)
            expect(personal).not.toContain('before concurrent deletion')
            expect(personal).toContain('after concurrent deletion')
            const counterpart = (await agents[1].get(`${path}/messages`)).body.messages.map((item: any) => item.body)
            expect(counterpart).toEqual(expect.arrayContaining(['before concurrent deletion', 'during concurrent deletion', 'after concurrent deletion']))
        })
        it('keeps a concurrent restore and incoming message consistent', async () => {
            const path = `/api/conversations/${chatId}`
            await agents[0].patch(`${path}/archived`).send({ archived: true })
            const [restore, incoming] = await Promise.all([
                agents[0].patch(`${path}/archived`).send({ archived: false }),
                agents[1].post(`${path}/messages`).send({ body: 'during restore' }),
            ])
            expect(restore.status).toBe(200)
            expect(incoming.status).toBe(201)
            const row = (await agents[0].get('/api/conversations')).body.conversations.find((item: any) => item.id === chatId)
            expect(row.archivedAt).toBeNull()
            expect(row.lastMessage).toBe('during restore')
        })
        it('honours the existing block policy for profile chat and sending', async () => {
            expect((await agents[0].post(`/api/users/${ids[1]}/block`)).status).toBe(204)
            expect((await agents[1].post(`/api/users/${ids[0]}/conversation`)).status).toBe(403)
            expect((await agents[1].post(`/api/conversations/${chatId}/messages`).send({ body: 'blocked' })).status).toBe(403)
            expect((await agents[0].delete(`/api/users/${ids[1]}/block`)).status).toBe(204)
        })
    })
}
