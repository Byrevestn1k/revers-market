import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ExternalUrlPhotoStorage } from './photo-storage.js'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('legacy Offer photo snapshots', () => {
        it('copies Product photos into a selected legacy Offer and respects a later explicit removal', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const names = [`legacy_b_${suffix}`, `legacy_s_${suffix}`]
            const buyer = request.agent(createApp())
            const seller = request.agent(createApp())
            const offerStorage = new ExternalUrlPhotoStorage('offers')
            const productStorage = new ExternalUrlPhotoStorage('products')
            const offerKeys = new Set<string>()
            let productKey = ''
            const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGNYtfvMqt1nGCAUADziCMU05NnQAAAAAElFTkSuQmCC'
            const path = (key: string) => fileURLToPath(new URL(`../uploads/offers/${key}`, import.meta.url))
            try {
                for (const [index, agent] of [buyer, seller].entries()) {
                    const registered = await agent.post('/api/auth/register').send({ username: names[index], email: `${names[index]}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                    expect(registered.status).toBe(201)
                }
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await seller.post('/api/products').send({ categoryId: category.id, title: 'Старий товар', quantity: 4, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [{ dataUrl: png }] })
                expect(product.status).toBe(201)
                const productId = product.body.product.id as string
                productKey = (await pool.query('SELECT storage_key FROM product_photos WHERE product_id=$1', [productId])).rows[0].storage_key
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Старий запит', description: '', quantity: 4, unit: 'kg', currency: 'UAH', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                expect(createdRequest.status).toBe(201)
                const endpoint = `/api/buy-requests/${createdRequest.body.buyRequest.id}/offers`
                const base = { creationMode: 'product', productId, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' }
                const legacy = await seller.post(endpoint).send(base)
                expect(legacy.status).toBe(201)
                const legacyId = legacy.body.offer.id as string
                const initialKey = (await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id=$1', [legacyId])).rows[0].storage_key
                offerKeys.add(initialKey)
                await pool.query('DELETE FROM offer_photos WHERE offer_id=$1', [legacyId])
                await pool.query('UPDATE offers SET creation_mode=NULL WHERE id=$1', [legacyId])
                await offerStorage.remove(initialKey)
                const visible = await buyer.get(`/api/buy-requests/${createdRequest.body.buyRequest.id}/offers`)
                expect(visible.status).toBe(200)
                expect(visible.body.offers.find((offer: { id: string }) => offer.id === legacyId).photos[0].url).toBe(product.body.product.photos[0].url)
                const selected = await buyer.post(`/api/offers/${legacyId}/accept`).send({ quantity: 2 })
                expect(selected.status).toBe(201)
                const copied = (await pool.query('SELECT storage_key, url FROM offer_photos WHERE offer_id=$1', [legacyId])).rows[0]
                offerKeys.add(copied.storage_key)
                expect(copied.url).not.toBe(product.body.product.photos[0].url)
                const bytes = await readFile(path(copied.storage_key))
                const snapshots = await pool.query('SELECT o.conditions_snapshot, i.offer_terms_snapshot FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=$1', [selected.body.order.id])
                expect(snapshots.rows[0].conditions_snapshot.photos[0].url).toBe(copied.url)
                expect(snapshots.rows[0].offer_terms_snapshot.photos[0].url).toBe(copied.url)
                const before = (await buyer.get(`/api/orders/${selected.body.order.id}`)).body.order
                expect(before.conditionsSnapshot).toMatchObject({ productTitle: 'Старий товар', delivery: { delivery: 'Самовивіз' } })
                expect((await seller.patch(`/api/offers/${legacyId}`).send({ price: 120 })).status).toBe(409)
                expect((await buyer.patch(`/api/buy-requests/${createdRequest.body.buyRequest.id}`).send({ title: 'Оновлений запит' })).status).toBe(200)
                expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Оновлений товар' })).status).toBe(200)
                const after = (await buyer.get(`/api/orders/${selected.body.order.id}`)).body.order
                expect(after).toMatchObject({ buyer: before.buyer, seller: before.seller, quantity: before.quantity, unit: before.unit, price: before.price, subtotal: before.subtotal, status: before.status })
                expect(after.conditionsSnapshot).toEqual(before.conditionsSnapshot)
                const editable = await seller.post(endpoint).send({ ...base, quantity: 1 })
                expect(editable.status).toBe(201)
                const editableKey = (await pool.query('SELECT storage_key FROM offer_photos WHERE offer_id=$1', [editable.body.offer.id])).rows[0].storage_key
                offerKeys.add(editableKey)
                await pool.query('UPDATE offers SET creation_mode=NULL WHERE id=$1', [editable.body.offer.id])
                const removed = await seller.patch(`/api/offers/${editable.body.offer.id}`).send({ photos: [] })
                expect(removed.status).toBe(200)
                expect(removed.body.offer.photos).toEqual([])
                await pool.query('DELETE FROM product_photos WHERE product_id=$1', [productId])
                await productStorage.remove(productKey)
                expect(await readFile(path(copied.storage_key))).toEqual(bytes)
            } finally {
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [names])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [names])
                for (const key of offerKeys) await offerStorage.remove(key)
                if (productKey) await productStorage.remove(productKey)
            }
        }, 60000)
    })
}
