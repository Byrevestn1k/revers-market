import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('./external-auth-providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./external-auth-providers.js')>()
    return { ...actual, exchangeProfile: vi.fn(async (provider: string, _config: unknown, code: string) => ({
        provider,
        providerUserId: code,
        email: code.startsWith('no-email') ? null : `${code}@example.invalid`,
        emailVerified: provider === 'google',
        username: code,
        displayName: code,
        avatarUrl: null,
    })) }
})

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')
    const app = createApp()
    const prefix = `choice${Date.now()}`
    let sequence = 0
    const profile = () => {
        sequence += 1
        return { username: `${prefix}${sequence}`, email: `${prefix}${sequence}@example.invalid`, countryCode: 'UA', phone: `+38050${String(Date.now() + sequence).slice(-7)}` }
    }
    const start = async (agent: ReturnType<typeof request.agent>, provider: string, origin = 'login', returnPath = '/dashboard') => {
        const result = await agent.get(`/api/auth/external/${provider}/start`).query({ intent: 'login', origin, return: returnPath })
        expect(result.status).toBe(302)
        return new URL(result.headers.location).searchParams.get('state')!
    }
    const callback = (agent: ReturnType<typeof request.agent>, provider: string, state: string, code: string) =>
        agent.get(`/api/auth/external/${provider}/callback`).query({ state, code })

    describe('explicit external account choice', () => {
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

        it('requires explicit proof before linking same-email Facebook or no-email Telegram to a Google user', async () => {
            const agent = request.agent(app)
            const googleCode = `same-email-${prefix}`
            await callback(agent, 'google', await start(agent, 'google', 'register'), googleCode)
            const registered = await agent.post('/api/auth/external/finish').send({ ...profile(), email: `${googleCode}@example.invalid` })
            expect(registered.status).toBe(201)
            const userId = registered.body.user.id
            await agent.post('/api/auth/logout')

            expect((await callback(agent, 'facebook', await start(agent, 'facebook'), googleCode)).headers.location).toContain('/auth/external/finish')
            expect((await agent.get('/api/auth/external/pending')).body).toMatchObject({ provider: 'facebook', originPage: 'login', emailConflict: true })
            expect((await agent.get('/api/auth/me')).status).toBe(401)
            expect((await pool.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', ['facebook', googleCode])).rows[0].count).toBe(0)

            await callback(agent, 'google', await start(agent, 'google', 'confirm', '/auth/external/finish?existing=1'), googleCode)
            expect((await agent.get('/api/auth/me')).body.user.id).toBe(userId)
            const facebookLink = await agent.post('/api/auth/external/finish/link')
            expect(facebookLink.status).toBe(200)
            expect(facebookLink.body.user.id).toBe(userId)
            expect((await agent.get('/api/auth/external/pending')).status).toBe(404)

            const telegramCode = `no-email-${prefix}-telegram-choice`
            expect((await callback(agent, 'telegram', await start(agent, 'telegram'), telegramCode)).headers.location).toContain('/auth/external/finish')
            expect((await agent.get('/api/auth/external/pending')).body).toMatchObject({ provider: 'telegram', email: null, originPage: 'login', emailConflict: false })
            expect((await agent.post('/api/auth/external/finish/link')).body.error).toBe('FRESH_LOGIN_REQUIRED')
            await agent.post('/api/auth/logout')
            await callback(agent, 'facebook', await start(agent, 'facebook', 'confirm', '/auth/external/finish?existing=1'), googleCode)
            expect((await agent.post('/api/auth/external/finish/link')).status).toBe(200)

            for (const [provider, code] of [['google', googleCode], ['facebook', googleCode], ['telegram', telegramCode]]) {
                await agent.post('/api/auth/logout')
                await callback(agent, provider, await start(agent, provider), code)
                expect((await agent.get('/api/auth/me')).body.user.id).toBe(userId)
            }
        }, 120000)

        it('cancels an unknown login without creating a user or leaving a reusable pending link', async () => {
            const agent = request.agent(app)
            const before = await pool.query('SELECT count(*)::int AS count FROM users')
            await callback(agent, 'telegram', await start(agent, 'telegram'), `no-email-cancel-${prefix}`)
            expect((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(before.rows[0].count)
            expect((await agent.post('/api/auth/external/pending/cancel')).status).toBe(204)
            expect((await agent.get('/api/auth/external/pending')).status).toBe(404)
            expect((await agent.post('/api/auth/external/finish/link')).status).toBe(401)
        }, 120000)
    })
}
