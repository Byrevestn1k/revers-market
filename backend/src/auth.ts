import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { pool } from './db/client.js'
import { normalizePhone, validateRegistration, type RegistrationInput } from './validation.js'

const SESSION_COOKIE = 'navpaky_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

export type AuthUser = { id: string; username: string; countryCode: string; phone: string }


const normalizeUsername = (username: string) => username.trim().toLowerCase()
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const getCookie = (request: Request) => request.headers.cookie?.match(/(?:^|; )navpaky_session=([^;]+)/)?.[1]

const publicUser = (row: { id: string; username: string; country_code: string; phone: string }): AuthUser => ({
    id: row.id,
    username: row.username,
    countryCode: row.country_code,
    phone: row.phone,
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

export const requireAuth: RequestHandler = async (request, response, next: NextFunction) => {
    const token = getCookie(request)
    if (!token) {
        response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Потрібно увійти в обліковий запис' })
        return
    }

    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.country_code, u.phone
             FROM user_sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`
            , [hashToken(token)],
        )
        if (!result.rowCount) {
            clearSessionCookie(response)
            response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Потрібно увійти в обліковий запис' })
            return
        }
        request.authUser = publicUser(result.rows[0])
        next()
    } catch (error) {
        next(error)
    }
}

export const optionalAuth: RequestHandler = async (request, response, next: NextFunction) => {
    const token = getCookie(request)
    if (!token) { next(); return }
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.country_code, u.phone
             FROM user_sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`
            , [hashToken(token)],
        )
        if (result.rowCount) request.authUser = publicUser(result.rows[0])
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
    const countryCode = input.countryCode.trim().toUpperCase()
    const phone = normalizePhone(countryCode, input.phone)
    const passwordHash = await bcrypt.hash(input.password, 12)

    try {
        const result = await pool.query(
            `INSERT INTO users (username, username_normalized, country_code, phone, password_hash)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, country_code, phone`,
            [username, normalizeUsername(username), countryCode, phone, passwordHash],
        )
        await createSession(result.rows[0].id, response)
        return { status: 201, body: { user: publicUser(result.rows[0]) } }
    } catch (error: unknown) {
        if ((error as { code?: string }).code === '23505') {
            return { status: 409, body: { error: 'ACCOUNT_NOT_AVAILABLE', message: 'Не вдалося створити обліковий запис із вказаними даними' } }
        }
        throw error
    }
}

export const login = async (username: string, password: string, response: Response) => {
    const result = await pool.query(
        'SELECT id, username, country_code, phone, password_hash FROM users WHERE username_normalized = $1',
        [normalizeUsername(username)],
    )
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return { status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Неправильні облікові дані' } }
    }
    await createSession(user.id, response)
    return { status: 200, body: { user: publicUser(user) } }
}

export const logout = async (request: Request, response: Response) => {
    const token = getCookie(request)
    if (token) await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)])
    clearSessionCookie(response)
}

export const authCookieName = SESSION_COOKIE