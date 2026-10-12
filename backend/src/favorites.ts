import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'

const TYPES = ['product', 'buy_request', 'profile'] as const
type FavoriteType = typeof TYPES[number]

const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const favoriteType = (value: unknown): FavoriteType | null => typeof value === 'string' && (TYPES as readonly string[]).includes(value) ? value as FavoriteType : null

const targetExists = async (type: FavoriteType, id: string) => {
    const query = type === 'product'
        ? "SELECT 1 FROM products WHERE id = $1 AND status = 'active'"
        : type === 'buy_request'
            ? "SELECT 1 FROM buy_requests WHERE id = $1 AND status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')"
            : 'SELECT 1 FROM users WHERE id = $1'
    return Boolean((await pool.query(query, [id])).rowCount)
}

export const setFavorite = async (user: AuthUser, input: Record<string, unknown>) => {
    const type = favoriteType(input.targetType)
    const targetId = input.targetId
    if (!type || !validUuid(targetId)) return { status: 400, body: { error: 'INVALID_FAVORITE_TARGET', message: 'Некоректний об’єкт обраного' } }
    if (!(await targetExists(type, targetId))) return { status: 404, body: { error: 'FAVORITE_TARGET_NOT_FOUND', message: 'Цей об’єкт більше недоступний' } }
    await pool.query('INSERT INTO favorites (user_id, target_type, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [user.id, type, targetId])
    return { status: 200, body: { favorite: true } }
}

export const removeFavorite = async (user: AuthUser, typeValue: string, targetId: string) => {
    const type = favoriteType(typeValue)
    if (!type || !validUuid(targetId)) return { status: 400, body: { error: 'INVALID_FAVORITE_TARGET', message: 'Некоректний об’єкт обраного' } }
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND target_type = $2 AND target_id = $3', [user.id, type, targetId])
    return { status: 204 }
}

export const listFavorites = async (user: AuthUser) => {
    const result = await pool.query<{ targetType: FavoriteType; targetId: string; username: string | null }>(`
        SELECT f.target_type AS "targetType", f.target_id AS "targetId", u.username
        FROM favorites f
        LEFT JOIN users u ON f.target_type = 'profile' AND u.id = f.target_id
        LEFT JOIN products p ON f.target_type = 'product' AND p.id = f.target_id
        LEFT JOIN buy_requests r ON f.target_type = 'buy_request' AND r.id = f.target_id
        WHERE f.user_id = $1
          AND ((f.target_type = 'profile' AND u.id IS NOT NULL)
            OR (f.target_type = 'product' AND p.status = 'active')
            OR (f.target_type = 'buy_request' AND r.status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')))
        ORDER BY f.created_at DESC`, [user.id])
    return { status: 200, body: { favorites: result.rows } }
}
