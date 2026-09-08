import { describe, expect, it } from 'vitest'
import request from 'supertest'

const hasDatabase = Boolean(process.env.DATABASE_URL)

if (hasDatabase) {
    const { createApp } = await import('./app.js')
    const { pool } = await import('./db/client.js')

    describe('auth HTTP integration', () => {
        it('protects the current-user endpoint without a session', async () => {
            const response = await request(createApp()).get('/api/auth/me')
            expect(response.status).toBe(401)
            expect(response.body.error).toBe('AUTH_REQUIRED')
        })

        it('protects private profile routes and does not allow phone disclosure without consent', async () => {
            const unauthenticated = await request(createApp()).get('/api/profile/me')
            expect(unauthenticated.status).toBe(401)

            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const payload = {
                username: `privacy_${suffix}`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`,
                password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1',
            }
            const agent = request.agent(createApp())
            try {
                expect((await agent.post('/api/auth/register').send(payload)).status).toBe(201)
                const denied = await agent.patch('/api/profile/me/privacy').send({ phoneVisibility: 'public', phoneDisclosureConsent: false })
                expect(denied.status).toBe(400)
                expect(denied.body.error).toBe('CONSENT_REQUIRED')

                const privateProfile = await agent.get(`/api/profiles/${payload.username}`)
                expect(privateProfile.status).toBe(200)
                expect(privateProfile.body.profile.phone).toBeNull()
                expect(privateProfile.body.profile).not.toHaveProperty('exactAddress')
                expect(privateProfile.body.profile).not.toHaveProperty('recoveryEmail')
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized = $1', [payload.username.toLowerCase()])
            }
        }, 30000)

        it('rejects invalid registration before database access', async () => {
            const response = await request(createApp()).post('/api/auth/register').send({
                username: 'x', countryCode: 'U', phone: 'bad', password: 'weak', passwordConfirmation: 'different',
            })
            expect(response.status).toBe(400)
            expect(response.body.error).toBe('VALIDATION_ERROR')
        })

        it('registers, protects, logs in, rejects duplicates, and logs out', async () => {
            const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
            const firstPayload = {
                username: `test_${suffix}`,
                countryCode: 'UA',
                phone: `+38050${suffix.slice(-7)}`,
                password: 'StrongPassword1',
                passwordConfirmation: 'StrongPassword1',
            }
            const secondPayload = {
                username: `test_two_${suffix}`,
                countryCode: 'PL',
                phone: `+4850${suffix.slice(-7)}`,
                password: 'AnotherPassword2',
                passwordConfirmation: 'AnotherPassword2',
            }
            const firstAgent = request.agent(createApp())
            const secondAgent = request.agent(createApp())

            try {
                const firstRegistration = await firstAgent.post('/api/auth/register').send(firstPayload)
                const secondRegistration = await secondAgent.post('/api/auth/register').send(secondPayload)
                expect(firstRegistration.status).toBe(201)
                expect(secondRegistration.status).toBe(201)
                expect(firstRegistration.body.user).not.toHaveProperty('password_hash')
                expect(secondRegistration.body.user).not.toHaveProperty('password_hash')

                const storedPasswords = await pool.query(
                    'SELECT username, password_hash FROM users WHERE username_normalized IN ($1, $2)',
                    [firstPayload.username.toLowerCase(), secondPayload.username.toLowerCase()],
                )
                expect(storedPasswords.rows).toHaveLength(2)
                expect(storedPasswords.rows.every((row) => row.password_hash.startsWith('$2'))).toBe(true)
                expect(storedPasswords.rows.some((row) => row.password_hash === firstPayload.password || row.password_hash === secondPayload.password)).toBe(false)

                const invalidConfirmation = await request(createApp()).post('/api/auth/register').send({ ...firstPayload, passwordConfirmation: 'WrongConfirmation1' })
                expect(invalidConfirmation.status).toBe(400)
                expect(invalidConfirmation.body.error).toBe('VALIDATION_ERROR')

                const duplicate = await request(createApp()).post('/api/auth/register').send(firstPayload)
                expect(duplicate.status).toBe(409)
                expect(duplicate.body.message).toBe('Не вдалося створити обліковий запис із вказаними даними')
                expect(duplicate.body).not.toHaveProperty('username')
                expect(duplicate.body).not.toHaveProperty('phone')

                const wrongPassword = await request(createApp()).post('/api/auth/login').send({ username: firstPayload.username, password: 'WrongPassword1' })
                expect(wrongPassword.status).toBe(401)
                expect(wrongPassword.body).toEqual({ error: 'INVALID_CREDENTIALS', message: 'Неправильні облікові дані' })

                const currentUser = await firstAgent.get('/api/auth/me')
                expect(currentUser.status).toBe(200)
                expect(currentUser.body.user.username).toBe(firstPayload.username)

                await firstAgent.post('/api/auth/logout')
                expect((await firstAgent.get('/api/auth/me')).status).toBe(401)

                const login = await firstAgent.post('/api/auth/login').send({ username: firstPayload.username, password: firstPayload.password })
                expect(login.status).toBe(200)
                expect((await firstAgent.get('/api/auth/me')).status).toBe(200)
            } finally {
                await pool.query('DELETE FROM users WHERE username_normalized IN ($1, $2)', [firstPayload.username.toLowerCase(), secondPayload.username.toLowerCase()])
            }
        }, 30000)
    })
} else {
    describe.skip('auth HTTP integration (requires DATABASE_URL)', () => { })
}
