import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createHash } from 'node:crypto'

let expireDuringProvider: (() => Promise<void>) | null = null

vi.mock('./external-auth-providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./external-auth-providers.js')>()
    return { ...actual, exchangeProfile: vi.fn(async (provider: string, _config: unknown, code: string) => {
        if (code.startsWith('stale-during')) await expireDuringProvider?.()
        return {
        provider,
        providerUserId: code,
        email: code.startsWith('no-email') ? null : `${code}@example.invalid`,
        emailVerified: provider !== 'facebook',
        username: code,
        displayName: code,
        avatarUrl: null,
        }
    }) }
})

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    const { safeReturnPath } = await import('./external-auth.js')
    const app = createApp()
    const prefix = `ext${Date.now()}`
    let sequence = 0
    const profile = () => {
        sequence += 1
        return { username: `${prefix}${sequence}`, email: `${prefix}${sequence}@example.invalid`, countryCode: 'UA', phone: `+38050${String(Date.now() + sequence).slice(-7)}` }
    }
    const stateFrom = (location: string) => new URL(location).searchParams.get('state')!
    const start = async (agent: ReturnType<typeof request.agent>, provider: string, intent = 'login', returnPath = '/dashboard', origin = 'login') => {
        const response = await agent.get(`/api/auth/external/${provider}/start`).query({ intent, return: returnPath, origin })
        expect(response.status).toBe(302)
        return stateFrom(response.headers.location)
    }
    const callback = (agent: ReturnType<typeof request.agent>, provider: string, state: string, code: string) =>
        agent.get(`/api/auth/external/${provider}/callback`).query({ state, code })
    const finish = async (agent: ReturnType<typeof request.agent>, data = profile()) => agent.post('/api/auth/external/finish').send(data)

    describe('external auth HTTP and database', () => {
        beforeAll(() => {
            process.env.PUBLIC_API_URL = 'http://127.0.0.1:5173'
            process.env.FRONTEND_URL = 'http://127.0.0.1:5173'
            for (const provider of ['GOOGLE', 'FACEBOOK', 'TELEGRAM']) {
                process.env[`${provider}_CLIENT_ID`] = `test-${provider}`
                process.env[`${provider}_CLIENT_SECRET`] = `test-${provider}-secret`
            }
        })
        afterAll(async () => {
            await pool.query('DELETE FROM users WHERE username_normalized LIKE $1', [`${prefix}%`])
            for (const provider of ['GOOGLE', 'FACEBOOK', 'TELEGRAM']) {
                delete process.env[`${provider}_CLIENT_ID`]
                delete process.env[`${provider}_CLIENT_SECRET`]
            }
            delete process.env.PUBLIC_API_URL
        })

        it('accepts only internal return paths', () => {
            expect(safeReturnPath('/messages/123?tab=all')).toBe('/messages/123?tab=all')
            for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '']) {
                expect(safeReturnPath(unsafe)).toBe('/dashboard')
            }
        })

        it.each(['google', 'facebook', 'telegram'])('registers, logs in, and prevents the last unlink for %s', async provider => {
            const agent = request.agent(app)
            const id = `no-email-${prefix}-${provider}`
            const state = await start(agent, provider, 'login', '/dashboard', 'register')
            const first = await callback(agent, provider, state, id)
            expect(first.status).toBe(303)
            expect(first.headers.location).toContain('/auth/external/finish')
            expect((await agent.get('/api/auth/external/pending')).body).toMatchObject({ provider, originPage: 'register', emailConflict: false })
            const registered = await finish(agent)
            expect(registered.status).toBe(201)
            const userId = registered.body.user.id
            expect((await agent.get('/api/auth/me')).body.user.id).toBe(userId)
            expect((await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash).toBeNull()
            expect((await agent.delete(`/api/auth/external/methods/${provider}`)).body.error).toBe('LAST_LOGIN_METHOD')
            await agent.post('/api/auth/logout')
            const loginState = await start(agent, provider, 'login', '/orders')
            expect((await callback(agent, provider, loginState, id)).headers.location).toBe('http://127.0.0.1:5173/orders')
            expect((await agent.get('/api/auth/me')).body.user.id).toBe(userId)
        }, 120000)

        it('preserves a password user across link and external login, and denies identity stealing', async () => {
            const owner = request.agent(app)
            const other = request.agent(app)
            const ownerData = profile()
            const otherData = profile()
            const password = 'StrongPassword1'
            const a = await owner.post('/api/auth/register').send({ ...ownerData, password, passwordConfirmation: password })
            const b = await other.post('/api/auth/register').send({ ...otherData, password, passwordConfirmation: password })
            expect(a.status).toBe(201)
            expect(b.status).toBe(201)
            const code = `linked-${prefix}`
            const linkState = await start(owner, 'google', 'link')
            expect((await callback(owner, 'google', linkState, code)).headers.location).toContain('externalAuth=linked')
            const stealState = await start(other, 'google', 'link')
            expect((await callback(other, 'google', stealState, code)).headers.location).toContain('identity-conflict')
            expect((await pool.query('SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', ['google', code])).rows[0].user_id).toBe(a.body.user.id)
            await owner.post('/api/auth/logout')
            const loginState = await start(owner, 'google')
            await callback(owner, 'google', loginState, code)
            expect((await owner.get('/api/auth/me')).body.user.id).toBe(a.body.user.id)
            await owner.post('/api/auth/logout')
            expect((await owner.post('/api/auth/login').send({ username: ownerData.username, password })).body.user.id).toBe(a.body.user.id)
            expect((await owner.delete('/api/auth/external/methods/google')).status).toBe(204)
        }, 120000)

        it('rejects email collision, replay, wrong provider and an external return URL', async () => {
            const agent = request.agent(app)
            const data = profile()
            const password = 'StrongPassword1'
            expect((await agent.post('/api/auth/register').send({ ...data, password, passwordConfirmation: password })).status).toBe(201)
            await agent.post('/api/auth/logout')
            const state = await start(agent, 'google', 'login', 'https://evil.example/path')
            expect((await callback(agent, 'facebook', state, data.email.replace('@example.invalid', ''))).headers.location).toContain('invalid-state')
            await pool.query('DELETE FROM external_auth_flows WHERE state_hash = $1', [createHash('sha256').update(state).digest('hex')])
            const validState = await start(agent, 'google', 'login', 'https://evil.example/path')
            const collision = await callback(agent, 'google', validState, data.email.replace('@example.invalid', ''))
            expect(collision.headers.location).toContain('/auth/external/finish')
            expect((await agent.get('/api/auth/external/pending')).body.emailConflict).toBe(true)
            expect((await finish(agent, { ...profile(), email: `other-${prefix}@example.invalid` })).status).toBe(409)
            expect((await callback(agent, 'google', validState, data.email.replace('@example.invalid', ''))).headers.location).toContain('invalid-state')
            expect((await pool.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider_user_id = $1', [data.email.replace('@example.invalid', '')])).rows[0].count).toBe(0)
        }, 120000)

        it('allows only one user when two first signups finish concurrently for the same identity', async () => {
            const agents = [request.agent(app), request.agent(app)]
            const code = `race-${prefix}`
            for (const agent of agents) {
                const state = await start(agent, 'telegram')
                expect((await callback(agent, 'telegram', state, code)).status).toBe(303)
            }
            const results = await Promise.all(agents.map(agent => finish(agent)))
            expect(results.map(result => result.status).sort()).toEqual([201, 409])
            expect((await pool.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', ['telegram', code])).rows[0].count).toBe(1)
        }, 120000)

        it('rejects expired state and cancellation without creating a user', async () => {
            const agent = request.agent(app)
            const expired = await start(agent, 'google')
            await pool.query('UPDATE external_auth_flows SET expires_at = now() - interval \'1 second\' WHERE state_hash = $1', [createHash('sha256').update(expired).digest('hex')])
            expect((await callback(agent, 'google', expired, `expired-${prefix}`)).headers.location).toContain('invalid-state')
            const cancelled = await start(agent, 'telegram')
            const result = await agent.get('/api/auth/external/telegram/callback').query({ state: cancelled, error: 'access_denied' })
            expect(result.headers.location).toContain('cancelled')
            expect((await pool.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider_user_id = $1', [`expired-${prefix}`])).rows[0].count).toBe(0)
        }, 120000)

        it('binds link callback to the original authenticated session and supports another provider', async () => {
            const agent = request.agent(app)
            const data = profile()
            const password = 'StrongPassword1'
            const registration = await agent.post('/api/auth/register').send({ ...data, password, passwordConfirmation: password })
            expect(registration.status).toBe(201)
            const oldState = await start(agent, 'facebook', 'link')
            await agent.post('/api/auth/logout')
            await agent.post('/api/auth/login').send({ username: data.username, password })
            expect((await callback(agent, 'facebook', oldState, `old-${prefix}`)).headers.location).toContain('invalid-state')
            const facebook = await start(agent, 'facebook', 'link')
            expect((await callback(agent, 'facebook', facebook, `fb-${prefix}`)).headers.location).toContain('linked')
            const telegram = await start(agent, 'telegram', 'link')
            expect((await callback(agent, 'telegram', telegram, `tg-${prefix}`)).headers.location).toContain('linked')
            const methods = await agent.get('/api/auth/external/methods')
            expect(methods.body.identities.map((item: { provider: string }) => item.provider).sort()).toEqual(['facebook', 'telegram'])
            await agent.post('/api/auth/logout')
            const telegramLogin = await start(agent, 'telegram')
            await callback(agent, 'telegram', telegramLogin, `tg-${prefix}`)
            expect((await agent.get('/api/auth/me')).body.user.id).toBe(registration.body.user.id)
            expect((await agent.delete('/api/auth/external/methods/facebook')).status).toBe(204)
            expect((await agent.delete('/api/auth/external/methods/telegram')).status).toBe(204)
        }, 120000)

        it('requires a fresh session for link start and callback, and consumes the link flow once', async () => {
            const agent = request.agent(app)
            const data = profile()
            const password = 'StrongPassword1'
            const registration = await agent.post('/api/auth/register').send({ ...data, password, passwordConfirmation: password })
            expect(registration.status).toBe(201)
            await pool.query("UPDATE user_sessions SET created_at = now() - interval '10 minutes 1 second' WHERE user_id = $1", [registration.body.user.id])
            const denied = await agent.get('/api/auth/external/telegram/start').query({ intent: 'link' })
            expect(denied.status).toBe(403)
            expect(denied.body.error).toBe('REAUTH_REQUIRED')

            expect((await agent.post('/api/auth/login').send({ username: data.username, password })).status).toBe(200)
            await pool.query("UPDATE user_sessions SET created_at = now() - interval '9 minutes 59 seconds' WHERE user_id = $1 AND revoked_at IS NULL", [registration.body.user.id])
            await start(agent, 'telegram', 'link')
            await pool.query("UPDATE user_sessions SET created_at = now() - interval '10 minutes 1 second' WHERE user_id = $1 AND revoked_at IS NULL", [registration.body.user.id])
            const boundaryDenied = await agent.get('/api/auth/external/telegram/start').query({ intent: 'link' })
            expect(boundaryDenied.status).toBe(403)
            expect(boundaryDenied.body.error).toBe('REAUTH_REQUIRED')

            expect((await agent.post('/api/auth/login').send({ username: data.username, password })).status).toBe(200)
            const state = await start(agent, 'telegram', 'link')
            expireDuringProvider = async () => {
                await pool.query("UPDATE user_sessions SET created_at = now() - interval '10 minutes 1 second' WHERE user_id = $1 AND revoked_at IS NULL", [registration.body.user.id])
            }
            const expired = await callback(agent, 'telegram', state, `stale-during-${prefix}`)
            expireDuringProvider = null
            expect(expired.status).toBe(403)
            expect(expired.body.error).toBe('REAUTH_REQUIRED')
            expect((await pool.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider_user_id = $1', [`stale-during-${prefix}`])).rows[0].count).toBe(0)

            expect((await agent.post('/api/auth/login').send({ username: data.username, password })).status).toBe(200)
            const freshState = await start(agent, 'telegram', 'link')
            expect((await callback(agent, 'telegram', freshState, `replay-link-${prefix}`)).headers.location).toContain('linked')
            expect((await callback(agent, 'telegram', freshState, `replay-link-${prefix}`)).headers.location).toContain('invalid-state')
        }, 120000)

    })
}
