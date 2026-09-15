import { randomBytes, createHash } from 'node:crypto'
import { pool } from './db/client.js'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 // 24 години

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Створює токен верифікації для користувача і повертає його для листа. */
export const createEmailVerification = async (userId: string, email: string, allowEmailChange = true) => {
    const token = randomBytes(32).toString('base64url')
    const result = await pool.query(
        `UPDATE users SET pending_email = $1, pending_email_normalized = $2,
            email_verification_token = $3, email_verification_expires = $4, updated_at = now()
         WHERE id = $5 AND ($6::boolean OR (email_normalized = $2 OR pending_email_normalized = $2)) AND (pending_email_normalized IS DISTINCT FROM $2 OR (email_verification_expires IS NULL OR email_verification_expires < now() + interval '23 hours 59 minutes')) RETURNING id`,
        [email.trim(), normalizeEmail(email), hashToken(token), new Date(Date.now() + TOKEN_TTL_MS), userId, allowEmailChange],
    )
    if (!result.rowCount) throw new Error('Зачекайте хвилину перед повторним надсиланням або оновіть профіль.')
    return token
}

/** Відправка листа. DEV (без SMTP_HOST у .env) — посилання пишеться в консоль бекенда. Продакшен — SMTP через nodemailer. */
export const sendVerificationEmail = async (email: string, token: string) => {
    const appUrl = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`
    const subject = 'Підтвердіть електронну пошту — Навпаки'
    const text = `Вітаємо!\n\nПідтвердіть свою електронну пошту, перейшовши за посиланням (дійсне 24 години):\n${link}\n\nЯкщо ви не реєструвалися — просто проігноруйте цей лист.`
    const devLog = () => console.log(`[DEV email] -> ${email}\nSubject: ${subject}\n${text}`)
    const smtpHost = process.env.SMTP_HOST
    if (!smtpHost) { if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured'); devLog(); return false }
    try {
        const mailer = await import('nodemailer')
        const transport = mailer.createTransport({
            host: smtpHost,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        })
        await transport.sendMail({ from: process.env.SMTP_FROM ?? 'no-reply@navpaky.local', to: email, subject, text })
        return true
    } catch (error) {
        throw error
    }
}

/** Підтвердження пошти за токеном із посилання. */
export const verifyEmailToken = async (token: string) => {
    const result = await pool.query(
        `UPDATE users SET email = pending_email, email_normalized = pending_email_normalized,
            pending_email = NULL, pending_email_normalized = NULL, email_verified = true,
            email_verification_token = NULL, email_verification_expires = NULL, updated_at = now()
         WHERE email_verification_token = $1 AND email_verification_expires > now()
         RETURNING id`,
        [hashToken(token)],
    )
    return { ok: Boolean(result.rowCount && result.rowCount > 0) }
}

/** Перевірка, чи пошта не зайнята іншим користувачем. */
export const emailTaken = async (email: string, exceptUserId?: string) => {
    const result = await pool.query(
        'SELECT id FROM users WHERE (email_normalized = $1 OR pending_email_normalized = $1) AND ($2::uuid IS NULL OR id <> $2::uuid)',
        [normalizeEmail(email), exceptUserId ?? null],
    )
    return Boolean(result.rowCount && result.rowCount > 0)
}
