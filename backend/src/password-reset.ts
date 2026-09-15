import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from './db/client.js'
import { normalizeEmail } from './email-verification.js'

export const requestPasswordReset = async (identifier: string) => {
    const value = identifier.trim()
    const result = await pool.query('SELECT id, email FROM users WHERE username_normalized = $1 OR email_normalized = $1 LIMIT 1', [value.includes('@') ? normalizeEmail(value) : value.toLowerCase()])
    if (!result.rowCount || !result.rows[0].email) return { status: 200, body: { ok: true } }
    const code = String(randomInt(1000, 10000))
    await pool.query(`UPDATE users SET password_reset_code = $1, password_reset_expires = now() + interval '10 minutes' WHERE id = $2`, [code, result.rows[0].id])
    console.log(`[DEV password reset] -> ${result.rows[0].email}\nCode: ${code}`)
    return { status: 200, body: { ok: true } }
}

export const resetPassword = async (identifier: string, code: string, password: string) => {
    if (password.length < 8) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Пароль має містити щонайменше 8 символів' } }
    const value = identifier.trim()
    const result = await pool.query('SELECT id FROM users WHERE (username_normalized = $1 OR email_normalized = $1) AND password_reset_code = $2 AND password_reset_expires > now()', [value.includes('@') ? normalizeEmail(value) : value.toLowerCase(), code.trim()])
    if (!result.rowCount) return { status: 400, body: { error: 'INVALID_RESET_CODE', message: 'Неправильний або прострочений код' } }
    const hash = await bcrypt.hash(password, 12)
    await pool.query('UPDATE users SET password_hash = $1, password_reset_code = NULL, password_reset_expires = NULL, updated_at = now() WHERE id = $2', [hash, result.rows[0].id])
    return { status: 200, body: { ok: true } }
}
