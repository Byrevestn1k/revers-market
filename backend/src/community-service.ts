import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'

type Queryable = Pick<PoolClient, 'query'>
const invalid = (message: string) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message } })

export const audit = async (queryable: Queryable, actorId: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) => {
    await queryable.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [actorId, action, entityType, entityId, JSON.stringify(metadata)])
}

export const createNotification = async (queryable: Queryable, userId: string, type: string, title: string, body: string, orderId: string | null = null, conversationId: string | null = null) => {
    await queryable.query('INSERT INTO notifications (user_id, type, title, body, order_id, conversation_id) VALUES ($1,$2,$3,$4,$5,$6)', [userId, type, title, body, orderId, conversationId])
}

export const listNotifications = async (user: AuthUser) => {
    const result = await pool.query('SELECT id, type, title, body, order_id AS "orderId", conversation_id AS "conversationId", read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [user.id])
    return { status: 200, body: { notifications: result.rows } }
}

export const markNotificationsRead = async (user: AuthUser, notificationId?: string) => {
    const condition = notificationId ? 'id = $1 AND user_id = $2' : 'user_id = $1 AND read_at IS NULL'
    const values = notificationId ? [notificationId, user.id] : [user.id]
    await pool.query(`UPDATE notifications SET read_at = now() WHERE ${condition}`, values)
    return { status: 200, body: { ok: true } }
}

export const listConversations = async (user: AuthUser) => {
    const result = await pool.query(`SELECT c.id, c.order_id AS "orderId", c.offer_id AS "offerId", COALESCE(o.status, ofr.status) AS status,
        CASE WHEN COALESCE(o.buyer_id, r.buyer_id) = $1 THEN su.username ELSE bu.username END AS "otherUsername",
        (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessage",
        (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessageAt",
        cp.last_read_at AS "lastReadAt"
        FROM conversations c LEFT JOIN orders o ON o.id = c.order_id
        LEFT JOIN offers ofr ON ofr.id = c.offer_id LEFT JOIN buy_requests r ON r.id = ofr.buy_request_id
        JOIN users bu ON bu.id = COALESCE(o.buyer_id, r.buyer_id) JOIN users su ON su.id = COALESCE(o.seller_id, ofr.seller_id)
        JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
        WHERE COALESCE(o.buyer_id, r.buyer_id) = $1 OR COALESCE(o.seller_id, ofr.seller_id) = $1 ORDER BY COALESCE("lastMessageAt", c.created_at) DESC`, [user.id])
    return { status: 200, body: { conversations: result.rows } }
}

export type ReviewInput = { rating: number; body?: string }
export type ReportInput = { targetType: string; targetId: string; reason: string; details?: string }

export const validateRating = (rating: unknown): string | null => {
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) return 'Оцінка має бути цілим числом від 1 до 5'
    return null
}

export const validateReviewBody = (body: unknown): string | null => {
    if (body !== undefined && (typeof body !== 'string' || body.length > 2000)) return 'Відгук надто довгий'
    return null
}

export const isModerator = (user: AuthUser) => (process.env.MODERATOR_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean).includes(user.id)

export const createReview = async (user: AuthUser, orderId: string, input: Record<string, unknown>) => {
    const ratingError = validateRating(input.rating)
    if (ratingError) return invalid(ratingError)
    const bodyError = validateReviewBody(input.body)
    if (bodyError) return invalid(bodyError)
    const rating = input.rating as number
    const body = input.body === undefined || input.body === null ? '' : (input.body as string).trim()
    const order = await pool.query('SELECT buyer_id, seller_id, status FROM orders WHERE id = $1', [orderId])
    if (!order.rowCount) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    const row = order.rows[0]
    if (row.status !== 'completed') return { status: 409, body: { error: 'ORDER_NOT_COMPLETED' } }
    if (row.buyer_id !== user.id && row.seller_id !== user.id) return { status: 403, body: { error: 'FORBIDDEN' } }
    const revieweeId = row.buyer_id === user.id ? row.seller_id : row.buyer_id
    try {
        const result = await pool.query('INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, order_id AS "orderId", reviewer_id AS "reviewerId", reviewee_id AS "revieweeId", rating, body, created_at AS "createdAt"', [orderId, user.id, revieweeId, rating, body])
        await audit(pool, user.id, 'review.created', 'review', result.rows[0].id, { orderId })
        await createNotification(pool, revieweeId, 'review', 'Новий відгук', 'Після завершеної угоди залишено новий відгук')
        return { status: 201, body: { review: result.rows[0] } }
    } catch (error: unknown) {
        if ((error as { code?: string }).code === '23505') return { status: 409, body: { error: 'REVIEW_ALREADY_EXISTS' } }
        throw error
    }
}

export const listReviews = async (username: string) => {
    const result = await pool.query('SELECT r.id, r.order_id AS "orderId", r.rating, r.body, r.created_at AS "createdAt", u.username AS "reviewerUsername" FROM reviews r JOIN users u ON u.id = r.reviewer_id JOIN users target ON target.id = r.reviewee_id WHERE target.username_normalized = $1 ORDER BY r.created_at DESC LIMIT 100', [username.trim().toLowerCase()])
    return { status: 200, body: { reviews: result.rows } }
}

export const createReport = async (user: AuthUser, input: Record<string, unknown>) => {
    const allowed = ['user', 'product', 'buy_request', 'order', 'message']
    const targetType = input.targetType
    const targetId = input.targetId
    const reason = input.reason
    const details = input.details
    if (typeof targetType !== 'string' || !allowed.includes(targetType) || typeof targetId !== 'string' || typeof reason !== 'string' || reason.trim().length < 2) return invalid('Вкажіть об’єкт і причину скарги')
    if (details !== undefined && (typeof details !== 'string' || details.length > 5000)) return invalid('Деталі скарги надто довгі')
    const trimmedDetails = details === undefined || details === null ? '' : details.trim()
    const result = await pool.query('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id, target_type AS "targetType", target_id AS "targetId", reason, details, status, created_at AS "createdAt"', [user.id, targetType, targetId, reason.trim(), trimmedDetails])
    await audit(pool, user.id, 'report.created', 'report', result.rows[0].id, { targetType: input.targetType, targetId: input.targetId })
    return { status: 201, body: { report: result.rows[0] } }
}

export const listReports = async (user: AuthUser) => {
    const result = await pool.query('SELECT id, target_type AS "targetType", target_id AS "targetId", reason, details, status, moderation_note AS "moderationNote", created_at AS "createdAt", updated_at AS "updatedAt" FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100', [user.id])
    return { status: 200, body: { reports: result.rows } }
}

export const blockUser = async (user: AuthUser, blockedId: string) => {
    if (blockedId === user.id) return { status: 400, body: { error: 'CANNOT_BLOCK_SELF' } }
    const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [blockedId])
    if (!target.rowCount) return { status: 404, body: { error: 'USER_NOT_FOUND' } }
    await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, blockedId])
    await audit(pool, user.id, 'user.blocked', 'user', blockedId)
    return { status: 204, body: null }
}

export const unblockUser = async (user: AuthUser, blockedId: string) => {
    await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [user.id, blockedId])
    await audit(pool, user.id, 'user.unblocked', 'user', blockedId)
    return { status: 204, body: null }
}

export const listModerationReports = async (user: AuthUser) => {
    if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } }
    const result = await pool.query('SELECT id, reporter_id AS "reporterId", target_type AS "targetType", target_id AS "targetId", reason, details, status, moderation_note AS "moderationNote", created_at AS "createdAt", updated_at AS "updatedAt" FROM reports ORDER BY created_at DESC LIMIT 200')
    return { status: 200, body: { reports: result.rows } }
}

export const updateReportModeration = async (user: AuthUser, reportId: string, status: unknown, note: unknown) => {
    if (!isModerator(user)) return { status: 403, body: { error: 'MODERATOR_REQUIRED' } }
    if (typeof status !== 'string' || !['open', 'under_review', 'resolved', 'dismissed'].includes(status)) return invalid('Некоректний статус модерації')
    if (note !== undefined && typeof note !== 'string') return invalid('Некоректна примітка модератора')
    const result = await pool.query('UPDATE reports SET status = $1, moderator_id = $2, moderation_note = $3, updated_at = now() WHERE id = $4 RETURNING id, status, moderation_note AS "moderationNote", updated_at AS "updatedAt"', [status, user.id, note ?? null, reportId])
    if (!result.rowCount) return { status: 404, body: { error: 'REPORT_NOT_FOUND' } }
    await audit(pool, user.id, 'report.moderated', 'report', reportId, { status })
    return { status: 200, body: { report: result.rows[0] } }
}

export const usersAreBlocked = async (queryable: Queryable, firstUserId: string, secondUserId: string) => Boolean((await queryable.query(
    'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1',
    [firstUserId, secondUserId],
)).rowCount)
