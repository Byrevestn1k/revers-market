import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { ExternalUrlPhotoStorage } from './photo-storage.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('buy requests and offers HTTP integration', () => {
        it('creates three offer variants with owned photo snapshots and locks accepted terms under concurrent selection', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const roles = ['buyer', 'seller_a', 'seller_b', 'seller_c']
            const agents = roles.map(() => request.agent(createApp()))
            const usernames = roles.map(role => `step13_${role}_${suffix}`)
            const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
            const otherPhoto = `data:image/png;base64,${Buffer.concat([Buffer.from(photo.split(',')[1], 'base64'), Buffer.from('second-photo')]).toString('base64')}`
            const offerFile = (url: string) => fileURLToPath(new URL(`../uploads/offers/${url.replace('/uploads/offers/', '')}`, import.meta.url))
            const offerStorage = new ExternalUrlPhotoStorage('offers')
            const productStorage = new ExternalUrlPhotoStorage('products')
            const offerKeys: string[] = []
            const productKeys: string[] = []
            try {
                for (const [index, agent] of agents.entries()) {
                    const registered = await agent.post('/api/auth/register').send({ username: usernames[index], email: `${usernames[index]}@example.com`, countryCode: 'UA', phone: `+380${['50', '67', '68', '93'][index]}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                    expect(registered.status).toBe(201)
                }
                const [buyer, sellerA, sellerB, sellerC] = agents
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const productResponse = await sellerA.post('/api/products').send({ categoryId: category.id, title: `Власний товар ${suffix}`, description: 'Первинний опис', quantity: 5, unit: 'kg', price: 90, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [{ dataUrl: otherPhoto, alt: 'Перше' }, { dataUrl: photo, alt: 'Оригінал' }] })
                expect(productResponse.status).toBe(201)
                const productId = productResponse.body.product.id as string
                const productPhoto = productResponse.body.product.photos[1].url as string
                productKeys.push(...(await pool.query('SELECT storage_key FROM product_photos WHERE product_id=$1', [productId])).rows.map(row => row.storage_key))
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: `Запит Step 13 ${suffix}`, description: 'Потрібен товар', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 90, maxPrice: 110, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                expect(createdRequest.status).toBe(201)
                const requestId = createdRequest.body.buyRequest.id as string
                const endpoint = `/api/buy-requests/${requestId}/offers`
                const base = { quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' }
                const linked = await sellerA.post(endpoint).send({ ...base, creationMode: 'product', productId, photos: [{ url: productPhoto }], note: 'Для запиту' })
                expect(linked.status).toBe(201)
                expect(linked.body.offer).toMatchObject({ title: `Власний товар ${suffix}`, description: 'Первинний опис', creationMode: 'product', photos: [{ url: expect.stringContaining('/uploads/offers/') }] })
                expect(linked.body.offer.photos[0].url).not.toBe(productPhoto)
                const retainedUrl = linked.body.offer.photos[0].url as string
                const retainedBytes = await readFile(offerFile(retainedUrl))
                const inserted = await sellerA.patch(`/api/offers/${linked.body.offer.id}`).send({ photos: [{ url: productResponse.body.product.photos[0].url }, { url: retainedUrl }] })
                expect(inserted.status).toBe(200)
                const insertedUrl = inserted.body.offer.photos[0].url as string
                expect(insertedUrl).not.toBe(retainedUrl)
                expect(await readFile(offerFile(retainedUrl))).toEqual(retainedBytes)
                expect(await readFile(offerFile(insertedUrl))).not.toEqual(retainedBytes)
                const reordered = await sellerA.patch(`/api/offers/${linked.body.offer.id}`).send({ photos: [{ url: retainedUrl }, { url: insertedUrl }] })
                expect(reordered.body.offer.photos.map((item: { url: string }) => item.url)).toEqual([retainedUrl, insertedUrl])
                expect(await readFile(offerFile(retainedUrl))).toEqual(retainedBytes)
                const repeated = await sellerA.patch(`/api/offers/${linked.body.offer.id}`).send({ photos: [{ url: retainedUrl }, { url: insertedUrl }] })
                expect(repeated.body.offer.photos.map((item: { url: string }) => item.url)).toEqual([retainedUrl, insertedUrl])
                expect(await readFile(offerFile(insertedUrl))).not.toEqual(retainedBytes)
                const trimmed = await sellerA.patch(`/api/offers/${linked.body.offer.id}`).send({ photos: [{ url: retainedUrl }] })
                expect(trimmed.body.offer.photos.map((item: { url: string }) => item.url)).toEqual([retainedUrl])
                expect(await readFile(offerFile(retainedUrl))).toEqual(retainedBytes)
                await expect(readFile(offerFile(insertedUrl))).rejects.toMatchObject({ code: 'ENOENT' })
                expect((await sellerB.post(endpoint).send({ ...base, creationMode: 'product', productId })).body.error).toBe('PRODUCT_NOT_AVAILABLE')
                const manual = await sellerB.post(endpoint).send({ ...base, creationMode: 'manual', title: 'Інший товар', description: 'Окремий опис', characteristics: 'Сорт А', photos: [{ dataUrl: photo, alt: 'Інший товар' }] })
                expect(manual.status).toBe(201)
                expect((await sellerB.patch(`/api/offers/${manual.body.offer.id}`).send({ photos: [{ url: linked.body.offer.photos[0].url }] })).body.fields).toContain('photos')
                const terms = await sellerC.post(endpoint).send({ ...base, creationMode: 'request_terms', title: createdRequest.body.buyRequest.title })
                expect(terms.status).toBe(201)
                expect((await buyer.get(endpoint)).body.offers).toEqual(expect.arrayContaining([
                    expect.objectContaining({ id: linked.body.offer.id, title: `Власний товар ${suffix}` }),
                    expect.objectContaining({ id: manual.body.offer.id, title: 'Інший товар' }),
                    expect.objectContaining({ id: terms.body.offer.id, creationMode: 'request_terms' }),
                ]))
                expect((await buyer.patch(`/api/offers/${manual.body.offer.id}`).send({ title: 'Чужа зміна' })).status).toBe(404)
                const edited = await sellerB.patch(`/api/offers/${manual.body.offer.id}`).send({ title: 'Оновлений товар', description: 'Новий опис', photos: [{ url: manual.body.offer.photos[0].url }, { dataUrl: photo }] })
                expect(edited).toMatchObject({ status: 200, body: { offer: { title: 'Оновлений товар', description: 'Новий опис' } } })
                expect(edited.body.offer.photos).toHaveLength(2)
                const original = (await pool.query('SELECT title, description, price FROM products WHERE id=$1', [productId])).rows[0]
                expect(original).toMatchObject({ title: `Власний товар ${suffix}`, description: 'Первинний опис' })
                const secondLinked = await sellerA.post(endpoint).send({ ...base, creationMode: 'product', productId })
                expect(secondLinked.status).toBe(201)
                const sharedKey = (await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id=$1 AND url=$2', [linked.body.offer.id, retainedUrl])).rows[0].storage_key as string
                const replaced = (await pool.query('SELECT id, storage_key FROM offer_photos WHERE offer_id=$1 ORDER BY sort_order LIMIT 1', [secondLinked.body.offer.id])).rows[0]
                await pool.query('UPDATE offer_photos SET storage_key=$1, url=$2 WHERE id=$3', [sharedKey, retainedUrl, replaced.id])
                await offerStorage.remove(replaced.storage_key)
                const removedShared = await sellerA.patch(`/api/offers/${secondLinked.body.offer.id}`).send({ photos: [{ url: secondLinked.body.offer.photos[1].url }] })
                expect(removedShared.status).toBe(200)
                expect(await readFile(offerFile(retainedUrl))).toEqual(retainedBytes)
                const results = await Promise.all([linked.body.offer.id, secondLinked.body.offer.id].map(id => buyer.post(`/api/offers/${id}/accept`).send({ quantity: 5 })))
                expect(results.map(result => result.status).sort()).toEqual([201, 409])
                const acceptedId = results[0].status === 201 ? linked.body.offer.id : secondLinked.body.offer.id
                expect((await sellerA.patch(`/api/offers/${acceptedId}`).send({ title: 'Зміна після угоди' })).body.error).toBe('OFFER_TERMS_LOCKED')
                const orderId = results.find(result => result.status === 201)!.body.order.id
                const snapshot = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [orderId])).rows[0].conditions_snapshot
                expect(snapshot.productTitle).toBe(`Власний товар ${suffix}`)
                expect(snapshot.photos[0].url).toContain('/uploads/offers/')
                expect((await pool.query('SELECT reserved_quantity FROM products WHERE id=$1', [productId])).rows[0].reserved_quantity).toBe('5.000')
                expect((await sellerA.patch(`/api/products/${productId}`).send({ title: 'Перейменований товар', photos: [] })).status).toBe(200)
                const afterProductEdit = (await buyer.get(endpoint)).body.offers.find((offer: { id: string }) => offer.id === acceptedId)
                expect(afterProductEdit.title).toBe(`Власний товар ${suffix}`)
                expect(afterProductEdit.photos[0].url).toContain('/uploads/offers/')
                expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [orderId])).rows[0].conditions_snapshot).toEqual(snapshot)
            } finally {
                offerKeys.push(...(await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id IN (SELECT id FROM offers WHERE buy_request_id IN (SELECT id FROM buy_requests WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))))', [usernames.map(name => name.toLowerCase())])).rows.map(row => row.storage_key))
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [usernames.map(name => name.toLowerCase())])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [usernames.map(name => name.toLowerCase())])
                for (const key of offerKeys) await offerStorage.remove(key)
                for (const key of productKeys) await productStorage.remove(key)
            }
        }, 30000)
        it('locks fulfillment mode after offer or deal creation without blocking unrelated edits', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const users = ['mode_buyer', 'mode_seller'].map((role, index) => ({ username: `${role}_${suffix}`, email: `${role}_${suffix}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }))
            const [buyer, seller] = users.map(() => request.agent(createApp()))
            try {
                expect((await buyer.post('/api/auth/register').send(users[0])).status).toBe(201)
                expect((await seller.post('/api/auth/register').send(users[1])).status).toBe(201)
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const createRequest = async (title: string) => {
                    const response = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title, description: '', quantity: 10, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                    expect(response.status).toBe(201)
                    return response.body.buyRequest.id as string
                }
                const createOffer = async (buyRequestId: string) => {
                    const response = await seller.post(`/api/buy-requests/${buyRequestId}/offers`).send({ quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' })
                    expect(response.status).toBe(201)
                    return response.body.offer.id as string
                }
                const buyRequestId = await createRequest(`Режим виконання ${suffix}`)
                expect((await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'single_seller' })).status).toBe(200)
                expect((await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'multiple_sellers' })).status).toBe(200)
                const offerId = await createOffer(buyRequestId)
                const changedAfterOffer = await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'single_seller', title: 'Дозволена зміна' })
                expect(changedAfterOffer.status).toBe(200)
                expect(changedAfterOffer.body.buyRequest.fulfillmentMode).toBe('single_seller')
                const offerTerms = (await pool.query('SELECT offered_quantity, unit, unit_price, currency, delivery FROM offers WHERE id = $1', [offerId])).rows[0]
                const allowed = await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'multiple_sellers', title: 'Дозволена зміна', minPrice: 90 })
                expect(allowed.status).toBe(200)
                expect(allowed.body.buyRequest).toMatchObject({ title: 'Дозволена зміна', fulfillmentMode: 'multiple_sellers' })
                expect((await pool.query('SELECT offered_quantity, unit, unit_price, currency, delivery FROM offers WHERE id = $1', [offerId])).rows[0]).toEqual(offerTerms)
                const deal = await buyer.post(`/api/offers/${offerId}/accept`).send({ quantity: 5 })
                expect(deal.status).toBe(201)
                const dealTerms = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id = $1', [deal.body.order.id])).rows[0].conditions_snapshot
                const changedAfterOneDeal = await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'single_seller', description: 'Дозволена зміна' })
                expect(changedAfterOneDeal.status).toBe(200)
                expect((await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'multiple_sellers', description: 'Дозволена зміна після угоди' })).status).toBe(200)
                expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id = $1', [deal.body.order.id])).rows[0].conditions_snapshot).toEqual(dealTerms)
                await pool.query('DELETE FROM offers WHERE id = $1', [offerId])
                expect((await pool.query('SELECT offer_id FROM orders WHERE id = $1', [deal.body.order.id])).rows[0].offer_id).toBeNull()
                expect((await buyer.patch(`/api/buy-requests/${buyRequestId}`).send({ fulfillmentMode: 'single_seller' })).status).toBe(200)

                const withdrawnRequestId = await createRequest(`Відкликана пропозиція ${suffix}`)
                const withdrawnOfferId = await createOffer(withdrawnRequestId)
                expect((await seller.delete(`/api/offers/${withdrawnOfferId}`)).status).toBe(204)
                expect((await buyer.patch(`/api/buy-requests/${withdrawnRequestId}`).send({ fulfillmentMode: 'single_seller' })).status).toBe(200)

                const concurrentRequestId = await createRequest(`Одночасні запити ${suffix}`)
                const [edit, concurrentOffer] = await Promise.all([
                    buyer.patch(`/api/buy-requests/${concurrentRequestId}`).send({ fulfillmentMode: 'single_seller' }),
                    seller.post(`/api/buy-requests/${concurrentRequestId}/offers`).send({ quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' }),
                ])
                expect(concurrentOffer.status).toBe(201)
                expect(edit.status).toBe(200)
                const concurrentState = (await pool.query('SELECT fulfillment_mode FROM buy_requests WHERE id = $1', [concurrentRequestId])).rows[0]
                expect(concurrentState.fulfillment_mode).toBe('single_seller')
                expect((await pool.query('SELECT count(*)::int AS count FROM offers WHERE buy_request_id = $1', [concurrentRequestId])).rows[0].count).toBe(1)
            } finally {
                const names = users.map(user => user.username.toLowerCase())
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [names])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [names])
            }
        }, 30000)

        it('keeps product terms unchanged and supports several partial deals', async () => {
            const uploadedPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const buyerPayload = { username: `buyer_${suffix}`, email: `buyer_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const sellerOnePayload = { username: `seller_one_${suffix}`, email: `seller_one_${suffix}@example.com`, countryCode: 'PL', phone: `+4850${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const sellerTwoPayload = { username: `seller_two_${suffix}`, email: `seller_two_${suffix}@example.com`, countryCode: 'DE', phone: `+49150${suffix.slice(-7)}`, password: 'ThirdPassword3', passwordConfirmation: 'ThirdPassword3' }
            const buyer = request.agent(createApp())
            const sellerOne = request.agent(createApp())
            const sellerTwo = request.agent(createApp())
            let requestId = ''
            try {
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                expect((await sellerOne.post('/api/auth/register').send(sellerOnePayload)).status).toBe(201)
                expect((await sellerTwo.post('/api/auth/register').send(sellerTwoPayload)).status).toBe(201)
                const category = (await sellerOne.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await sellerOne.post('/api/products').send({ categoryId: category.id, title: 'Базова пшениця', description: 'Базові умови', quantity: 1000, unit: 'kg', price: 250, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active' })
                expect(product.status).toBe(201)
                const baseProduct = product.body.product
                const created = await buyer.post('/api/buy-requests').send({ categoryId: category.id, productId: baseProduct.id, title: 'Потрібна пшениця', description: 'Для двох складів', quantity: 500, unit: 'kg', currency: 'UAH', minPrice: 200, maxPrice: 260, delivery: 'preferred', preferredDelivery: 'До складу', geoArea: 'Київська область', address: 'Приватна адреса', deadline: '2030-01-01T00:00:00.000Z', fulfillmentMode: 'multiple_sellers', photos: [{ dataUrl: uploadedPhoto, alt: 'Зразок' }] })
                expect(created.status).toBe(201)
                requestId = created.body.buyRequest.id
                expect(created.body.buyRequest.category.imageIndex).toBe(category.imageIndex)
                expect(created.body.buyRequest.photos).toHaveLength(1)
                expect(created.body.buyRequest.photos[0].url).toMatch(/^\/uploads\/buy-requests\//)
                const descriptionOnly = await buyer.patch(`/api/buy-requests/${requestId}`).send({ description: 'Змінений опис без втрати умов' })
                expect(descriptionOnly.status).toBe(200)
                expect(descriptionOnly.body.buyRequest).toMatchObject({ title: 'Потрібна пшениця', quantity: 500, unit: 'kg', fulfillmentMode: 'multiple_sellers', price: { min: 200, max: 260, currency: 'UAH' }, geoArea: 'Київська область', delivery: { required: true, preferred: 'До складу', address: 'Приватна адреса' } })
                expect(descriptionOnly.body.buyRequest.photos).toEqual(created.body.buyRequest.photos)
                const secondPhoto = await buyer.patch(`/api/buy-requests/${requestId}`).send({ photos: [{ url: created.body.buyRequest.photos[0].url }, { dataUrl: uploadedPhoto, alt: 'Другий зразок' }] })
                expect(secondPhoto.status).toBe(200)
                expect(secondPhoto.body.buyRequest.photos).toHaveLength(2)
                const reordered = await buyer.patch(`/api/buy-requests/${requestId}`).send({ photos: [secondPhoto.body.buyRequest.photos[1], secondPhoto.body.buyRequest.photos[0]] })
                expect(reordered.status).toBe(200)
                expect(reordered.body.buyRequest.photos[0].url).toBe(secondPhoto.body.buyRequest.photos[1].url)
                expect((await sellerOne.patch(`/api/buy-requests/${requestId}`).send({ photos: [] })).status).toBe(404)
                const clearMaximum = await buyer.patch(`/api/buy-requests/${requestId}`).send({ maxPrice: null })
                expect(clearMaximum.status).toBe(200)
                expect(clearMaximum.body.buyRequest.price).toMatchObject({ min: 200, max: null, currency: 'UAH' })
                expect((await sellerOne.patch(`/api/buy-requests/${requestId}`).send({ title: 'Чужа зміна' })).status).toBe(404)
                const offerOne = await sellerOne.post(`/api/buy-requests/${requestId}/offers`).send({ productId: baseProduct.id, quantity: 300, unit: 'kg', price: 240, currency: 'UAH', delivery: 'Доставка до складу', note: 'Умова A', additionalPhotoUrl: 'https://cdn.example.com/offer-a.jpg' })
                const offerTwo = await sellerTwo.post(`/api/buy-requests/${requestId}/offers`).send({ quantity: 200, unit: 'kg', price: 245, currency: 'UAH', delivery: 'Самовивіз', note: 'Умова B' })
                expect(offerOne.status).toBe(201)
                expect(offerTwo.status).toBe(201)
                expect((await buyer.patch(`/api/buy-requests/${requestId}`).send({ quantity: 600 })).status).toBe(409)
                expect((await buyer.patch(`/api/buy-requests/${requestId}`).send({ photos: [reordered.body.buyRequest.photos[0]] })).status).toBe(200)
                expect(offerOne.body.offer).toMatchObject({ quantity: 300, price: { amount: 240 }, note: 'Умова A' })
                const noteOnly = await sellerOne.patch(`/api/offers/${offerOne.body.offer.id}`).send({ note: 'Оновлена умова A' })
                expect(noteOnly.status).toBe(200)
                expect(noteOnly.body.offer).toMatchObject({ quantity: 300, unit: 'kg', price: { amount: 240, currency: 'UAH' }, delivery: 'Доставка до складу', additionalPhotoUrl: 'https://cdn.example.com/offer-a.jpg' })
                const clearOfferPhoto = await sellerOne.patch(`/api/offers/${offerOne.body.offer.id}`).send({ additionalPhotoUrl: null })
                expect(clearOfferPhoto.status).toBe(200)
                expect(clearOfferPhoto.body.offer.additionalPhotoUrl).toBeNull()
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
                const agreedTerms = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id = $1', [dealOne.body.order.id])).rows[0].conditions_snapshot
                expect((await buyer.patch(`/api/buy-requests/${requestId}`).send({ minPrice: 210 })).status).toBe(200)
                expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id = $1', [dealOne.body.order.id])).rows[0].conditions_snapshot).toEqual(agreedTerms)
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
                const partialSingle = await buyer.post(`/api/offers/${smallOffer.body.offer.id}/accept`).send({ quantity: 60 })
                expect(partialSingle.status).toBe(201)
                expect((await buyer.post(`/api/offers/${fullOffer.body.offer.id}/accept`).send({ quantity: 40 })).status).toBe(409)
                expect((await buyer.patch(`/api/orders/${partialSingle.body.order.id}/status`).send({ status: 'cancelled', reason: 'Тест скасування' })).status).toBe(200)
                const selectedSingle = await buyer.post(`/api/offers/${fullOffer.body.offer.id}/accept`).send({ quantity: 100 })
                expect(selectedSingle.status).toBe(201)
                expect(selectedSingle.body.order).toMatchObject({ quantity: 100, status: 'selected' })
            } finally {
                if (requestId) {
                    const photoRows = await pool.query<{ storage_key: string }>('SELECT storage_key FROM buy_request_photos WHERE buy_request_id = $1', [requestId])
                    for (const photo of photoRows.rows) await new ExternalUrlPhotoStorage('buy-requests').remove(photo.storage_key)
                }
                await pool.query(
                    `DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))
                     OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))`,
                    [[buyerPayload.username.toLowerCase(), sellerOnePayload.username.toLowerCase(), sellerTwoPayload.username.toLowerCase()]],
                )
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2, $3)', [buyerPayload.username.toLowerCase(), sellerOnePayload.username.toLowerCase(), sellerTwoPayload.username.toLowerCase()])
            }
        }, 60000)

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

        it('edits submitted offers without revalidating an unchanged unavailable product link', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const buyerPayload = { username: `offer_buyer_${suffix}`, email: `offer_buyer_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const sellerPayload = { username: `offer_seller_${suffix}`, email: `offer_seller_${suffix}@example.com`, countryCode: 'UA', phone: `+38067${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const buyer = request.agent(createApp())
            const seller = request.agent(createApp())
            try {
                expect((await buyer.post('/api/auth/register').send(buyerPayload)).status).toBe(201)
                expect((await seller.post('/api/auth/register').send(sellerPayload)).status).toBe(201)
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const createProduct = async (title: string, status = 'active') => {
                    const result = await seller.post('/api/products').send({ categoryId: category.id, title, quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status })
                    expect(result.status).toBe(201)
                    return result.body.product.id as string
                }
                const pausedProduct = await createProduct(`Призупинений ${suffix}`)
                const reservedProduct = await createProduct(`Зарезервований ${suffix}`)
                const availableProduct = await createProduct(`Доступний ${suffix}`)
                const unavailableProduct = await createProduct(`Недоступний ${suffix}`, 'paused')
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: `Запит ${suffix}`, description: '', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 90, maxPrice: 110, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                expect(createdRequest.status).toBe(201)
                const requestId = createdRequest.body.buyRequest.id
                const createOffer = async (productId: string) => {
                    const result = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ productId, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз', note: 'Початкова примітка' })
                    expect(result.status).toBe(201)
                    return result.body.offer.id as string
                }
                const pausedOffer = await createOffer(pausedProduct)
                expect((await seller.patch(`/api/products/${pausedProduct}`).send({ status: 'paused' })).status).toBe(200)
                const pausedNote = await seller.patch(`/api/offers/${pausedOffer}`).send({ productId: pausedProduct, note: 'Коментар для paused товару' })
                expect(pausedNote.status).toBe(200)
                expect(pausedNote.body.offer).toMatchObject({ existingProduct: { id: pausedProduct }, note: 'Коментар для paused товару', quantity: 5, price: { amount: 100 } })

                const reservedOffer = await createOffer(reservedProduct)
                await pool.query('UPDATE products SET reserved_quantity = quantity WHERE id = $1', [reservedProduct])
                expect((await seller.patch(`/api/offers/${reservedOffer}`).send({ productId: reservedProduct, note: 'Коментар для зарезервованого товару', price: 101 })).status).toBe(200)
                const switched = await seller.patch(`/api/offers/${reservedOffer}`).send({ productId: availableProduct })
                expect(switched.status).toBe(200)
                expect(switched.body.offer.existingProduct).toMatchObject({ id: availableProduct })
                const refused = await seller.patch(`/api/offers/${reservedOffer}`).send({ productId: unavailableProduct })
                expect(refused).toMatchObject({ status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } })
                await pool.query("UPDATE offers SET status = 'withdrawn' WHERE id = $1", [reservedOffer])
                expect((await seller.patch(`/api/offers/${reservedOffer}`).send({ note: 'Запізнілий коментар' })).body.error).toBe('OFFER_TERMS_LOCKED')
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [buyerPayload.username.toLowerCase(), sellerPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('buy requests and offers HTTP integration (requires DATABASE_URL)', () => { })
}
