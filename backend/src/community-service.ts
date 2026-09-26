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
    const result = await pool.query(`SELECT n.id, n.type, n.title, n.body, n.order_id AS "orderId", n.conversation_id AS "conversationId", n.read_at AS "readAt", n.created_at AS "createdAt",
        CASE WHEN COALESCE(o.seller_id, ofr.seller_id) = $1 THEN 'selling'
             WHEN COALESCE(o.buyer_id, r.buyer_id) = $1 THEN 'buying'
             ELSE 'general' END AS "userRole"
        FROM notifications n
        LEFT JOIN orders o ON o.id = n.order_id
        LEFT JOIN conversations c ON c.id = n.conversation_id
        LEFT JOIN offers ofr ON ofr.id = c.offer_id
        LEFT JOIN buy_requests r ON r.id = ofr.buy_request_id
        WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`, [user.id])
    return { status: 200, body: { notifications: result.rows } }
}

export const markNotificationsRead = async (user: AuthUser, notificationId?: string) => {
    const condition = notificationId ? 'id = $1 AND user_id = $2' : 'user_id = $1 AND read_at IS NULL'
    const values = notificationId ? [notificationId, user.id] : [user.id]
    await pool.query(`UPDATE notifications SET read_at = now() WHERE ${condition}`, values)
    return { status: 200, body: { ok: true } }
}

export const listConversations = async (user: AuthUser) => {
    const result = await pool.query(`SELECT c.id, c.order_id AS "orderId", c.offer_id AS "offerId", c.product_id AS "productId", c.buy_request_id AS "buyRequestId",
        COALESCE(o.status, ofr.status, p.status, direct_request.status) AS status,
        CASE WHEN c.order_id IS NOT NULL THEN 'deal' WHEN c.offer_id IS NOT NULL THEN 'offer' ELSE 'direct' END AS "type",
        COALESCE(o.conditions_snapshot->>'productTitle', p.title, offer_product.title, direct_request.title, offer_request.title, 'Обговорення') AS title,
        COALESCE(o.unit_price, ofr.unit_price, p.price, offer_product.price, direct_request.max_unit_price, offer_request.max_unit_price) AS price,
        COALESCE(o.currency, ofr.currency, p.currency, offer_product.currency, direct_request.currency, offer_request.currency) AS currency,
        COALESCE((SELECT pp.url FROM product_photos pp WHERE pp.product_id = COALESCE(p.id, offer_product.id) ORDER BY pp.sort_order, pp.id LIMIT 1), ofr.additional_photo_url) AS "imageUrl",
        COALESCE(direct_category.id, offer_request_category.id) AS "categoryId",
        COALESCE(direct_category.name, offer_request_category.name) AS "categoryName",
        COALESCE(direct_category.image_index, offer_request_category.image_index) AS "categoryImageIndex",
        other_user.id AS "otherUserId", other_user.username AS "otherUsername", other_user.avatar_url AS "otherAvatarUrl", mine.role AS "userRole",
        (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessage",
        (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessageSenderId",
        COALESCE((SELECT sender_id = $1 FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1), false) AS "lastMessageIsMine",
        (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessageAt",
        mine.last_read_at AS "lastReadAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
        (SELECT count(*)::integer FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.created_at > COALESCE(mine.last_read_at, '-infinity'::timestamptz)) AS "unreadCount"
        FROM conversations c
        JOIN conversation_participants mine ON mine.conversation_id = c.id AND mine.user_id = $1
        JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> $1
        JOIN users other_user ON other_user.id = other.user_id
        LEFT JOIN orders o ON o.id = c.order_id
        LEFT JOIN offers ofr ON ofr.id = c.offer_id
        LEFT JOIN products p ON p.id = c.product_id
        LEFT JOIN products offer_product ON offer_product.id = ofr.product_id
        LEFT JOIN buy_requests direct_request ON direct_request.id = c.buy_request_id
        LEFT JOIN buy_requests offer_request ON offer_request.id = ofr.buy_request_id
        LEFT JOIN categories direct_category ON direct_category.id = direct_request.category_id
        LEFT JOIN categories offer_request_category ON offer_request_category.id = offer_request.category_id
        ORDER BY COALESCE((SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1), c.created_at) DESC`, [user.id])
    return { status: 200, body: { conversations: result.rows } }
}

export type ReviewInput = { rating: number; body?: string }
export type ReportInput = { targetType: string; targetId: string; reason: string; details?: string }

export const validateRating = (rating: unknown): string | null => {
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 12) return 'Оцінка має бути цілим числом від 1 до 12'
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
    for (const field of ['communicationRating','complianceRating','descriptionRating']) if (input[field] !== undefined && validateRating(input[field])) return invalid('Оцінки за критеріями мають бути від 1 до 12')
    const client = await pool.connect()
    try {
    await client.query('BEGIN')
    const order = await client.query('SELECT buyer_id, seller_id, status, workflow_version, buyer_completed_at, seller_completed_at FROM orders WHERE id = $1 FOR UPDATE', [orderId])
    if (!order.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'ORDER_NOT_FOUND' } } }
    const row = order.rows[0]
    if (row.buyer_id !== user.id && row.seller_id !== user.id) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'FORBIDDEN' } } }
    if (row.status !== 'completed' || (row.workflow_version >= 2 && (!row.buyer_completed_at || !row.seller_completed_at))) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'ORDER_NOT_COMPLETED' } } }
    const revieweeId = row.buyer_id === user.id ? row.seller_id : row.buyer_id
        const days = Number(process.env.REVIEW_BLIND_DAYS ?? 14)
        const result = await client.query(`INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, body, communication_rating, compliance_rating, description_rating, publish_after)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + $9 * interval '1 day') RETURNING id, rating, body, published_at AS "publishedAt"`,
            [orderId, user.id, revieweeId, rating, body, input.communicationRating ?? null, input.complianceRating ?? null, row.buyer_id === user.id ? input.descriptionRating ?? null : null, Number.isFinite(days) && days > 0 ? days : 14])
        await audit(client, user.id, 'REVIEW_CREATED', 'review', result.rows[0].id, { orderId })
        const count = (await client.query('SELECT count(*)::int AS count FROM reviews WHERE order_id = $1', [orderId])).rows[0].count
        if (count >= 2) await publishReviews(client, orderId)
        await createNotification(client, revieweeId, 'review', 'Учасник залишив відгук', count >= 2 ? 'Обидва відгуки тепер відкриті.' : 'Залиште свій відгук, щоб побачити обидві оцінки.', orderId)
        await client.query('COMMIT')
        return { status: 201, body: { review: result.rows[0] } }
    } catch (error: unknown) {
        await client.query('ROLLBACK')
        if ((error as { code?: string }).code === '23505') return { status: 409, body: { error: 'REVIEW_ALREADY_EXISTS' } }
        throw error
    } finally { client.release() }
}

const publishReviews = async (queryable: Queryable, orderId?: string) => {
    const published = await queryable.query(`UPDATE reviews SET published_at = now() WHERE published_at IS NULL AND ${orderId ? 'order_id = $1' : 'publish_after <= now()'} RETURNING id, order_id`, orderId ? [orderId] : [])
    for (const row of published.rows) await audit(queryable, null, 'REVIEW_PUBLISHED', 'review', row.id, { orderId: row.order_id })
}

export const publishDueReviews = async () => {
    const client = await pool.connect()
    try { await client.query('BEGIN'); await publishReviews(client); await client.query('COMMIT') }
    catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const listReviews = async (username: string) => {
    await publishDueReviews()
    const result = await pool.query('SELECT r.id, r.order_id AS "orderId", r.rating, r.body, r.communication_rating AS "communicationRating", r.compliance_rating AS "complianceRating", r.description_rating AS "descriptionRating", r.created_at AS "createdAt", u.username AS "reviewerUsername" FROM reviews r JOIN users u ON u.id = r.reviewer_id JOIN users target ON target.id = r.reviewee_id WHERE target.username_normalized = $1 AND r.published_at IS NOT NULL ORDER BY r.created_at DESC LIMIT 100', [username.trim().toLowerCase()])
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
