import { describe, expect, it } from 'vitest'
import request from 'supertest'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('Offer photo lock ordering', () => {
        it('does not hold a Product lock while waiting to create or accept photo references', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const names = [`photo_lock_b_${suffix}`, `photo_lock_s_${suffix}`]
            const buyer = request.agent(createApp())
            const seller = request.agent(createApp())
            try {
                for (const [index, agent] of [buyer, seller].entries()) {
                    const registered = await agent.post('/api/auth/register').send({ username: names[index], email: `${names[index]}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                    expect(registered.status).toBe(201)
                }
                const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const product = await seller.post('/api/products').send({ categoryId: category.id, title: 'Товар для блокувань', quantity: 4, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [] })
                expect(product.status).toBe(201)
                const productId = product.body.product.id as string
                const createdRequest = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Запит для блокувань', description: '', quantity: 4, unit: 'kg', currency: 'UAH', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' })
                expect(createdRequest.status).toBe(201)

                const whilePhotoLockHeld = async <T>(start: () => Promise<T>): Promise<T> => {
                    const holder = await pool.connect()
                    await holder.query('SELECT pg_advisory_lock(13, 45)')
                    const pending = start()
                    let checkError: unknown
                    try {
                        let waiting = false
                        for (let attempt = 0; attempt < 100; attempt++) {
                            const state = await pool.query<{ waiting: boolean }>(`SELECT EXISTS (
                                SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory'
                                AND query LIKE 'SELECT pg_advisory_xact_lock%'
                            ) AS waiting`)
                            if (state.rows[0].waiting) { waiting = true; break }
                            await new Promise(resolve => setTimeout(resolve, 50))
                        }
                        expect(waiting).toBe(true)
                        const probe = await pool.connect()
                        try {
                            await probe.query('BEGIN')
                            await probe.query("SET LOCAL lock_timeout = '750ms'")
                            await probe.query('UPDATE products SET updated_at = now() WHERE id = $1', [productId])
                            await probe.query('COMMIT')
                        } catch (error) {
                            await probe.query('ROLLBACK')
                            throw error
                        } finally { probe.release() }
                    } catch (error) { checkError = error }
                    finally {
                        await holder.query('SELECT pg_advisory_unlock(13, 45)')
                        holder.release()
                    }
                    const result = await pending
                    if (checkError) throw checkError
                    return result
                }

                const offer = await whilePhotoLockHeld(() => Promise.resolve(seller.post(`/api/buy-requests/${createdRequest.body.buyRequest.id}/offers`).send({ creationMode: 'product', productId, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' })))
                expect(offer.status).toBe(201)
                const selected = await whilePhotoLockHeld(() => Promise.resolve(buyer.post(`/api/offers/${offer.body.offer.id}/accept`).send({ quantity: 2 })))
                expect(selected.status).toBe(201)
            } finally {
                await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [names])
                await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [names])
            }
        }, 40000)
    })
}
