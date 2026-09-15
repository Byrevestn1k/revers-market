import bcrypt from 'bcryptjs'
import { pool } from './db/client.js'

export const changePassword = async (userId: string, currentPassword: string, newPassword: string, confirmation: string) => {
    if (newPassword.length < 8) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Новий пароль має містити щонайменше 8 символів' } }
    if (newPassword !== confirmation) return { status: 400, body: { error: 'PASSWORD_MISMATCH', message: 'Нові паролі не збігаються' } }
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId])
    if (!result.rowCount || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) return { status: 400, body: { error: 'INVALID_CURRENT_PASSWORD', message: 'Поточний пароль неправильний' } }
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(newPassword, 12), userId])
    return { status: 200, body: { ok: true } }
}
