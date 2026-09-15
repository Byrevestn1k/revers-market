import { randomInt } from 'node:crypto'
import { pool } from './db/client.js'

export const sendPhoneVerification = async (userId: string, phone: string) => {
    const code = String(randomInt(1000, 10000))
    await pool.query(`UPDATE users SET phone_verification_code = $1, phone_verification_expires = now() + interval '10 minutes', phone_verified = false WHERE id = $2`, [code, userId])
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
    const result = await pool.query(`UPDATE users SET phone_verified = true, phone_verification_code = NULL, phone_verification_expires = NULL WHERE id = $1 AND phone_verification_code = $2 AND phone_verification_expires > now() RETURNING id`, [userId, code.trim()])
    return { ok: Boolean(result.rowCount) }
}
