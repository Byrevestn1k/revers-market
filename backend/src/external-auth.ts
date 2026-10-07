import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { pool } from './db/client.js'
import { createSession, optionalAuth, publicUser, requestSessionHash, requireAuth } from './auth.js'
import { emailTaken, normalizeEmail, createEmailVerification, sendVerificationEmail } from './email-verification.js'
import { isValidEmail, isValidPhone, normalizePhone } from './validation.js'
import { authorizationUrl, exchangeProfile, isProvider, providerAvailability, providerConfig, type AuthProvider, type ExternalProfile } from './external-auth-providers.js'

const FLOW_COOKIE = 'navpaky_external_flow'
const PENDING_COOKIE = 'navpaky_external_pending'
const FLOW_TTL_MS = 10 * 60_000
const FRESH_AUTH_TTL_MS = 10 * 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const cookieValue = (request: Request, name: string) => request.headers.cookie?.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
const setAuthCookie = (response: Response, name: string, value: string, maxAge = FLOW_TTL_MS / 1000) => {
    response.append('Set-Cookie', `${name}=${value}; Path=/api/auth/external; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
}
const setFlowCookie = (response: Response, value: string, maxAge?: number) => setAuthCookie(response, FLOW_COOKIE, value, maxAge)
const setPendingCookie = (response: Response, value: string, maxAge?: number) => setAuthCookie(response, PENDING_COOKIE, value, maxAge)
const frontendUrl = () => process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173'
export const safeReturnPath = (value: unknown, fallback = '/dashboard') => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f]/.test(value) || value.length > 2048) return fallback
    try {
        const base = new URL(frontendUrl())
        const resolved = new URL(value, base)
        return resolved.origin === base.origin && resolved.pathname.startsWith('/') ? `${resolved.pathname}${resolved.search}` : fallback
    } catch { return fallback }
}
const frontendRedirect = (response: Response, path: string, outcome?: string) => {
    const url = new URL(safeReturnPath(path), frontendUrl())
    if (outcome) url.searchParams.set('externalAuth', outcome)
    response.redirect(303, url.toString())
}
const authFailure = (response: Response, path: string, outcome: string, link = false) => {
    if (link) { frontendRedirect(response, '/settings/profile', outcome); return }
    const params = new URLSearchParams({ return: safeReturnPath(path), externalAuth: outcome })
    frontendRedirect(response, `/auth/login?${params}`)
}
const profileMetadata = (profile: ExternalProfile) => [profile.email, profile.username, profile.displayName, profile.avatarUrl]

type FlowRow = {
    provider: AuthProvider
    intent: 'login' | 'link' | 'signup'
    origin_page: 'login' | 'register' | 'settings' | 'confirm'
    user_id: string | null
    session_hash: string | null
    return_path: string
    code_verifier: string | null
    nonce: string | null
    profile: ExternalProfile | null
    created_at: Date
}

const attempts = new Map<string, { count: number; until: number }>()
const limit = (request: Request, response: Response, next: () => void) => {
    const key = request.ip ?? 'unknown'
    const now = Date.now()
    const previous = attempts.get(key)
    if (attempts.size > 10_000) for (const [address, entry] of attempts) if (entry.until < now) attempts.delete(address)
    const item = !previous || previous.until < now ? { count: 0, until: now + 60_000 } : previous
    item.count += 1
    attempts.set(key, item)
    if (item.count > 60) { response.status(429).json({ error: 'RATE_LIMITED', message: 'Забагато спроб. Спробуйте пізніше.' }); return }
    next()
}

const resultError = (status: number, error: string, message: string) => ({ status, body: { error, message } })

const hasFreshSession = async (userId: string, sessionHash: string | null) => {
    if (!sessionHash) return false
    const result = await pool.query(`SELECT 1 FROM user_sessions
        WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
          AND created_at >= $3`, [userId, sessionHash, new Date(Date.now() - FRESH_AUTH_TTL_MS)])
    return Boolean(result.rowCount)
}

export const externalAuthRouter = (providerExchange: typeof exchangeProfile = exchangeProfile) => {
    const router = Router()
    router.get('/availability', (_request, response) => response.json({ providers: providerAvailability() }))

    router.get('/methods', requireAuth, async (request, response, next) => {
        try {
            const [password, linked] = await Promise.all([
                pool.query('SELECT password_hash FROM users WHERE id = $1', [request.authUser!.id]),
                pool.query('SELECT provider, provider_email, provider_username, provider_display_name FROM auth_identities WHERE user_id = $1', [request.authUser!.id]),
            ])
            response.json({ password: Boolean(password.rows[0]?.password_hash), providers: providerAvailability(),
                identities: linked.rows.map(row => ({ provider: row.provider, email: row.provider_email, username: row.provider_username, displayName: row.provider_display_name })) })
        } catch (error) { next(error) }
    })

    router.get('/:provider/start', limit, optionalAuth, async (request, response, next) => {
        try {
            const providerName = String(request.params.provider)
            if (!isProvider(providerName)) { response.status(404).end(); return }
            const config = providerConfig(providerName)
            if (!config) { response.status(503).json({ error: 'PROVIDER_UNAVAILABLE', message: 'Цей спосіб входу зараз недоступний.' }); return }
            const intent = request.query.intent === 'link' ? 'link' : 'login'
            if (request.query.intent && !['link', 'login'].includes(String(request.query.intent))) { response.status(400).end(); return }
            const origin = request.query.origin ? String(request.query.origin) : 'login'
            if (!['login', 'register', 'confirm'].includes(origin)) { response.status(400).end(); return }
            const originPage = intent === 'link' ? 'settings' : origin
            if (intent === 'link' && !request.authUser) { response.status(401).json({ error: 'AUTH_REQUIRED' }); return }
            if (intent === 'link' && !await hasFreshSession(request.authUser!.id, requestSessionHash(request))) {
                response.status(403).json({ error: 'REAUTH_REQUIRED', message: 'Щоб підключити новий спосіб входу, підтвердьте, що це ваш акаунт.' }); return
            }
            if (originPage === 'confirm' && !cookieValue(request, PENDING_COOKIE)) { response.status(400).json({ error: 'FLOW_EXPIRED' }); return }
            if (intent === 'link' && request.get('sec-fetch-site') && request.get('sec-fetch-site') !== 'same-origin') {
                response.status(403).json({ error: 'INVALID_ORIGIN' }); return
            }
            const state = random()
            const verifier = random()
            const nonce = random()
            const returnPath = safeReturnPath(request.query.return, intent === 'link' ? '/settings/profile' : '/dashboard')
            await pool.query('DELETE FROM external_auth_flows WHERE expires_at < now()')
            await pool.query(`INSERT INTO external_auth_flows
                (state_hash, provider, intent, origin_page, user_id, session_hash, return_path, code_verifier, nonce, expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [hash(state), providerName, intent, originPage,
                intent === 'link' ? request.authUser!.id : null, intent === 'link' ? requestSessionHash(request) : null,
                returnPath, verifier, nonce, new Date(Date.now() + FLOW_TTL_MS)])
            setFlowCookie(response, state)
            response.redirect(302, authorizationUrl(providerName, config, state, verifier, nonce))
        } catch (error) { next(error) }
    })

    router.get('/:provider/callback', limit, optionalAuth, async (request, response) => {
        const providerName = String(request.params.provider)
        const state = typeof request.query.state === 'string' ? request.query.state : ''
        const browserState = cookieValue(request, FLOW_COOKIE)
        if (!isProvider(providerName) || !state || !browserState || !safeEqual(state, browserState)) {
            authFailure(response, '/dashboard', 'invalid-state'); return
        }
        setFlowCookie(response, '', 0)
        try {
            const consumed = await pool.query<FlowRow>(`DELETE FROM external_auth_flows WHERE state_hash = $1 AND provider = $2
                AND intent IN ('login','link') AND expires_at > now() RETURNING *`, [hash(state), providerName])
            const flow = consumed.rows[0]
            if (!flow) { authFailure(response, '/dashboard', 'invalid-state'); return }
            if (flow.intent === 'link' && (flow.user_id !== request.authUser?.id || flow.session_hash !== requestSessionHash(request))) {
                authFailure(response, flow.return_path, 'invalid-state', true); return
            }
            if (request.query.error) { authFailure(response, flow.return_path, 'cancelled', flow.intent === 'link'); return }
            const code = typeof request.query.code === 'string' ? request.query.code : ''
            const config = providerConfig(providerName)
            if (!code || !config || !flow.code_verifier || !flow.nonce) { authFailure(response, flow.return_path, 'failed', flow.intent === 'link'); return }
            const profile = await providerExchange(providerName, config, code, flow.code_verifier, flow.nonce)
            if (profile.provider !== providerName || !profile.providerUserId) { authFailure(response, flow.return_path, 'failed', flow.intent === 'link'); return }
            if (flow.intent === 'link') {
                const existing = await pool.query('SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', [providerName, profile.providerUserId])
                if (existing.rowCount && existing.rows[0].user_id !== flow.user_id) { authFailure(response, flow.return_path, 'identity-conflict', true); return }
                const own = await pool.query('SELECT provider_user_id FROM auth_identities WHERE user_id = $1 AND provider = $2', [flow.user_id, providerName])
                if (own.rowCount && own.rows[0].provider_user_id !== profile.providerUserId) { authFailure(response, flow.return_path, 'provider-connected', true); return }
                if (!await hasFreshSession(flow.user_id!, flow.session_hash)) {
                    response.status(403).json({ error: 'REAUTH_REQUIRED', message: 'Щоб підключити новий спосіб входу, підтвердьте, що це ваш акаунт.' }); return
                }
                if (!own.rowCount) await pool.query(`INSERT INTO auth_identities
                    (user_id, provider, provider_user_id, provider_email, provider_username, provider_display_name, provider_avatar_url)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [flow.user_id, providerName, profile.providerUserId, ...profileMetadata(profile)])
                frontendRedirect(response, '/settings/profile', 'linked'); return
            }
            const linked = await pool.query(`SELECT u.id, u.username, u.country_code, u.phone, u.email, u.email_verified
                FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.provider_user_id = $2`, [providerName, profile.providerUserId])
            if (linked.rowCount) {
                await pool.query(`UPDATE auth_identities SET provider_email = $3, provider_username = $4,
                    provider_display_name = $5, provider_avatar_url = $6, updated_at = now(), last_used_at = now()
                    WHERE provider = $1 AND provider_user_id = $2`, [providerName, profile.providerUserId, ...profileMetadata(profile)])
                await createSession(linked.rows[0].id, response)
                setFlowCookie(response, '', 0)
                frontendRedirect(response, flow.return_path); return
            }
            if (flow.origin_page === 'confirm') {
                const params = new URLSearchParams({ confirmExternal: '1', return: flow.return_path, externalAuth: 'not-linked' })
                frontendRedirect(response, `/auth/login?${params}`); return
            }
            const signupState = random()
            await pool.query(`INSERT INTO external_auth_flows
                (state_hash, provider, intent, origin_page, return_path, profile, expires_at)
                VALUES ($1,$2,'signup',$3,$4,$5,$6)`, [hash(signupState), providerName, flow.origin_page, flow.return_path,
                JSON.stringify(profile), new Date(Date.now() + FLOW_TTL_MS)])
            setPendingCookie(response, signupState)
            frontendRedirect(response, '/auth/external/finish')
        } catch (error) {
            if ((error as { code?: string }).code === '23505') authFailure(response, '/dashboard', 'identity-conflict')
            else authFailure(response, '/dashboard', 'failed')
        }
    })

    router.get('/pending', async (request, response, next) => {
        try {
            const value = cookieValue(request, PENDING_COOKIE)
            if (!value) { response.status(404).json({ error: 'FLOW_EXPIRED' }); return }
            const result = await pool.query<FlowRow>(`SELECT provider, profile, origin_page FROM external_auth_flows
                WHERE state_hash = $1 AND intent = 'signup' AND expires_at > now()`, [hash(value)])
            if (!result.rowCount) { response.status(404).json({ error: 'FLOW_EXPIRED' }); return }
            const profile = result.rows[0].profile!
            response.json({ provider: profile.provider, email: profile.email, displayName: profile.displayName,
                originPage: result.rows[0].origin_page, emailConflict: Boolean(profile.email && await emailTaken(profile.email)) })
        } catch (error) { next(error) }
    })

    router.post('/pending/cancel', async (request, response, next) => {
        try {
            const value = cookieValue(request, PENDING_COOKIE)
            if (value) await pool.query(`DELETE FROM external_auth_flows WHERE state_hash = $1 AND intent = 'signup'`, [hash(value)])
            setPendingCookie(response, '', 0)
            response.status(204).end()
        } catch (error) { next(error) }
    })

    router.post('/finish', limit, async (request, response, next) => {
        const value = cookieValue(request, PENDING_COOKIE)
        if (!value) { response.status(400).json({ error: 'FLOW_EXPIRED', message: 'Спробуйте увійти ще раз.' }); return }
        const input = request.body ?? {}
        const username = typeof input.username === 'string' ? input.username.trim() : ''
        const email = typeof input.email === 'string' ? input.email.trim() : ''
        const countryCode = typeof input.countryCode === 'string' ? input.countryCode.trim().toUpperCase() : ''
        const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || !isValidEmail(email) || !isValidPhone(countryCode, phone)) {
            response.status(400).json({ error: 'VALIDATION_ERROR', message: 'Перевірте логін, пошту та номер телефону.' }); return
        }
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const consumed = await client.query<FlowRow>(`DELETE FROM external_auth_flows WHERE state_hash = $1
                AND intent = 'signup' AND expires_at > now() RETURNING *`, [hash(value)])
            const flow = consumed.rows[0]
            if (!flow?.profile) { await client.query('ROLLBACK'); response.status(400).json({ error: 'FLOW_EXPIRED', message: 'Спробуйте увійти ще раз.' }); return }
            const profile = flow.profile
            const collision = await client.query(`SELECT 1 FROM users WHERE email_normalized IN ($1,$4) OR pending_email_normalized IN ($1,$4)
                OR username_normalized = $2 OR phone = $3 LIMIT 1`, [normalizeEmail(email), username.toLowerCase(), normalizePhone(countryCode, phone), profile.email ? normalizeEmail(profile.email) : null])
            if (collision.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'ACCOUNT_EXISTS', message: 'Ці дані вже використано. Увійдіть у свій акаунт, щоб підключити цей спосіб входу.' }); return }
            const created = await client.query(`INSERT INTO users
                (username, username_normalized, email, email_normalized, country_code, phone, password_hash)
                VALUES ($1,$2,$3,$4,$5,$6,NULL) RETURNING id, username, country_code, phone, email, email_verified`,
                [username, username.toLowerCase(), email, normalizeEmail(email), countryCode, normalizePhone(countryCode, phone)])
            await client.query(`INSERT INTO auth_identities
                (user_id, provider, provider_user_id, provider_email, provider_username, provider_display_name, provider_avatar_url, last_used_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [created.rows[0].id, profile.provider, profile.providerUserId, ...profileMetadata(profile)])
            await client.query('COMMIT')
            await createSession(created.rows[0].id, response)
            setPendingCookie(response, '', 0)
            let emailVerificationSent = false
            try { const token = await createEmailVerification(created.rows[0].id, email); emailVerificationSent = await sendVerificationEmail(email, token) }
            catch { /* Registration remains valid if mail is unavailable. */ }
            response.status(201).json({ user: publicUser(created.rows[0]), emailVerificationSent, returnPath: safeReturnPath(flow.return_path) })
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            if ((error as { code?: string }).code === '23505') response.status(409).json({ error: 'ACCOUNT_EXISTS', message: 'Ці дані вже використано. Увійдіть у свій акаунт, щоб підключити цей спосіб входу.' })
            else next(error)
        } finally { client.release() }
    })

    router.post('/finish/link', limit, requireAuth, async (request, response, next) => {
        const value = cookieValue(request, PENDING_COOKIE)
        if (!value) { response.status(400).json({ error: 'FLOW_EXPIRED', message: 'Час підтвердження минув. Спробуйте ще раз.' }); return }
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const pending = await client.query<FlowRow>(`SELECT * FROM external_auth_flows
                WHERE state_hash = $1 AND intent = 'signup' AND expires_at > now() FOR UPDATE`, [hash(value)])
            const flow = pending.rows[0]
            if (!flow?.profile) { await client.query('ROLLBACK'); response.status(400).json({ error: 'FLOW_EXPIRED', message: 'Час підтвердження минув. Спробуйте ще раз.' }); return }
            const freshSession = await client.query(`SELECT 1 FROM user_sessions WHERE token_hash = $1 AND user_id = $2
                AND revoked_at IS NULL AND expires_at > now() AND created_at > $3`, [requestSessionHash(request), request.authUser!.id, flow.created_at])
            if (!freshSession.rowCount) { await client.query('ROLLBACK'); response.status(403).json({ error: 'FRESH_LOGIN_REQUIRED', message: 'Увійдіть у свій акаунт ще раз, щоб підключити спосіб входу.' }); return }
            await client.query('DELETE FROM external_auth_flows WHERE state_hash = $1', [hash(value)])
            const profile = flow.profile
            const existing = await client.query('SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2', [profile.provider, profile.providerUserId])
            const own = await client.query('SELECT provider_user_id FROM auth_identities WHERE user_id = $1 AND provider = $2', [request.authUser!.id, profile.provider])
            if (existing.rowCount && existing.rows[0].user_id !== request.authUser!.id) {
                await client.query('COMMIT'); setPendingCookie(response, '', 0)
                response.status(409).json({ error: 'IDENTITY_CONFLICT', message: 'Цей акаунт уже використовується для входу в інший профіль.' }); return
            }
            if (own.rowCount && own.rows[0].provider_user_id !== profile.providerUserId) {
                await client.query('COMMIT'); setPendingCookie(response, '', 0)
                response.status(409).json({ error: 'PROVIDER_CONNECTED', message: 'Для цього способу входу вже підключено інший акаунт.' }); return
            }
            if (!existing.rowCount) {
                const inserted = await client.query(`INSERT INTO auth_identities
                    (user_id, provider, provider_user_id, provider_email, provider_username, provider_display_name, provider_avatar_url)
                    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`, [request.authUser!.id, profile.provider, profile.providerUserId, ...profileMetadata(profile)])
                if (!inserted.rowCount) {
                    await client.query('COMMIT'); setPendingCookie(response, '', 0)
                    response.status(409).json({ error: 'IDENTITY_CONFLICT', message: 'Не вдалося підключити цей спосіб входу. Перевірте інший профіль.' }); return
                }
            }
            await client.query('COMMIT')
            setPendingCookie(response, '', 0)
            response.json({ user: request.authUser, returnPath: '/settings/profile?externalAuth=linked' })
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) }
        finally { client.release() }
    })

    router.delete('/methods/:provider', requireAuth, async (request, response, next) => {
        const providerName = String(request.params.provider)
        if (!isProvider(providerName)) { response.status(404).end(); return }
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const user = await client.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [request.authUser!.id])
            const identities = await client.query('SELECT provider FROM auth_identities WHERE user_id = $1 FOR UPDATE', [request.authUser!.id])
            if (!identities.rows.some(row => row.provider === providerName)) { await client.query('ROLLBACK'); response.status(404).json({ error: 'NOT_LINKED' }); return }
            if (!user.rows[0]?.password_hash && identities.rows.length < 2) {
                await client.query('ROLLBACK')
                response.status(409).json({ error: 'LAST_LOGIN_METHOD', message: 'Спочатку додайте інший спосіб входу.' }); return
            }
            await client.query('DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2', [request.authUser!.id, providerName])
            await client.query('COMMIT')
            response.status(204).end()
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) }
        finally { client.release() }
    })
    return router
}
