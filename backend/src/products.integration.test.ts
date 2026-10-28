import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('products HTTP integration', () => {
        it('supports CRUD, pagination, photos, and owner-only edits', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const firstPayload = { username: `seller_${suffix}`, email: `seller_${suffix}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const secondPayload = { username: `other_${suffix}`, email: `other_${suffix}@example.com`, countryCode: 'PL', phone: `+4850${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const seller = request.agent(createApp())
            const other = request.agent(createApp())
            let productId = ''
            try {
                expect((await seller.post('/api/auth/register').send(firstPayload)).status).toBe(201)
                expect((await other.post('/api/auth/register').send(secondPayload)).status).toBe(201)
                const category = (await seller.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                expect(category).toBeDefined()
                const created = await seller.post('/api/products').send({
                    categoryId: category.id, title: 'Пшениця', description: 'Сортова', quantity: 12.5, unit: 'ton', price: 250, currency: 'UAH',
                    deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active', photos: [{ url: 'https://cdn.example.com/wheat.jpg', alt: 'Зерно' }, { url: 'https://cdn.example.com/wheat-2.jpg', alt: 'Інше зерно' }],
                })
                expect(created.status).toBe(201)
                productId = created.body.product.id
                expect(created.body.product.photos).toHaveLength(2)
                const titleOnly = await seller.patch(`/api/products/${productId}`).send({ title: 'Назва без втрати даних' })
                expect(titleOnly.status).toBe(200)
                expect(titleOnly.body.product).toMatchObject({ description: 'Сортова', quantity: 12.5, unit: 'ton', price: { amount: 250, currency: 'UAH' }, deliveryMode: 'pickup', geoZone: 'Київська область' })
                expect(titleOnly.body.product.photos).toHaveLength(2)
                const reversedUrls = [...created.body.product.photos].reverse().map((photo: { url: string }) => ({ url: photo.url }))
                const reordered = await seller.patch(`/api/products/${productId}`).send({ photos: reversedUrls })
                expect(reordered.status).toBe(200)
                expect(reordered.body.product.photos.map((photo: { url: string }) => photo.url)).toEqual(reversedUrls.map((photo: { url: string }) => photo.url))
                expect((await seller.get(`/api/products/${productId}`)).body.product.photos.map((photo: { url: string }) => photo.url)).toEqual(reversedUrls.map((photo: { url: string }) => photo.url))
                expect((await seller.patch(`/api/products/${productId}`).send({ photos: Array(9).fill(reversedUrls[0]) })).status).toBe(400)
                expect((await seller.patch(`/api/products/${productId}`).send({ photos: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }] })).status).toBe(400)
                expect((await seller.get(`/api/products/${productId}`)).body.product.photos.map((photo: { url: string }) => photo.url)).toEqual(reversedUrls.map((photo: { url: string }) => photo.url))
                const clearedPhotos = await seller.patch(`/api/products/${productId}`).send({ photos: [] })
                expect(clearedPhotos.status).toBe(200)
                expect(clearedPhotos.body.product.photos).toEqual([])

                // Guests can search both titles and descriptions without signing in.
                await seller.patch(`/api/products/${productId}`).send({ title: `Public title ${suffix}`, description: `Public description ${suffix}` })
                const guest = request(createApp())
                for (const q of [`title ${suffix}`, `description ${suffix}`]) {
                    const found = await guest.get('/api/products').query({ q })
                    expect(found.status).toBe(200)
                    expect(found.body.products.map((item: { id: string }) => item.id)).toContain(productId)
                }
                const absent = await guest.get('/api/products').query({ q: `missing-${suffix}` })
                expect(absent.status).toBe(200)
                expect(absent.body.products).toEqual([])
                const otherCity = await guest.get('/api/products').query({ q: `title ${suffix}`, geoZone: `missing-city-${suffix}` })
                expect(otherCity.body.products).toEqual([])

                expect((await other.patch(`/api/products/${productId}`).send({ title: 'Чужий товар' })).status).toBe(404)
                expect((await other.patch(`/api/products/${productId}`).send({ photos: [{ url: 'https://attacker.example/photo.jpg' }] })).status).toBe(404)
                expect((await other.delete(`/api/products/${productId}`)).status).toBe(404)
                expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Оновлена пшениця' })).status).toBe(200)
                expect((await seller.get(`/api/products/${productId}`)).body.product.title).toBe('Оновлена пшениця')
                expect((await other.get(`/api/products/${productId}`)).status).toBe(200)
                const paused = await seller.patch(`/api/products/${productId}`).send({ status: 'paused' })
                expect(paused.status).toBe(200)
                expect(paused.body.product.status).toBe('paused')
                expect((await other.get(`/api/products/${productId}`)).status).toBe(404)
                expect((await seller.get('/api/products/mine?limit=1')).body.products[0].status).toBe('paused')
                const page = await seller.get('/api/products?limit=1&page=1')
                expect(page.status).toBe(200)
                expect(page.body.pagination).toMatchObject({ page: 1, limit: 1 })
                expect((await seller.delete(`/api/products/${productId}`)).status).toBe(204)
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [firstPayload.username.toLowerCase(), secondPayload.username.toLowerCase()])
            }
        }, 30000)

        it('returns exact private editor data only to the owner, including paused and sold products', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const ownerPayload = { username: `pown_${suffix}`, email: `pown_${suffix}@example.com`, countryCode: 'UA', phone: `+38067${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }
            const outsiderPayload = { username: `pout_${suffix}`, email: `pout_${suffix}@example.com`, countryCode: 'UA', phone: `+38063${suffix.slice(-7)}`, password: 'AnotherPassword2', passwordConfirmation: 'AnotherPassword2' }
            const owner = request.agent(createApp())
            const outsider = request.agent(createApp())
            const guest = request(createApp())
            try {
                expect((await owner.post('/api/auth/register').send(ownerPayload)).status).toBe(201)
                expect((await outsider.post('/api/auth/register').send(outsiderPayload)).status).toBe(201)
                const category = (await guest.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
                const address = `Приватна адреса ${suffix}`
                const latitude = 50.619912
                const longitude = 26.251612
                const created = await owner.post('/api/products').send({ categoryId: category.id, title: `Приватний товар ${suffix}`, description: 'Не змінювати адресу', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', address, latitude, longitude, addressVisibility: 'private', mapLocationMode: 'address', status: 'active' })
                expect(created.status).toBe(201)
                const id = created.body.product.id
                const exact = { address, coordinates: { latitude, longitude } }
                expect((await owner.get(`/api/products/${id}`)).body.product).toMatchObject(exact)
                for (const reader of [guest, outsider]) {
                    const publicProduct = await reader.get(`/api/products/${id}`)
                    expect(publicProduct.status).toBe(200)
                    expect(publicProduct.body.product.address).toBeNull()
                    expect(publicProduct.body.product.coordinates).toEqual({ latitude: 50.62, longitude: 26.25 })
                    expect(JSON.stringify(publicProduct.body)).not.toContain(address)
                }
                const titleOnly = await owner.patch(`/api/products/${id}`).send({ title: `Нова назва ${suffix}` })
                expect(titleOnly.status).toBe(200)
                expect(titleOnly.body.product).toMatchObject(exact)
                expect((await owner.get(`/api/products/${id}`)).body.product).toMatchObject({ title: `Нова назва ${suffix}`, ...exact })
                expect((await owner.patch(`/api/products/${id}`).send({ status: 'paused' })).status).toBe(200)
                expect((await owner.get(`/api/products/${id}`)).body.product).toMatchObject({ status: 'paused', ...exact })
                expect((await guest.get(`/api/products/${id}`)).status).toBe(404)
                expect((await outsider.get(`/api/products/${id}`)).status).toBe(404)
                expect((await owner.patch(`/api/products/${id}`).send({ status: 'sold' })).status).toBe(200)
                expect((await owner.get(`/api/products/${id}`)).body.product).toMatchObject({ status: 'sold', ...exact })
                expect((await outsider.patch(`/api/products/${id}`).send({ title: 'Немає прав' })).status).toBe(404)
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [ownerPayload.username.toLowerCase(), outsiderPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('products HTTP integration (requires DATABASE_URL)', () => { })
}
