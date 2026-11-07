import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import bcrypt from 'bcryptjs'

const mocked = vi.hoisted(() => ({ send: vi.fn(), vapid: vi.fn() }))
vi.mock('web-push', () => ({ setVapidDetails: mocked.vapid, sendNotification: mocked.send }))

// Explicit opt-in prevents accidentally using the developer's main database.
if (process.env.STEP31_ISOLATED_TEST === '1') {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    const { dispatchPushBatch } = await import('./web-push-service.js')
    const app = createApp()
    const ids: string[] = []
    const password = 'StrongPassword1'
    const secret = randomBytes(16).toString('base64url')
    const curve = createECDH('prime256v1'); curve.generateKeys()
    const valid = { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: secret } }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
    const names = [`pwa_a_${suffix}`, `pwa_b_${suffix}`]
    const tokenA = randomBytes(32).toString('base64url')
    const tokenB = randomBytes(32).toString('base64url')
    const cookie = (token: string) => `navpaky_session=${token}`
    let chat: string
    beforeAll(async () => {
        const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
        process.env.VAPID_PUBLIC_KEY = ecdh.getPublicKey().toString('base64url')
        process.env.VAPID_PRIVATE_KEY = ecdh.getPrivateKey().toString('base64url')
        process.env.VAPID_SUBJECT = 'mailto:test@example.invalid'
        const hashed = await bcrypt.hash(password, 4)
        for (const [index, name] of names.entries()) {
            const phone = `+380${randomBytes(5).readUIntBE(0, 5).toString().slice(0, 9).padStart(9, '0')}`
            const user = await pool.query('INSERT INTO users (username,username_normalized,country_code,phone,password_hash) VALUES ($1,$1,$2,$3,$4) RETURNING id', [name,'UA',phone,hashed])
            ids.push(user.rows[0].id)
            const token = index ? tokenB : tokenA
            await pool.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [ids[index], createHash('sha256').update(token).digest('hex')])
        }
        chat = (await pool.query('INSERT INTO conversations (profile_user_low,profile_user_high) VALUES ($1,$2) RETURNING id', [...ids].sort())).rows[0].id
    }, 30000)
    afterAll(async () => { if (chat) await pool.query('DELETE FROM conversations WHERE id=$1', [chat]); if (ids.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); await pool.end() })
    beforeEach(() => { mocked.send.mockReset(); mocked.send.mockResolvedValue({ statusCode: 201 }) })
    const add = (token: string, subscription: unknown = valid) => request(app).post('/api/push/subscriptions').set('Cookie',cookie(token)).send({ expectedUserId: token === tokenB ? ids[1] : ids[0], subscription })
    const notification = async (id: string) => pool.query("INSERT INTO notifications(user_id,type,title,body,conversation_id) VALUES ($1,'message','Нове повідомлення','СЕКРЕТНА АДРЕСА',$2)", [id,chat])

    describe('Web Push isolation', () => {
        it('rejects a subscription when the account changes after consent but before POST', async () => {
            const before = await request(app).get('/api/auth/me').set('Cookie',cookie(tokenA))
            expect(before.body.user.id).toBe(ids[0])
            const response = await request(app).post('/api/push/subscriptions').set('Cookie',cookie(tokenB)).send({ expectedUserId:before.body.user.id, subscription:valid })
            expect(response.status).toBe(409)
            expect(response.body.error).toBe('PUSH_ACCOUNT_CHANGED')
            expect((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rowCount).toBe(0)
            const missing = await request(app).post('/api/push/subscriptions').set('Cookie',cookie(tokenB)).send({subscription:valid})
            expect(missing.status).toBe(409)
        })
        it('requires auth, rejects SSRF and prevents endpoint takeover without both keys', async () => {
            expect((await request(app).post('/api/push/subscriptions').send({subscription:valid})).status).toBe(401)
            expect((await add(tokenA, {...valid,endpoint:'https://127.0.0.1/private'})).status).toBe(400)
            expect((await add(tokenA)).status).toBe(204)
            expect((await add(tokenB, {...valid,keys:{...valid.keys,auth:randomBytes(16).toString('base64url')}})).status).toBe(409)
            expect((await request(app).delete('/api/push/subscriptions').set('Cookie',cookie(tokenB)).send({endpoint:valid.endpoint})).status).toBe(204)
            expect((await pool.query('SELECT user_id FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rows[0].user_id).toBe(ids[0])
        })
        it('reports device status only for the current active session', async () => {
            const status = (token: string, endpoint: string = valid.endpoint) => request(app).post('/api/push/status').set('Cookie',cookie(token)).send({ endpoint })
            expect((await request(app).post('/api/push/status').send({endpoint:valid.endpoint})).status).toBe(401)
            const owner = await status(tokenA)
            expect(owner.body).toEqual({active:true})
            expect(owner.headers['cache-control']).toBe('no-store')
            expect((await status(tokenB)).body).toEqual({active:false})
            expect((await status(tokenA, 'missing')).body).toEqual({active:false})
            expect((await status(tokenA, '')).status).toBe(400)
            const otherToken = randomBytes(32).toString('base64url')
            const otherHash = createHash('sha256').update(otherToken).digest('hex')
            await pool.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day')", [ids[0],otherHash])
            expect((await status(otherToken)).body).toEqual({active:false})
            await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1', [otherHash])
            expect((await status(otherToken)).status).toBe(401)
        })
        it('invalidates a queued binding on account reassignment or logout', async () => {
            const temp = {...valid,endpoint:`https://fcm.googleapis.com/fcm/send/${randomUUID()}`}
            const binding = async () => (await pool.query('SELECT binding_id FROM push_subscriptions WHERE endpoint=$1',[temp.endpoint])).rows[0].binding_id as string
            const check = (token:string, value:string) => request(app).post('/api/push/binding').set('Cookie',cookie(token)).send({binding:value})
            expect((await add(tokenA,temp)).status).toBe(204)
            const old = await binding()
            expect((await check(tokenA,old)).body).toEqual({active:true})
            expect((await check(tokenB,old)).body).toEqual({active:false})
            expect((await add(tokenB,temp)).status).toBe(204)
            const next = await binding()
            expect(next).not.toBe(old)
            expect((await check(tokenB,old)).body).toEqual({active:false})
            expect((await check(tokenB,next)).body).toEqual({active:true})
            await request(app).delete('/api/push/subscriptions').set('Cookie',cookie(tokenB)).send({endpoint:temp.endpoint})
            expect((await check(tokenB,next)).body).toEqual({active:false})
            expect((await check(tokenA,'invalid')).status).toBe(400)
        })
        it('limits simultaneous device registrations and prunes old outbox rows even without VAPID', async () => {
            const attempts = Array.from({length:12}, () => ({...valid,endpoint:`https://fcm.googleapis.com/fcm/send/${randomUUID()}`}))
            const results = await Promise.all(attempts.map(s => add(tokenB,s)))
            expect(results.filter(r => r.status === 204)).toHaveLength(10)
            expect(results.filter(r => r.status === 429)).toHaveLength(2)
            await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1', [ids[1]])
            await notification(ids[0])
            const item = (await pool.query('SELECT id FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[ids[0]])).rows[0].id
            await pool.query("UPDATE push_outbox SET created_at=now()-interval '2 days' WHERE notification_id=$1",[item])
            const key = process.env.VAPID_PRIVATE_KEY
            try { delete process.env.VAPID_PRIVATE_KEY; await dispatchPushBatch() } finally { process.env.VAPID_PRIVATE_KEY = key }
            expect((await pool.query('SELECT 1 FROM push_outbox WHERE notification_id=$1',[item])).rowCount).toBe(0)
            expect(mocked.send).not.toHaveBeenCalled()
        }, 30000)
        it('serves the SPA at push destinations without exposing API routes as HTML', async () => {
            for (const path of [`/messages/${chat}`, '/my/requests?request=x&offer=y', '/notifications']) {
                const response = await request(app).get(path)
                expect(response.status).toBe(200)
                expect(response.headers['content-type']).toContain('text/html')
                expect(response.headers['cache-control']).toBe('no-store')
                expect(response.text).toContain('<div id="root"></div>')
            }
            expect((await request(app).get('/api/does-not-exist')).status).toBe(404)
        })
        it('delivers only to the recipient after commit, with generic data, without duplicates', async () => {
            const client = await pool.connect()
            await client.query('BEGIN')
            await client.query("INSERT INTO notifications(user_id,type,title,body,conversation_id) VALUES($1,'message','Нове повідомлення','secret',$2)", [ids[0],chat])
            await client.query('ROLLBACK'); client.release()
            await notification(ids[1]); await notification(ids[0])
            await Promise.all([dispatchPushBatch(), dispatchPushBatch()])
            expect(mocked.send).toHaveBeenCalledTimes(1)
            expect(mocked.send.mock.calls[0][0].endpoint).toBe(valid.endpoint)
            const payload = JSON.parse(mocked.send.mock.calls[0][1])
            expect(payload.url).toBe(`/messages/${chat}`)
            expect(JSON.stringify(payload)).not.toMatch(/СЕКРЕТ|secret|АДРЕСА/)
            await dispatchPushBatch(); expect(mocked.send).toHaveBeenCalledTimes(1)
        })
        it('removes expired subscription and does not retry ambiguous failure', async () => {
            mocked.send.mockRejectedValueOnce({statusCode:410})
            await notification(ids[0]); await dispatchPushBatch()
            expect((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rowCount).toBe(0)
            await add(tokenA); mocked.send.mockRejectedValueOnce(new Error('timeout'))
            await notification(ids[0]); await dispatchPushBatch(); await dispatchPushBatch()
            expect(mocked.send).toHaveBeenCalledTimes(2)
        })
        it('delivers real offer and chat API events to their actual recipients', async () => {
            expect((await add(tokenA)).status).toBe(204)
            const other = {...valid, endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`}
            expect((await add(tokenB, other)).status).toBe(204)
            const categoryResponse = await request(app).get('/api/categories').set('Cookie', cookie(tokenA))
            const category = categoryResponse.body.categories.find((item: {code: string}) => item.code === 'grains')
            expect(category).toBeDefined()
            const created = await request(app).post('/api/buy-requests').set('Cookie',cookie(tokenA)).send({ categoryId:category.id, title:'Запит для push тесту', description:'', quantity:10, unit:'kg', currency:'UAH', minPrice:1, maxPrice:20, delivery:'no', geoArea:'Київ', fulfillmentMode:'multiple_sellers' })
            expect(created.status, JSON.stringify(created.body)).toBe(201)
            const requestId = created.body.buyRequest.id
            const offerInput = {requestKey:randomUUID(), quantity:10, unit:'kg', price:10, currency:'UAH', delivery:'Самовивіз'}
            const offer = await request(app).post(`/api/buy-requests/${requestId}/offers`).set('Cookie',cookie(tokenB)).send(offerInput)
            expect(offer.status, JSON.stringify(offer.body)).toBe(201)
            const repeat = await request(app).post(`/api/buy-requests/${requestId}/offers`).set('Cookie',cookie(tokenB)).send(offerInput)
            expect(repeat.status).toBe(200)
            await dispatchPushBatch()
            expect(mocked.send).toHaveBeenCalledTimes(1)
            expect(mocked.send.mock.calls[0][0].endpoint).toBe(valid.endpoint)
            expect(JSON.parse(mocked.send.mock.calls[0][1]).url).toBe(`/my/requests?request=${requestId}&offer=${offer.body.offer.id}`)
            mocked.send.mockClear()
            await pool.query("INSERT INTO conversation_participants (conversation_id,user_id,role) VALUES ($1,$2,'buyer'),($1,$3,'seller') ON CONFLICT DO NOTHING", [chat,ids[0],ids[1]])
            const sent = await request(app).post(`/api/conversations/${chat}/messages`).set('Cookie',cookie(tokenA)).send({body:'Приватний текст і адреса'})
            expect(sent.status, JSON.stringify(sent.body)).toBe(201)
            await dispatchPushBatch()
            expect(mocked.send).toHaveBeenCalledTimes(1)
            expect(mocked.send.mock.calls[0][0].endpoint).toBe(other.endpoint)
            expect(JSON.parse(mocked.send.mock.calls[0][1]).url).toBe(`/messages/${chat}`)
            expect(mocked.send.mock.calls[0][1]).not.toContain('Приватний')
            await request(app).delete('/api/push/subscriptions').set('Cookie',cookie(tokenB)).send({endpoint:other.endpoint})
        }, 30000)
        it('serializes logout with an in-flight delivery and stops subsequent delivery', async () => {
            const temporaryToken = randomBytes(32).toString('base64url')
            const temporaryHash = createHash('sha256').update(temporaryToken).digest('hex')
            await pool.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day')", [ids[0],temporaryHash])
            await request(app).delete('/api/push/subscriptions').set('Cookie',cookie(tokenA)).send({endpoint:valid.endpoint})
            expect((await add(temporaryToken)).status).toBe(204)
            let release!: () => void
            let started!: () => void
            const startedPromise = new Promise<void>(resolve => { started = resolve })
            const deliveryBarrier = new Promise<void>(resolve => { release = resolve })
            mocked.send.mockImplementationOnce(async () => { started(); await deliveryBarrier; return {statusCode:201} })
            await notification(ids[0])
            const dispatch = dispatchPushBatch()
            await startedPromise
            let logoutCompleted = false
            const logout = request(app).post('/api/auth/logout').set('Cookie',cookie(temporaryToken)).then(response => { logoutCompleted = true; return response })
            await new Promise(resolve => setTimeout(resolve, 100))
            const completedBeforeRelease = logoutCompleted
            release()
            await dispatch
            expect(completedBeforeRelease).toBe(false)
            expect((await logout).status).toBe(204)
            await notification(ids[0]); await dispatchPushBatch()
            expect(mocked.send).toHaveBeenCalledTimes(1)
            expect((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rowCount).toBe(0)
        }, 30000)
        it('revokes the old device on switching accounts and logout', async () => {
            expect((await add(tokenA)).status).toBe(204)
            const login = await request(app).post('/api/auth/login').set('Cookie',cookie(tokenA)).send({username:names[1],password})
            expect(login.status).toBe(200)
            expect((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rowCount).toBe(0)
            expect((await request(app).get('/api/auth/me').set('Cookie',cookie(tokenA))).status).toBe(401)
            expect((await add(tokenB)).status).toBe(204)
            expect((await request(app).post('/api/auth/logout').set('Cookie',cookie(tokenB))).status).toBe(204)
            expect((await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint=$1',[valid.endpoint])).rowCount).toBe(0)
            expect((await add(tokenB)).status).toBe(401)
        })
    })
} else describe.skip('Web Push isolation (requires STEP31_ISOLATED_TEST=1)', () => { it('requires isolated database', () => {}) })
