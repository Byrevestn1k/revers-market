import { createHash, randomInt } from 'node:crypto'
import { pool } from './db/client.js'
import { isValidPhone, normalizePhone } from './validation.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export const sendPhoneVerification = async (userId: string, phone: string) => {
    const code = String(randomInt(100000, 1000000))
    await pool.query(`UPDATE users SET phone_verification_code = $1, phone_verification_expires = now() + interval '10 minutes', phone_verification_attempts = 0 WHERE id = $2`, [hash(code), userId])
    const webhook = process.env.SMS_WEBHOOK_URL
    if (webhook) {
        const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ to: phone, code }) })
        if (!response.ok) throw new Error(`SMS provider returned ${response.status}`)
    } else if (process.env.NODE_ENV === 'production') {
        throw new Error('SMS_WEBHOOK_URL is not configured')
    } else {
        console.log(`[DEV phone] -> ${phone}\nCode: ${code}`)
    }
    return { sent: true }
}

export const confirmPhoneVerification = async (userId: string, code: string) => {
    const result = await pool.query(`UPDATE users SET phone = COALESCE(pending_phone, phone), country_code = COALESCE(pending_phone_country_code, country_code), pending_phone = NULL, pending_phone_country_code = NULL, phone_verified = true, phone_verification_code = NULL, phone_verification_expires = NULL, phone_verification_attempts = 0 WHERE id = $1 AND phone_verification_code = $2 AND phone_verification_expires > now() AND phone_verification_attempts < 5 RETURNING id`, [userId, hash(code.trim())])
    if (!result.rowCount) await pool.query(`UPDATE users SET phone_verification_attempts = phone_verification_attempts + 1, phone_verification_code = CASE WHEN phone_verification_attempts + 1 >= 5 THEN NULL ELSE phone_verification_code END WHERE id = $1 AND phone_verification_expires > now()`, [userId])
    return { ok: Boolean(result.rowCount) }
}

export const requestPhoneChange = async (userId: string, countryCode: string, phone: string) => {
    if (!isValidPhone(countryCode, phone)) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Введіть коректний номер телефону' } }
    const normalized = normalizePhone(countryCode, phone)
    const taken = await pool.query('SELECT id FROM users WHERE phone = $1 AND id <> $2', [normalized, userId])
    if (taken.rowCount) return { status: 409, body: { error: 'PHONE_TAKEN', message: 'Цей номер уже зареєстрований' } }
    await pool.query('UPDATE users SET pending_phone = $1, pending_phone_country_code = $2 WHERE id = $3', [normalized, countryCode.toUpperCase(), userId])
    await sendPhoneVerification(userId, normalized)
    return { status: 200, body: { ok: true } }
}
