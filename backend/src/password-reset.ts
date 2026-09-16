import { createHash, randomBytes, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from './db/client.js'
import { normalizeEmail } from './email-verification.js'
import { isValidEmail, passwordError, normalizePhone } from './validation.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const genericResponse = { status: 200, body: { ok: true, message: 'Якщо контакт належить підтвердженому обліковому запису, код надіслано.' } }
const deliverCode = async (method: 'email' | 'phone', target: string, code: string) => {
    if (process.env.NODE_ENV !== 'production') console.log(`[DEV password reset ${method}] -> ${target}\nCode: ${code}`)
}

export const requestPasswordReset = async (method: string, contact: string, countryCode = '') => {
    const value = method === 'email' ? normalizeEmail(contact) : normalizePhone(countryCode, contact)
    if (!['email', 'phone'].includes(method) || !value || (method === 'email' && !isValidEmail(value))) return genericResponse
    const column = method === 'email' ? 'email_normalized' : 'phone'
    const verified = method === 'email' ? 'email_verified = true' : 'phone_verified = true'
    const account = await pool.query(`SELECT id, ${column} AS contact FROM users WHERE ${column} = $1 AND ${verified} LIMIT 1`, [value])
    if (!account.rowCount) {
        if (process.env.NODE_ENV !== 'production') console.log(`[DEV password reset] verified ${method} account not found: ${value}`)
        return genericResponse
    }
    const code = String(randomInt(100000, 1000000))
    const saved = await pool.query(`UPDATE users SET password_reset_code = $1, password_reset_expires = now() + interval '10 minutes', password_reset_attempts = 0, password_reset_grant_hash = NULL, password_reset_grant_expires = NULL WHERE id = $2 AND (password_reset_expires IS NULL OR password_reset_expires < now() - interval '1 minute')`, [hash(code), account.rows[0].id])
    if (saved.rowCount) await deliverCode(method as 'email' | 'phone', account.rows[0].contact, code)
    else if (process.env.NODE_ENV !== 'production') console.log(`[DEV password reset] request throttled for ${account.rows[0].contact}; wait 1 minute before requesting another code`)
    return genericResponse
}

export const verifyPasswordResetCode = async (method: string, contact: string, code: string, countryCode = '') => {
    const value = method === 'email' ? normalizeEmail(contact) : normalizePhone(countryCode, contact)
    if (!['email', 'phone'].includes(method) || !/^\d{6}$/.test(code)) return { status: 400, body: { error: 'INVALID_RESET_CODE', message: 'Код недійсний або застарілий' } }
    const column = method === 'email' ? 'email_normalized' : 'phone'
    const grant = randomBytes(32).toString('base64url')
    const verified = await pool.query(`UPDATE users SET password_reset_code = NULL, password_reset_expires = NULL, password_reset_attempts = 0, password_reset_grant_hash = $1, password_reset_grant_expires = now() + interval '10 minutes' WHERE ${column} = $2 AND password_reset_code = $3 AND password_reset_expires > now() AND password_reset_attempts < 5 RETURNING id`, [hash(grant), value, hash(code)])
    if (verified.rowCount) return { status: 200, body: { resetGrant: grant } }
    await pool.query(`UPDATE users SET password_reset_attempts = password_reset_attempts + 1, password_reset_code = CASE WHEN password_reset_attempts + 1 >= 5 THEN NULL ELSE password_reset_code END, password_reset_expires = CASE WHEN password_reset_attempts + 1 >= 5 THEN NULL ELSE password_reset_expires END WHERE ${column} = $1 AND password_reset_expires > now()`, [value])
    return { status: 400, body: { error: 'INVALID_RESET_CODE', message: 'Код недійсний, застарілий або кількість спроб вичерпано' } }
}

export const resetPassword = async (grant: string, password: string, confirmation: string) => {
    const validationError = passwordError(password)
    if (validationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: validationError } }
    if (password !== confirmation) return { status: 400, body: { error: 'PASSWORD_MISMATCH', message: 'Паролі не збігаються' } }
    const result = await pool.query(`UPDATE users SET password_hash = $1, password_reset_grant_hash = NULL, password_reset_grant_expires = NULL, updated_at = now() WHERE password_reset_grant_hash = $2 AND password_reset_grant_expires > now() RETURNING id`, [await bcrypt.hash(password, 12), hash(grant)])
    if (!result.rowCount) return { status: 400, body: { error: 'INVALID_RESET_GRANT', message: 'Час для зміни пароля минув. Почніть відновлення ще раз.' } }
    await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [result.rows[0].id])
    return { status: 200, body: { ok: true } }
}
