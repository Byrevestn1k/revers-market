import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { pool } from './db/client.js'
import { normalizePhone, validateRegistration, isValidEmail, type RegistrationInput } from './validation.js'
import { createEmailVerification, emailTaken, normalizeEmail, sendVerificationEmail, verifyEmailToken } from './email-verification.js'

const SESSION_COOKIE = 'navpaky_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

export type AuthUser = { id: string; username: string; countryCode: string; phone: string; email: string | null; emailVerified: boolean; pendingEmail?: string | null }


const normalizeUsername = (username: string) => username.trim().toLowerCase()
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const getCookie = (request: Request) => request.headers.cookie?.match(/(?:^|; )navpaky_session=([^;]+)/)?.[1]

const publicUser = (row: { id: string; username: string; country_code: string; phone: string; email?: string | null; email_verified?: boolean; pending_email?: string | null }): AuthUser => ({
    id: row.id,
    username: row.username,
    countryCode: row.country_code,
    phone: row.phone,
    email: row.email ?? null,
    emailVerified: Boolean(row.email_verified),
    pendingEmail: row.pending_email ?? null,
})

const setSessionCookie = (response: Response, token: string) => {
    const secure = process.env.NODE_ENV === 'production'
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`)
}

export const clearSessionCookie = (response: Response) => {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

const createSession = async (userId: string, response: Response) => {
    const token = randomBytes(32).toString('base64url')
    await pool.query(
        'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, hashToken(token), new Date(Date.now() + SESSION_TTL_MS)],
    )
    setSessionCookie(response, token)
}

const resolveSessionUser = async (request: Request): Promise<AuthUser | null> => {
    const token = getCookie(request)
    if (!token) return null
    const result = await pool.query(
        `SELECT u.id, u.username, u.country_code, u.phone, u.email, u.email_verified, u.pending_email
         FROM user_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`
        , [hashToken(token)],
    )
    return result.rowCount ? publicUser(result.rows[0]) : null
}

export const requireAuth: RequestHandler = async (request, response, next: NextFunction) => {
    try {
        const user = await resolveSessionUser(request)
        if (!user) {
            clearSessionCookie(response)
            response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Потрібно увійти в обліковий запис' })
            return
        }
        request.authUser = user
        next()
    } catch (error) {
        next(error)
    }
}

export const optionalAuth: RequestHandler = async (request, _response, next: NextFunction) => {
    try {
        const user = await resolveSessionUser(request)
        if (user) request.authUser = user
        next()
    } catch (error) { next(error) }
}

declare global {
    namespace Express { interface Request { authUser?: AuthUser } }
}

export const register = async (input: RegistrationInput, response: Response) => {
    const errors = validateRegistration(input)
    if (errors.length) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані форми', fields: errors } }

    const username = input.username.trim()
    const email = input.email.trim()
    const countryCode = input.countryCode.trim().toUpperCase()
    const phone = normalizePhone(countryCode, input.phone)
    const passwordHash = await bcrypt.hash(input.password, 12)

    if (await emailTaken(email)) {
        return { status: 409, body: { error: 'EMAIL_TAKEN', message: 'Ця електронна пошта вже зареєстрована', fields: ['Введіть коректну електронну пошту'] } }
    }

    try {
        const result = await pool.query(
            `INSERT INTO users (username, username_normalized, email, email_normalized, country_code, phone, password_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, username, country_code, phone, email, email_verified`,
            [username, normalizeUsername(username), email, normalizeEmail(email), countryCode, phone, passwordHash],
        )
        const user = result.rows[0]
        let emailVerificationSent = false
        try {
            const token = await createEmailVerification(user.id, email)
            emailVerificationSent = await sendVerificationEmail(email, token)
        } catch (mailError) { console.error('verification email failed:', mailError) }
        await createSession(user.id, response)
        return { status: 201, body: { user: publicUser(user), emailVerificationSent } }
    } catch (error: unknown) {
        if ((error as { code?: string }).code === '23505') {
            return { status: 409, body: { error: 'ACCOUNT_NOT_AVAILABLE', message: 'Не вдалося створити обліковий запис із вказаними даними' } }
        }
        throw error
    }
}

/** Логін за логіном АБО електронною поштою. */
export const login = async (usernameOrEmail: string, password: string, response: Response) => {
    const identifier = usernameOrEmail.trim()
    const byEmail = isValidEmail(identifier)
    const result = await pool.query(
        `SELECT id, username, country_code, phone, email, email_verified, password_hash
         FROM users WHERE ${byEmail ? 'email_normalized = $1' : 'username_normalized = $1'}`,
        [byEmail ? normalizeEmail(identifier) : normalizeUsername(identifier)],
    )
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return { status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Неправильні облікові дані' } }
    }
    await createSession(user.id, response)
    return { status: 200, body: { user: publicUser(user) } }
}

/** Повторна відправка листа підтвердження. */
export const resendVerification = async (user: AuthUser) => {
    const targetEmail = user.pendingEmail ?? user.email
    if (!targetEmail) return { status: 400, body: { error: 'NO_EMAIL', message: 'Електронну пошту не вказано' } }
    if (user.emailVerified) return { status: 400, body: { error: 'ALREADY_VERIFIED', message: 'Пошта вже підтверджена' } }
    try {
        const token = await createEmailVerification(user.id, targetEmail, false)
        const sent = await sendVerificationEmail(targetEmail, token)
        return { status: 200, body: { ok: true, emailVerificationSent: sent } }
    } catch { return { status: 429, body: { error: 'VERIFICATION_UNAVAILABLE', message: 'Не вдалося надіслати лист. Спробуйте через хвилину.' } } }
}

export const confirmEmail = async (token: string) => {
    if (!token) return { status: 400, body: { error: 'TOKEN_REQUIRED', message: 'Токен не вказано' } }
    const verified = await verifyEmailToken(token)
    if (!verified.ok) return { status: 400, body: { error: 'INVALID_TOKEN', message: 'Посилання недійсне або застаріле. Надішліть лист ще раз у профілі.' } }
    return { status: 200, body: { ok: true } }
}

export const logout = async (request: Request, response: Response) => {
    const token = getCookie(request)
    if (token) await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)])
    clearSessionCookie(response)
}

export const authCookieName = SESSION_COOKIE
