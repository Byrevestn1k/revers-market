import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

const hasDatabase = Boolean(process.env.DATABASE_URL)
if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    const { publishDueReviews } = await import('./community-service.js')
    describe('buyer and seller agreement lifecycle', () => {
        const app = createApp()
        const buyer = request.agent(app), seller = request.agent(app), outsider = request.agent(app)
        const ids: string[] = [], names: string[] = []
        let categoryId: string
        beforeAll(async () => {
            for (const [index, agent] of [buyer, seller, outsider].entries()) {
                const suffix = randomUUID().replaceAll('-','').slice(0,12)
                const username = `deal_${index}_${suffix}`
                const response = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random()*1e7)).padStart(7,'0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                expect(response.status, JSON.stringify(response.body)).toBe(201)
                ids.push(response.body.user.id); names.push(username)
            }
            categoryId = (await buyer.get('/api/categories')).body.categories.find((c: any) => c.code === 'grains').id
        }, 60000)
        afterAll(async () => {
            await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids])
            await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
        })
        const setup = async (quantity = 100, mode = 'multiple_sellers', stock = false) => {
            let productId: string | undefined
            if (stock) {
                const product = await seller.post('/api/products').send({ categoryId, title: 'Мед для перевірки', description: '', quantity: 100, unit: 'kg', price: 145, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active' })
                expect(product.status).toBe(201); productId = product.body.product.id
            }
            const created = await buyer.post('/api/buy-requests').send({ categoryId, title: 'Потрібен мед', description: '', delivery: 'no', minPrice: 0, maxPrice: 150, quantity, unit: 'kg', currency: 'UAH', geoArea: 'Київська область', fulfillmentMode: mode })
            expect(created.status, JSON.stringify(created.body)).toBe(201)
            const rid = created.body.buyRequest.id
            const offer = await seller.post(`/api/buy-requests/${rid}/offers`).send({ productId, quantity, unit: 'kg', price: 145, currency: 'UAH', delivery: 'Самовивіз' })
            expect(offer.status, JSON.stringify(offer.body)).toBe(201)
            return { rid, oid: offer.body.offer.id, productId }
        }
        const select = async (oid: string, quantity: number) => {
            const response = await buyer.post(`/api/offers/${oid}/accept`).send({ quantity, selectionKey: randomUUID() })
            expect(response.status, JSON.stringify(response.body)).toBe(201)
            return response.body.order.id as string
        }
        const complete = async (id: string, quantity?: number) => {
            expect((await seller.post(`/api/orders/${id}/seller-confirm`)).status).toBe(200)
            expect((await buyer.post(`/api/orders/${id}/complete`).send(quantity ? { actualQuantity: quantity } : {})).status).toBe(200)
            expect((await seller.post(`/api/orders/${id}/complete`)).status).toBe(200)
        }
        it('keeps one conversation through bargaining, selection and partial completion; snapshots agreed terms', async () => {
            const { rid, oid, productId } = await setup(100, 'multiple_sellers', true)
            const chats = await Promise.all([buyer.post(`/api/offers/${oid}/conversation`), seller.post(`/api/offers/${oid}/conversation`)])
            expect(chats.every(r => [200,201].includes(r.status))).toBe(true)
            const cid = chats[0].body.conversation.id
            expect(chats[1].body.conversation.id).toBe(cid)
            expect((await pool.query('SELECT id FROM orders WHERE offer_id=$1',[oid])).rowCount).toBe(0)
            expect((await buyer.post(`/api/conversations/${cid}/messages`).send({body:'Чи можете зробити дешевше?'})).status).toBe(201)
            const first = await buyer.post(`/api/conversations/${cid}/negotiations`).send({price:135,quantity:30})
            expect(first.status, JSON.stringify(first.body)).toBe(200)
            expect((await buyer.post(`/api/conversations/${cid}/negotiations`).send({action:'accept',proposalId:first.body.proposal.id})).status).toBe(403)
            const counter = await seller.post(`/api/conversations/${cid}/negotiations`).send({price:140,parentId:first.body.proposal.id,quantity:30})
            expect(counter.status).toBe(200)
            expect((await buyer.post(`/api/conversations/${cid}/negotiations`).send({action:'accept',proposalId:first.body.proposal.id})).status).toBe(409)
            expect((await buyer.post(`/api/conversations/${cid}/negotiations`).send({action:'accept',proposalId:counter.body.proposal.id})).status).toBe(200)
            const id = await select(oid,30)
            const order = (await buyer.get(`/api/orders/${id}`)).body.order
            expect(order).toMatchObject({price:{unit:140},subtotal:4200,conditionsSnapshot:{originalOffer:{price:145}}})
            expect((await buyer.get(`/api/orders/${id}/conversation`)).body.conversation.id).toBe(cid)
            expect((await buyer.get(`/api/buy-requests/${rid}/offers`)).body.offers[0].price.amount).toBe(145)
            expect((await buyer.post(`/api/orders/${id}/seller-confirm`)).status).toBe(403)
            expect((await seller.post(`/api/orders/${id}/seller-confirm`)).status).toBe(200)
            expect((await buyer.post(`/api/orders/${id}/complete`).send({actualQuantity:20,actualTotal:2700})).status).toBe(200)
            expect((await seller.post(`/api/orders/${id}/complete`)).body.order).toMatchObject({status:'completed',actualQuantity:20,actualTotal:2700})
            expect((await seller.post(`/api/orders/${id}/complete`)).status).toBe(200)
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest).toMatchObject({completedQuantity:20,selectedQuantity:0,remainingQuantity:80})
            expect((await seller.get(`/api/products/${productId}`)).body.product.quantity).toBe(80)
            expect(Number((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1',[productId])).rows[0].reserved_quantity)).toBe(0)
            expect((await buyer.get(`/api/conversations/${cid}/messages`)).body.messages.filter((m:any)=>m.kind==='system').length).toBeGreaterThanOrEqual(3)
        }, 60000)
        it('starts one ordinary chat per product or request before an offer exists', async () => {
            const { rid, productId } = await setup(10, 'multiple_sellers', true)
            const productChats = await Promise.all([buyer.post(`/api/products/${productId}/conversation`), buyer.post(`/api/products/${productId}/conversation`)])
            expect(productChats.map(result => result.status).sort()).toEqual([200, 201])
            const productConversation = productChats[0].body.conversation.id
            expect((await buyer.get(`/api/conversations/${productConversation}/context`)).body).toEqual({ context: null, proposals: [] })
            expect((await buyer.post(`/api/conversations/${productConversation}/messages`).send({ body: 'Цікавить цей товар' })).status).toBe(201)
            expect((await outsider.get(`/api/conversations/${productConversation}/messages`)).status).toBe(404)
            const requestChats = await Promise.all([seller.post(`/api/buy-requests/${rid}/conversation`), seller.post(`/api/buy-requests/${rid}/conversation`)])
            expect(requestChats.map(result => result.status).sort()).toEqual([200, 201])
            const conversations = (await buyer.get('/api/conversations')).body.conversations
            expect(conversations.some((conversation: any) => conversation.id === productConversation && conversation.productId === productId)).toBe(true)
            expect((await seller.get('/api/conversations')).body.conversations.some((conversation: any) => conversation.buyRequestId === rid)).toBe(true)
        }, 60000)
        it('publishes double-blind 12-point reviews only after both parties and never leaks rating aggregates', async () => {
            const {oid}=await setup(); const id=await select(oid,100); await complete(id)
            const before=(await buyer.get(`/api/profiles/${names[1]}`)).body.profile.ratingSummary
            expect((await outsider.post(`/api/orders/${id}/reviews`).send({rating:12})).status).toBe(403)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({rating:12,communicationRating:11,complianceRating:12,descriptionRating:10,body:'Добре'})).status).toBe(201)
            expect((await seller.get(`/api/profiles/${names[1]}/reviews`)).body.reviews.some((r:any)=>r.orderId===id)).toBe(false)
            expect((await buyer.get(`/api/profiles/${names[1]}`)).body.profile.ratingSummary).toEqual(before)
            expect((await seller.get('/api/orders')).body.orders.find((o:any)=>o.id===id)).toMatchObject({counterpartReviewCreated:true,myReviewCreated:false})
            expect((await seller.post(`/api/orders/${id}/reviews`).send({rating:10})).status).toBe(201)
            expect((await buyer.get(`/api/profiles/${names[1]}/reviews`)).body.reviews.find((r:any)=>r.orderId===id)).toMatchObject({rating:12,communicationRating:11})
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({rating:1})).status).toBe(409)
            expect((await buyer.get(`/api/profiles/${names[1]}`)).body.profile.ratingSummary.count).toBe(before.count+1)
        }, 60000)
        it('publishes a single review after the configured deadline exactly once',async()=>{
            const {oid}=await setup(); const id=await select(oid,100); await complete(id)
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({rating:9})).status).toBe(201)
            await pool.query("UPDATE reviews SET publish_after=now()-interval '1 minute' WHERE order_id=$1",[id])
            await publishDueReviews(); const first=(await buyer.get(`/api/profiles/${names[1]}`)).body.profile.ratingSummary
            await publishDueReviews(); expect((await buyer.get(`/api/profiles/${names[1]}`)).body.profile.ratingSummary).toEqual(first)
            expect((await seller.get(`/api/profiles/${names[1]}/reviews`)).body.reviews.some((r:any)=>r.orderId===id)).toBe(true)
        },60000)
        it('serializes simultaneous selections and replays the same selection key without a second order',async()=>{
            const {oid,rid}=await setup(20); const key=randomUUID()
            const pair=await Promise.all([buyer.post(`/api/offers/${oid}/accept`).send({quantity:20,selectionKey:key}),buyer.post(`/api/offers/${oid}/accept`).send({quantity:20,selectionKey:key})])
            expect(pair.map(r=>r.status).sort()).toEqual([200,201]); expect(pair[0].body.order.id).toBe(pair[1].body.order.id)
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest.selectedQuantity).toBe(20)
            const other=await setup(20)
            const second=await outsider.post(`/api/buy-requests/${other.rid}/offers`).send({quantity:20,unit:'kg',price:140,currency:'UAH',delivery:'Самовивіз'})
            const raced=await Promise.all([buyer.post(`/api/offers/${other.oid}/accept`).send({quantity:20}),buyer.post(`/api/offers/${second.body.offer.id}/accept`).send({quantity:20})])
            expect(raced.map(r=>r.status).sort()).toEqual([201,409]); expect(raced.find(r=>r.status===409)!.body.remainingQuantity).toBe(0)
        },60000)
        it('releases reservations once on cancellation and seller rejection, including SINGLE_SELLER',async()=>{
            const {oid,rid,productId}=await setup(100,'single_seller',true)
            const small=await outsider.post(`/api/buy-requests/${rid}/offers`).send({quantity:60,unit:'kg',price:140,currency:'UAH',delivery:'Самовивіз'})
            expect((await buyer.post(`/api/offers/${small.body.offer.id}/accept`).send({})).status).toBe(409)
            const id=await select(oid,100)
            expect((await buyer.post(`/api/offers/${oid}/accept`).send({})).status).toBeGreaterThanOrEqual(400)
            expect((await seller.post(`/api/orders/${id}/fail`).send({reason:'PRODUCT_UNAVAILABLE'})).body.order.status).toBe('rejected')
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest.remainingQuantity).toBe(100)
            const next=await select(oid,100); expect((await seller.post(`/api/orders/${next}/seller-confirm`)).status).toBe(200)
            const results=await Promise.all([buyer.patch(`/api/orders/${next}/status`).send({status:'cancelled',reason:'Передумав'}),buyer.patch(`/api/orders/${next}/status`).send({status:'cancelled',reason:'Передумав'})])
            expect(results.every(r=>r.status===200)).toBe(true)
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest.remainingQuantity).toBe(100)
            expect(Number((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1',[productId])).rows[0].reserved_quantity)).toBe(0)
        },60000)
        it('cannot bypass bilateral completion using the old status endpoint; preserves conflicting answers',async()=>{
            const {oid,rid}=await setup(30);const id=await select(oid,30)
            expect((await seller.post(`/api/orders/${id}/seller-confirm`)).status).toBe(200)
            expect((await buyer.patch(`/api/orders/${id}/status`).send({status:'completed'})).body.order.status).toBe('buyer_marked_completed')
            expect((await seller.post(`/api/orders/${id}/fail`).send({reason:'CONDITIONS_CHANGED'})).body.order).toMatchObject({status:'disputed',buyerResult:{outcome:'completed'},sellerResult:{outcome:'failed'}})
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest).toMatchObject({completedQuantity:0,selectedQuantity:30})
            expect((await buyer.post(`/api/orders/${id}/reviews`).send({rating:12})).status).toBe(409)
            expect((await buyer.post(`/api/orders/${id}/dispute/resolve`).send({outcome:'cancelled',resolution:'Узгодили скасування'})).body.order.status).toBe('disputed')
            expect((await seller.post(`/api/orders/${id}/dispute/resolve`).send({outcome:'cancelled',resolution:'Узгодили скасування'})).body.order.status).toBe('cancelled')
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest.remainingQuantity).toBe(30)
        },60000)
        it('validates actual quantity, blocks strangers, expires negotiations on closed requests and keeps active orders',async()=>{
            const {oid,rid}=await setup(100)
            const chat=await buyer.post(`/api/offers/${oid}/conversation`);const cid=chat.body.conversation.id
            expect((await outsider.get(`/api/conversations/${cid}/context`)).status).toBe(404)
            expect((await outsider.post(`/api/conversations/${cid}/messages`).send({body:'Чуже повідомлення'})).status).toBe(404)
            expect((await outsider.post(`/api/offers/${oid}/accept`).send({quantity:10})).status).toBe(403)
            const id=await select(oid,30); await seller.post(`/api/orders/${id}/seller-confirm`)
            for(const quantity of [0,-1,31,0.00001,'20']) expect((await buyer.post(`/api/orders/${id}/complete`).send({actualQuantity:quantity})).status).toBe(400)
            const proposal=await buyer.post(`/api/conversations/${cid}/negotiations`).send({price:130,quantity:20})
            expect(proposal.status).toBe(200)
            expect((await buyer.patch(`/api/buy-requests/${rid}`).send({status:'cancelled'})).status).toBe(200)
            expect((await seller.post(`/api/conversations/${cid}/negotiations`).send({action:'accept',proposalId:proposal.body.proposal.id})).status).toBe(409)
            expect((await buyer.get(`/api/orders/${id}`)).body.order.status).toBe('in_progress')
            expect((await buyer.post(`/api/orders/${id}/complete`).send({actualQuantity:20})).status).toBe(200)
            expect((await seller.post(`/api/orders/${id}/complete`)).status).toBe(200)
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest).toMatchObject({status:'cancelled',completedQuantity:20})
        },60000)
        it('keeps agreed terms during a later pending round, includes delivery and protects contacts and blocked interactions',async()=>{
            const {oid}=await setup(100)
            const edited=await seller.patch(`/api/offers/${oid}`).send({deliveryPrice:100,availableAt:'Сьогодні'})
            expect(edited.status,JSON.stringify(edited.body)).toBe(200)
            expect(edited.body.offer).toMatchObject({deliverySnapshot:{price:100},termsSnapshot:{availableAt:'Сьогодні'}})
            const cid=(await buyer.post(`/api/offers/${oid}/conversation`)).body.conversation.id
            const proposed=await buyer.post(`/api/conversations/${cid}/negotiations`).send({price:135,quantity:20})
            expect(proposed.body.proposal.deliveryPrice).toBe(100)
            expect((await seller.post(`/api/conversations/${cid}/negotiations`).send({action:'accept',proposalId:proposed.body.proposal.id})).status).toBe(200)
            expect((await buyer.post(`/api/conversations/${cid}/negotiations`).send({parentId:proposed.body.proposal.id,price:130,quantity:20})).status).toBe(200)
            const id=await select(oid,20)
            expect((await buyer.get(`/api/orders/${id}`)).body.order).toMatchObject({price:{unit:135},subtotal:2800,conditionsSnapshot:{goodsTotal:2700,grandTotal:2800,delivery:{price:100}}})
            expect((await buyer.get(`/api/orders/${id}/contact`)).status).toBe(409)
            expect((await outsider.get(`/api/orders/${id}/contact`)).status).toBe(404)
            await seller.post(`/api/orders/${id}/seller-confirm`)
            expect((await buyer.get(`/api/orders/${id}/contact`)).body.phone).toBeNull()
            expect((await seller.patch('/api/profile/me/privacy').send({phoneVisibility:'authenticated',phoneDisclosureConsent:true})).status).toBe(200)
            expect((await buyer.get(`/api/orders/${id}/contact`)).body.phone).toMatch(/^\+380/)
            expect((await seller.delete(`/api/offers/${oid}`)).status).toBe(204)
            expect((await buyer.get(`/api/orders/${id}`)).body.order.status).toBe('in_progress')
            expect((await buyer.get(`/api/conversations/${cid}/context`)).body.proposals.at(-1).status).toBe('expired')
            expect((await buyer.post(`/api/users/${ids[1]}/block`)).status).toBe(204)
            expect((await seller.post(`/api/conversations/${cid}/messages`).send({body:'Повідомлення після блокування'})).status).toBe(403)
            expect((await buyer.delete(`/api/users/${ids[1]}/block`)).status).toBe(204)
        },60000)
        it('reserves only the active remainder across independent sellers and completes in parallel without overcounting',async()=>{
            const {oid,rid}=await setup(100)
            const second=await outsider.post(`/api/buy-requests/${rid}/offers`).send({quantity:50,unit:'kg',price:140,currency:'UAH',delivery:'Самовивіз'})
            const firstId=await select(oid,40), secondId=await select(second.body.offer.id,30)
            await seller.post(`/api/orders/${firstId}/seller-confirm`);await outsider.post(`/api/orders/${secondId}/seller-confirm`)
            await buyer.post(`/api/orders/${firstId}/complete`)
            const responses=await Promise.all([seller.post(`/api/orders/${firstId}/complete`),seller.post(`/api/orders/${firstId}/complete`)])
            expect(responses.every(r=>r.status===200)).toBe(true)
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest).toMatchObject({completedQuantity:40,selectedQuantity:30,remainingQuantity:30})
            expect((await outsider.post(`/api/orders/${secondId}/complete`).send({actualQuantity:20})).status).toBe(200)
            expect((await buyer.post(`/api/orders/${secondId}/complete`).send({actualQuantity:30})).body.order.status).toBe('disputed')
            expect((await buyer.get(`/api/buy-requests/${rid}`)).body.buyRequest).toMatchObject({completedQuantity:40,selectedQuantity:30,remainingQuantity:30})
        },60000)
    })
} else describe.skip('agreement integration requires DATABASE_URL',()=>{})
