import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ExternalUrlPhotoStorage } from './photo-storage.js'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('Offer photo retention across Deals', () => {
        it('keeps cancelled and completed snapshots while removing only unreferenced files', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const names = ['b', 'a', 'c'].map(role => `ph_${role}_${suffix}`)
            const [buyer, sellerA, sellerB] = names.map(() => request.agent(createApp()))
            const offerStorage = new ExternalUrlPhotoStorage('offers')
            const productStorage = new ExternalUrlPhotoStorage('products')
            const offerKeys = new Set<string>()
            const productKeys = new Set<string>()
            const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
            const photo = (marker: string) => `data:image/png;base64,${Buffer.concat([png, Buffer.from(`photo-${marker}-${suffix}`)]).toString('base64')}`
            const key = (url: string) => url.replace('/uploads/offers/', '')
            const path = (url: string) => fileURLToPath(new URL(`../uploads/offers/${key(url)}`, import.meta.url))
            const track = (url: string) => { offerKeys.add(key(url)); return url }
            try {
                for (const [index, agent] of [buyer, sellerA, sellerB].entries()) {
                    const registered = await agent.post('/api/auth/register').send({ username: names[index], email: `${names[index]}@example.com`, countryCode: 'UA', phone: `+380${['50', '67', '68'][index]}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                    expect(registered.status).toBe(201)
                }
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await sellerA.post('/api/products').send({ categoryId: category.id, title: 'Товар із фото', quantity: 30, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [{ dataUrl: photo('product') }] })
                expect(product.status).toBe(201)
                const productId = product.body.product.id as string
                for (const row of (await pool.query('SELECT storage_key FROM product_photos WHERE product_id=$1', [productId])).rows) productKeys.add(row.storage_key)
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Запит з історією фото', description: '', quantity: 30, unit: 'kg', currency: 'UAH', receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                expect(createdRequest.status).toBe(201)
                const endpoint = `/api/buy-requests/${createdRequest.body.buyRequest.id}/offers`
                const base = { quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' }
                const makeOffer = async (agent: typeof sellerA, marker: string) => {
                    const response = await agent.post(endpoint).send({ ...base, creationMode: 'manual', title: `Товар ${marker}`, photos: [{ dataUrl: photo(marker) }] })
                    expect(response.status).toBe(201)
                    track(response.body.offer.photos[0].url)
                    return response.body.offer.id as string
                }

                const linked = await sellerA.post(endpoint).send({ ...base, creationMode: 'product', productId, photos: [{ url: product.body.product.photos[0].url }] })
                expect(linked.status).toBe(201)
                const linkedId = linked.body.offer.id as string
                const oldUrl = track(linked.body.offer.photos[0].url)
                const oldBytes = await readFile(path(oldUrl))
                const cancelledDeal = await buyer.post(`/api/offers/${linkedId}/accept`).send({ quantity: 5 })
                expect(cancelledDeal.status).toBe(201)
                const cancelledId = cancelledDeal.body.order.id as string
                const cancelledSnapshot = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [cancelledId])).rows[0].conditions_snapshot
                expect((await buyer.patch(`/api/orders/${cancelledId}/status`).send({ status: 'cancelled', reason: 'Змінилися плани' })).status).toBe(200)
                expect((await pool.query('SELECT status FROM offers WHERE id=$1', [linkedId])).rows[0].status).toBe('submitted')
                expect((await sellerB.patch(`/api/offers/${linkedId}`).send({ photos: [] })).body).toEqual({ error: 'OFFER_NOT_FOUND' })
                const changed = await sellerA.patch(`/api/offers/${linkedId}`).send({ photos: [{ dataUrl: photo('new') }] })
                expect(changed.status).toBe(200)
                const newUrl = track(changed.body.offer.photos[0].url)
                expect(newUrl).not.toBe(oldUrl)
                expect(await readFile(path(oldUrl))).toEqual(oldBytes)
                expect((await buyer.get(oldUrl)).status).toBe(200)
                expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [cancelledId])).rows[0].conditions_snapshot).toEqual(cancelledSnapshot)
                expect((await pool.query('SELECT offer_terms_snapshot FROM order_items WHERE order_id=$1', [cancelledId])).rows[0].offer_terms_snapshot.photos[0].url).toBe(oldUrl)
                expect((await pool.query('SELECT status FROM orders WHERE id=$1', [cancelledId])).rows[0].status).toBe('cancelled')
                expect((await sellerA.patch(`/api/offers/${linkedId}`).send({ photos: [] })).status).toBe(200)
                await expect(readFile(path(newUrl))).rejects.toMatchObject({ code: 'ENOENT' })
                expect(await readFile(path(oldUrl))).toEqual(oldBytes)
                expect((await sellerA.patch(`/api/offers/${linkedId}`).send({ photos: [] })).status).toBe(200)

                const sharedOwner = await makeOffer(sellerA, 'shared-owner')
                const sharedOther = await makeOffer(sellerB, 'shared-other')
                const ownerPhoto = (await pool.query('SELECT storage_key, url FROM offer_photos WHERE offer_id=$1', [sharedOwner])).rows[0]
                const otherPhoto = (await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id=$1', [sharedOther])).rows[0]
                const sharedBytes = await readFile(path(ownerPhoto.url))
                await pool.query('UPDATE offer_photos SET storage_key=$1, url=$2 WHERE offer_id=$3', [ownerPhoto.storage_key, ownerPhoto.url, sharedOther])
                await offerStorage.remove(otherPhoto.storage_key)
                expect((await sellerA.patch(`/api/offers/${sharedOwner}`).send({ photos: [] })).status).toBe(200)
                expect(await readFile(path(ownerPhoto.url))).toEqual(sharedBytes)
                expect((await sellerB.patch(`/api/offers/${sharedOther}`).send({ photos: [] })).status).toBe(200)
                await expect(readFile(path(ownerPhoto.url))).rejects.toMatchObject({ code: 'ENOENT' })
                expect((await sellerB.patch(`/api/offers/${sharedOther}`).send({ photos: [] })).status).toBe(200)

                const racingPhoto = await sellerA.patch(`/api/offers/${linkedId}`).send({ photos: [{ dataUrl: photo('race') }] })
                expect(racingPhoto.status).toBe(200)
                const racingUrl = track(racingPhoto.body.offer.photos[0].url)
                const [racingEdit, racingDeal] = await Promise.all([
                    sellerA.patch(`/api/offers/${linkedId}`).send({ photos: [] }),
                    buyer.post(`/api/offers/${linkedId}/accept`).send({ quantity: 5 }),
                ])
                expect(racingDeal.status).toBe(201)
                const racingSnapshot = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [racingDeal.body.order.id])).rows[0].conditions_snapshot
                if (racingEdit.status === 200) {
                    expect(racingSnapshot.photos).toEqual([])
                    await expect(readFile(path(racingUrl))).rejects.toMatchObject({ code: 'ENOENT' })
                } else {
                    expect(racingEdit.status).toBe(409)
                    expect(racingSnapshot.photos[0].url).toBe(racingUrl)
                    expect(await readFile(path(racingUrl))).toBeTruthy()
                }

                const completedOffer = await makeOffer(sellerA, 'completed')
                const completedPhoto = (await pool.query('SELECT storage_key, url FROM offer_photos WHERE offer_id=$1', [completedOffer])).rows[0]
                const completedBytes = await readFile(path(completedPhoto.url))
                const completedDeal = await buyer.post(`/api/offers/${completedOffer}/accept`).send({ quantity: 5 })
                expect(completedDeal.status).toBe(201)
                const completedId = completedDeal.body.order.id as string
                expect((await sellerA.post(`/api/orders/${completedId}/seller-confirm`)).status).toBe(200)
                expect((await buyer.post(`/api/orders/${completedId}/complete`)).status).toBe(200)
                expect((await sellerA.post(`/api/orders/${completedId}/complete`)).body.order.status).toBe('completed')
                // A legacy shared key makes an editable Offer request cleanup of the completed Deal's file.
                const editable = await makeOffer(sellerA, 'editable')
                const editablePhoto = (await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id=$1', [editable])).rows[0]
                await pool.query('UPDATE offer_photos SET storage_key=$1, url=$2 WHERE offer_id=$3', [completedPhoto.storage_key, completedPhoto.url, editable])
                await offerStorage.remove(editablePhoto.storage_key)
                await pool.query('DELETE FROM offer_photos WHERE offer_id=$1', [completedOffer])
                expect((await sellerA.patch(`/api/offers/${editable}`).send({ photos: [] })).status).toBe(200)
                expect(await readFile(path(completedPhoto.url))).toEqual(completedBytes)
                expect((await buyer.get(completedPhoto.url)).status).toBe(200)
                expect((await pool.query('SELECT conditions_snapshot->\'photos\' AS photos, status FROM orders WHERE id=$1', [completedId])).rows[0]).toMatchObject({ photos: [{ url: completedPhoto.url }], status: 'completed' })
            } finally {
                const normalized = names.map(name => name.toLowerCase())
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [normalized])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [normalized])
                for (const photoKey of offerKeys) await offerStorage.remove(photoKey)
                for (const photoKey of productKeys) await productStorage.remove(photoKey)
            }
        }, 60000)
    })
}
