import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

const hasDatabase = Boolean(process.env.DATABASE_URL)
type TestAgent = ReturnType<typeof request.agent>
type Notification = { id: string; title: string; context: 'buying' | 'selling' | null; readAt: string | null; buyRequestId: string | null }
type NotificationResponse = { notifications: Notification[]; unreadCounts: { total: number; buying: number; selling: number } }

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('notification context and read integration', () => {
        const app = createApp()
        const buyer = request.agent(app)
        const seller = request.agent(app)
        const volumeUser = request.agent(app)
        const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
        const usernames = [`notification_buyer_${suffix}`, `notification_seller_${suffix}`, `notification_volume_${suffix}`]
        let buyerId: string
        let sellerId: string
        let volumeUserId: string
        let requestId: string
        let offerId: string

        beforeAll(async () => {
            const register = async (agent: TestAgent, username: string, phone: string) => {
                const result = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })
                expect(result.status, JSON.stringify(result.body)).toBe(201)
                return result.body.user.id as string
            }
            buyerId = await register(buyer, usernames[0], `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)
            sellerId = await register(seller, usernames[1], `+38050${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)
            volumeUserId = await register(volumeUser, usernames[2], `+38093${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`)
            const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains')
            const created = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Запит для сповіщень', description: '', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 20, delivery: 'no', geoArea: 'Київ', fulfillmentMode: 'multiple_sellers' })
            expect(created.status).toBe(201)
            requestId = created.body.buyRequest.id
            const offered = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ quantity: 10, unit: 'kg', price: 10, currency: 'UAH', delivery: 'Самовивіз' })
            expect(offered.status).toBe(201)
            offerId = offered.body.offer.id
        }, 30000)

        afterAll(async () => {
            await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[buyerId, sellerId, volumeUserId]])
        })

        it('persists structured context and references without classifying legacy history', async () => {
            const buyerNotifications = (await buyer.get('/api/notifications')).body.notifications
            expect(buyerNotifications.find((item: any) => item.title === 'Нова пропозиція')).toMatchObject({ context: 'buying', buyRequestId: requestId })

            expect((await buyer.post(`/api/offers/${offerId}/reject`)).status).toBe(204)
            const sellerNotifications = (await seller.get('/api/notifications')).body.notifications
            expect(sellerNotifications.find((item: any) => item.title === 'Пропозицію відхилено')).toMatchObject({ context: 'selling', buyRequestId: requestId })

            await pool.query("INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'system', 'Стара подія', '')", [buyerId])
            const withLegacy = (await buyer.get('/api/notifications')).body.notifications
            expect(withLegacy.find((item: any) => item.title === 'Стара подія')).toMatchObject({ context: null })
        })

        it('marks one notification and only the selected context as read', async () => {
            await pool.query("INSERT INTO notifications (user_id, type, title, body, context) VALUES ($1, 'system', 'Купівля', '', 'buying'), ($1, 'system', 'Продаж', '', 'selling'), ($1, 'system', 'Legacy', '', NULL)", [buyerId])
            const before = (await buyer.get('/api/notifications')).body.notifications
            const buying = before.find((item: any) => item.title === 'Купівля')
            expect((await buyer.patch('/api/notifications/read').send({ notificationId: buying.id })).status).toBe(200)
            expect((await buyer.patch('/api/notifications/read').send({ context: 'selling' })).status).toBe(200)
            const after = (await buyer.get('/api/notifications')).body.notifications
            expect(after.find((item: any) => item.title === 'Купівля').readAt).toBeTruthy()
            expect(after.find((item: any) => item.title === 'Продаж').readAt).toBeTruthy()
            expect(after.find((item: any) => item.title === 'Legacy').readAt).toBeNull()
        })

        it('returns exact unread counters when history exceeds the visible 100 notifications', async () => {
            const inserted = await pool.query(`INSERT INTO notifications (user_id, type, title, body, context, created_at)
                SELECT $1, 'system', 'Volume notification ' || value, '',
                    CASE WHEN value % 3 = 0 THEN 'buying' WHEN value % 3 = 1 THEN 'selling' ELSE NULL END,
                    TIMESTAMPTZ '2026-01-01 00:00:00Z' + value * INTERVAL '1 second'
                FROM generate_series(1, 105) AS value
                RETURNING id, title`, [volumeUserId])
            const byTitle = new Map(inserted.rows.map((item: { id: string; title: string }) => [item.title, item.id]))

            const initial = (await volumeUser.get('/api/notifications')).body as NotificationResponse
            expect(initial.notifications).toHaveLength(100)
            expect(initial.notifications.some((item) => item.title === 'Volume notification 1')).toBe(false)
            expect(initial.unreadCounts).toEqual({ total: 105, buying: 35, selling: 35 })

            const oldestSellingId = byTitle.get('Volume notification 1')
            const newestBuyingId = byTitle.get('Volume notification 105')
            if (!oldestSellingId || !newestBuyingId) throw new Error('Missing volume notification fixtures')
            expect((await volumeUser.patch('/api/notifications/read').send({ notificationId: oldestSellingId })).status).toBe(200)
            expect((await volumeUser.patch('/api/notifications/read').send({ notificationId: newestBuyingId })).status).toBe(200)
            expect((await volumeUser.patch('/api/notifications/read').send({ context: 'buying' })).status).toBe(200)

            const afterBuyingReadAll = (await volumeUser.get('/api/notifications')).body as NotificationResponse
            expect(afterBuyingReadAll.unreadCounts).toEqual({ total: 69, buying: 0, selling: 34 })
            const legacyUnread = await pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND context IS NULL AND read_at IS NULL', [volumeUserId])
            expect(legacyUnread.rows[0].count).toBe(35)
        })
    })
} else describe.skip('notification integration requires DATABASE_URL', () => {})
