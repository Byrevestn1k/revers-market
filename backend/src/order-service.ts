import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { createNotification, audit as auditOrder, usersAreBlocked } from './community-service.js'
import { refreshRequestQuantities } from './request-quantities.js'

type Queryable = Pick<PoolClient, 'query'>
export const orderStatuses = ['draft', 'active', 'offer_received', 'accepted', 'selected', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed', 'completed', 'failed', 'cancelled', 'rejected', 'expired'] as const
export type OrderStatus = typeof orderStatuses[number]
export const isOrderParticipant = (userId: string, buyerId: string, sellerId: string) => userId === buyerId || userId === sellerId

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
    draft: ['active', 'cancelled', 'expired'],
    active: ['offer_received', 'cancelled', 'expired'],
    offer_received: ['accepted', 'rejected', 'cancelled', 'expired'],
    accepted: ['in_progress', 'cancelled'],
    selected: [],
    in_progress: ['completed', 'cancelled'],
    buyer_marked_completed: [], seller_marked_completed: [],
    completed: [], failed: [], rejected: [], cancelled: [], expired: [],
}

export const canTransitionOrder = (from: string, to: string) => orderStatuses.includes(from as OrderStatus) && transitions[from as OrderStatus].includes(to as OrderStatus)
export const canUserTransitionOrder = (userId: string, buyerId: string, sellerId: string, from: string, to: string) => {
    if (!canTransitionOrder(from, to)) return false
    if (to === 'in_progress') return userId === sellerId
    if (to === 'completed') return userId === buyerId
    if (to === 'cancelled') return userId === buyerId || userId === sellerId
    return false
}

const orderSelect = `SELECT o.*, r.title AS request_title, bu.username AS buyer_username, su.username AS seller_username
    FROM orders o JOIN buy_requests r ON r.id = o.buy_request_id
    JOIN users bu ON bu.id = o.buyer_id JOIN users su ON su.id = o.seller_id`

const orderDto = (row: any) => ({
    id: row.id, buyRequestId: row.buy_request_id,
    buyer: { id: row.buyer_id, username: row.buyer_username }, seller: { id: row.seller_id, username: row.seller_username },
    quantity: row.quantity === null ? null : Number(row.quantity), unit: row.unit, price: { unit: row.unit_price === null ? null : Number(row.unit_price), currency: row.currency },
    subtotal: Number(row.subtotal), conditionsSnapshot: row.conditions_snapshot, status: row.status,
    acceptedAt: row.accepted_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    cancelReason: row.cancel_reason ?? null, cancelledBy: row.cancelled_by ?? null,
    dispute: row.dispute_status ? { status: row.dispute_status, reason: row.dispute_reason, resolution: row.dispute_resolution } : null,
})

const findOrder = async (queryable: Queryable, orderId: string, userId: string) => {
    const result = await queryable.query(`${orderSelect} WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)`, [orderId, userId])
    return result.rows[0]
}

export const createOrderConversation = async (queryable: Queryable, orderId: string, buyerId: string, sellerId: string, offerId?: string) => {
    const existing = offerId ? await queryable.query<{ id: string }>('SELECT id FROM conversations WHERE offer_id = $1', [offerId]) : { rows: [] as { id: string }[] }
    const conversation = existing.rows[0] ?? (await queryable.query<{ id: string }>('INSERT INTO conversations (order_id, offer_id) VALUES ($1, $2) RETURNING id', [orderId, offerId ?? null])).rows[0]
    if (!existing.rows[0]) await queryable.query('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)', [conversation.id, buyerId, 'buyer', sellerId, 'seller'])
    await createNotification(queryable, buyerId, 'order', 'Створено угоду', 'Пропозицію обрано, очікуємо підтвердження продавця', orderId, conversation.id)
    await createNotification(queryable, sellerId, 'order', 'Вашу пропозицію обрали', 'Підтвердьте актуальність обраної кількості', orderId, conversation.id)
    return conversation.id
}

export const listOrders = async (user: AuthUser) => {
    const result = await pool.query(`${orderSelect} WHERE o.buyer_id = $1 OR o.seller_id = $1 ORDER BY o.created_at DESC`, [user.id])
    return { status: 200, body: { orders: result.rows.map(orderDto) } }
}

export const getOrder = async (user: AuthUser, orderId: string) => {
    const row = await findOrder(pool, orderId, user.id)
    return row ? { status: 200, body: { order: orderDto(row) } } : { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
}

export const updateOrderStatus = async (user: AuthUser, orderId: string, status: unknown, reason: unknown) => {
    if (typeof status !== 'string' || !orderStatuses.includes(status as OrderStatus)) return { status: 400, body: { error: 'INVALID_ORDER_STATUS' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (status === 'cancelled') {
        if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) return { status: 400, body: { error: 'CANCEL_REASON_REQUIRED', message: 'Вкажіть причину скасування (3–1000 символів)' } }
    } else if (reason !== undefined) return { status: 400, body: { error: 'REASON_NOT_ALLOWED' } }
    if (!canUserTransitionOrder(user.id, current.buyer_id, current.seller_id, current.status, status)) return { status: 409, body: { error: 'INVALID_ORDER_TRANSITION', from: current.status, to: status } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        if (status === 'completed') {
            await client.query(`UPDATE products p SET quantity = p.quantity - oi.quantity, reserved_quantity = p.reserved_quantity - oi.quantity,
                status = CASE WHEN p.quantity - oi.quantity = 0 THEN 'sold' ELSE p.status END, updated_at = now()
                FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId])
        }
        if (status === 'cancelled') {
            await client.query('UPDATE products p SET reserved_quantity = p.reserved_quantity - oi.quantity, updated_at = now() FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id', [orderId])
        }
        await client.query("UPDATE orders SET status = $1, updated_at = now(), cancel_reason = $3, cancelled_by = CASE WHEN $1 = 'cancelled' THEN $4 ELSE cancelled_by END WHERE id = $2", [status, orderId, status === 'cancelled' ? String(reason).trim() : null, user.id])
        await refreshRequestQuantities(client, current.buy_request_id)
        await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    const statusLabels: Record<string, string> = { accepted: 'прийнято', in_progress: 'у роботі', completed: 'завершено', cancelled: 'скасовано', rejected: 'відхилено', expired: 'закінчено' }
    const counterpart = current.buyer_id === user.id ? current.seller_id : current.buyer_id
    const conversation = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE order_id = $1', [orderId])
    await createNotification(pool, counterpart, 'order', `Замовлення ${statusLabels[status] ?? status}`, `Контрагент змінив статус замовлення на «${statusLabels[status] ?? status}»`, orderId, conversation.rows[0]?.id ?? null)
    return getOrder(user, orderId)
}

const dealFailureReasons = ['SELLER_NOT_AVAILABLE', 'SELLER_CANCELLED', 'BUYER_CANCELLED', 'PRODUCT_UNAVAILABLE', 'PRICE_CHANGED', 'CONDITIONS_CHANGED', 'DELIVERY_PROBLEM', 'SELLER_NOT_RESPONDING', 'BUYER_NOT_RESPONDING', 'PRODUCT_NOT_AS_EXPECTED', 'FOUND_ANOTHER_OPTION', 'OTHER']

const releaseDealReservation = async (client: PoolClient, orderId: string, offerId: string | null) => {
    await client.query('UPDATE products p SET reserved_quantity = reserved_quantity - oi.quantity, updated_at = now() FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id', [orderId])
    if (offerId) await client.query(`UPDATE offers SET accepted_quantity = GREATEST(accepted_quantity - $1, 0),
        status = CASE WHEN accepted_quantity - $1 <= 0 THEN 'submitted' ELSE 'partially_accepted' END, updated_at = now() WHERE id = $2`, [await client.query<{ quantity: string }>('SELECT quantity FROM orders WHERE id = $1', [orderId]).then((result) => Number(result.rows[0].quantity)), offerId])
}

const commitDealProducts = async (client: PoolClient, orderId: string) => {
    await client.query(`UPDATE products p SET quantity = p.quantity - oi.quantity, reserved_quantity = p.reserved_quantity - oi.quantity,
        status = CASE WHEN p.quantity - oi.quantity = 0 THEN 'sold' ELSE p.status END, updated_at = now()
        FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId])
}

export const confirmDeal = async (user: AuthUser, orderId: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])
        const order = result.rows[0]
        if (!order || order.seller_id !== user.id) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        if (order.status !== 'selected') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_NOT_WAITING_FOR_SELLER' } } }
        await client.query("UPDATE orders SET status = 'in_progress', updated_at = now() WHERE id = $1", [orderId])
        await refreshRequestQuantities(client, order.buy_request_id)
        await client.query('COMMIT')
        await createNotification(pool, order.buyer_id, 'order', 'Продавець підтвердив пропозицію', 'Можна домовлятися про обрану кількість', orderId)
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const failDeal = async (user: AuthUser, orderId: string, reason: unknown, comment: unknown) => {
    if (typeof reason !== 'string' || !dealFailureReasons.includes(reason)) return { status: 400, body: { error: 'INVALID_FAILURE_REASON' } }
    if (reason === 'OTHER' && (typeof comment !== 'string' || comment.trim().length < 3 || comment.trim().length > 1000)) return { status: 400, body: { error: 'FAILURE_COMMENT_REQUIRED' } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])
        const order = result.rows[0]
        if (!order || !isOrderParticipant(user.id, order.buyer_id, order.seller_id)) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        if (!['selected', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed'].includes(order.status)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_CANNOT_FAIL' } } }
        const failureReason = reason === 'OTHER' ? `${reason}: ${String(comment).trim()}` : reason
        await releaseDealReservation(client, orderId, order.offer_id)
        await client.query("UPDATE orders SET status = 'failed', failure_reason = $2, cancelled_by = $3, updated_at = now() WHERE id = $1", [orderId, failureReason, user.id])
        await refreshRequestQuantities(client, order.buy_request_id)
        await client.query('COMMIT')
        const counterpart = user.id === order.buyer_id ? order.seller_id : order.buyer_id
        await createNotification(pool, counterpart, 'order', 'Угода не відбулася', 'Кількість знову доступна в запиті', orderId)
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const markDealCompleted = async (user: AuthUser, orderId: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])
        const order = result.rows[0]
        if (!order || !isOrderParticipant(user.id, order.buyer_id, order.seller_id)) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        if (!['in_progress', 'buyer_marked_completed', 'seller_marked_completed'].includes(order.status)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_CANNOT_COMPLETE' } } }
        const byBuyer = user.id === order.buyer_id
        const counterpartMarked = byBuyer ? order.status === 'seller_marked_completed' : order.status === 'buyer_marked_completed'
        if (counterpartMarked) {
            await commitDealProducts(client, orderId)
            await client.query("UPDATE orders SET status = 'completed', buyer_completed_at = COALESCE(buyer_completed_at, now()), seller_completed_at = COALESCE(seller_completed_at, now()), updated_at = now() WHERE id = $1", [orderId])
            await refreshRequestQuantities(client, order.buy_request_id)
        } else {
            await client.query(`UPDATE orders SET status = $2,
                buyer_completed_at = CASE WHEN $2 = 'buyer_marked_completed' THEN now() ELSE buyer_completed_at END,
                seller_completed_at = CASE WHEN $2 = 'seller_marked_completed' THEN now() ELSE seller_completed_at END,
                updated_at = now() WHERE id = $1`, [orderId, byBuyer ? 'buyer_marked_completed' : 'seller_marked_completed'])
        }
        await client.query('COMMIT')
        const counterpart = byBuyer ? order.seller_id : order.buyer_id
        await createNotification(pool, counterpart, 'order', counterpartMarked ? 'Угоду підтверджено' : 'Підтвердьте результат угоди', counterpartMarked ? 'Кількість зараховано до виконаного запиту' : 'Інша сторона повідомила, що угода відбулася', orderId)
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const openDispute = async (user: AuthUser, orderId: string, reason: unknown) => {
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 2000) return { status: 400, body: { error: 'DISPUTE_REASON_REQUIRED', message: 'Опишіть проблему (5–2000 символів)' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (!['accepted', 'in_progress', 'completed'].includes(current.status)) return { status: 409, body: { error: 'DISPUTE_NOT_ALLOWED', from: current.status } }
    if (current.dispute_status === 'open') return { status: 409, body: { error: 'DISPUTE_ALREADY_OPEN' } }
    await pool.query("UPDATE orders SET dispute_status = 'open', dispute_reason = $1, updated_at = now() WHERE id = $2", [reason.trim(), orderId])
    const counterpart = current.buyer_id === user.id ? current.seller_id : current.buyer_id
    const conversation = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE order_id = $1', [orderId])
    await createNotification(pool, counterpart, 'order', 'Відкрито спір', `Контрагент відкрив спір по замовленню: ${reason.trim().slice(0, 160)}`, orderId, conversation.rows[0]?.id ?? null)
    await auditOrder(pool, user.id, 'order.dispute_opened', orderId, String(current.status))
    return getOrder(user, orderId)
}

export const resolveDispute = async (user: AuthUser, orderId: string, outcome: unknown, resolution: unknown) => {
    if (outcome !== 'completed' && outcome !== 'cancelled') return { status: 400, body: { error: 'INVALID_DISPUTE_OUTCOME' } }
    if (typeof resolution !== 'string' || resolution.trim().length < 5 || resolution.trim().length > 2000) return { status: 400, body: { error: 'RESOLUTION_REQUIRED', message: 'Опишіть рішення по спору (5–2000 символів)' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (current.dispute_status !== 'open') return { status: 409, body: { error: 'NO_OPEN_DISPUTE' } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        if (outcome === 'completed') {
            await client.query(`UPDATE products p SET quantity = p.quantity - oi.quantity, reserved_quantity = p.reserved_quantity - oi.quantity,
                status = CASE WHEN p.quantity - oi.quantity = 0 THEN 'sold' ELSE p.status END, updated_at = now()
                FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId])
            await client.query("UPDATE orders SET status = 'completed' WHERE id = $1", [orderId])
        } else {
            await client.query('UPDATE products p SET reserved_quantity = p.reserved_quantity - oi.quantity, updated_at = now() FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id', [orderId])
            await client.query("UPDATE orders SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3 WHERE id = $1", [orderId, `Спір вирішено: ${resolution.trim()}`, user.id])
        }
        await client.query("UPDATE orders SET dispute_status = 'resolved', dispute_resolution = $2, resolved_by = $3, resolved_at = now(), updated_at = now() WHERE id = $1", [orderId, resolution.trim(), user.id])
        await refreshRequestQuantities(client, current.buy_request_id)
        await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    const counterpart = current.buyer_id === user.id ? current.seller_id : current.buyer_id
    const conversation = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE order_id = $1', [orderId])
    await createNotification(pool, counterpart, 'order', 'Спір вирішено', `Рішення: ${resolution.trim().slice(0, 160)}`, orderId, conversation.rows[0]?.id ?? null)
    await auditOrder(pool, user.id, 'order.dispute_resolved', orderId, String(outcome))
    return getOrder(user, orderId)
}

export const getOrderConversation = async (user: AuthUser, orderId: string) => {
    const result = await pool.query(`SELECT c.id, c.order_id, c.created_at, c.updated_at FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        LEFT JOIN orders o ON o.id = $1
        WHERE (c.order_id = $1 OR c.offer_id = o.offer_id) AND cp.user_id = $2`, [orderId, user.id])
    if (!result.rowCount) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    return { status: 200, body: { conversation: result.rows[0] } }
}

const conversationForUser = async (user: AuthUser, conversationId: string) => {
    const result = await pool.query('SELECT c.id FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id WHERE c.id = $1 AND cp.user_id = $2', [conversationId, user.id])
    return Boolean(result.rowCount)
}

export const listMessages = async (user: AuthUser, conversationId: string) => {
    if (!(await conversationForUser(user, conversationId))) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    const result = await pool.query('SELECT m.id, m.conversation_id AS "conversationId", m.sender_id AS "senderId", u.username AS "senderUsername", m.body, m.created_at AS "createdAt" FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = $1 ORDER BY m.created_at, m.id', [conversationId])
    return { status: 200, body: { messages: result.rows } }
}

export const createMessage = async (user: AuthUser, conversationId: string, body: unknown) => {
    if (typeof body !== 'string' || !body.trim() || body.length > 5000) return { status: 400, body: { error: 'INVALID_MESSAGE' } }
    if (!(await conversationForUser(user, conversationId))) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    const counterpart = await pool.query<{ user_id: string }>('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2', [conversationId, user.id])
    for (const participant of counterpart.rows) if (await usersAreBlocked(pool, user.id, participant.user_id)) return { status: 403, body: { error: 'USER_BLOCKED' } }
    const result = await pool.query('INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId", body, created_at AS "createdAt"', [conversationId, user.id, body.trim()])
    const participants = await pool.query<{ user_id: string }>('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2', [conversationId, user.id])
    for (const participant of participants.rows) await createNotification(pool, participant.user_id, 'message', 'Нове повідомлення', body.trim().slice(0, 160), null, conversationId)
    await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])
    return { status: 201, body: { message: result.rows[0] } }
}

export const markConversationRead = async (user: AuthUser, conversationId: string) => {
    const result = await pool.query('UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2 RETURNING last_read_at', [conversationId, user.id])
    return result.rowCount ? { status: 200, body: { readAt: result.rows[0].last_read_at } } : { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
}

// The precise delivery address is intentionally absent from public request DTOs.
// It becomes available only to participants after the offer has created an order.
export const getOrderDeliveryAddress = async (user: AuthUser, orderId: string) => {
    const result = await pool.query<{ delivery_address: string | null }>(`SELECT r.delivery_address
        FROM orders o JOIN buy_requests r ON r.id = o.buy_request_id
        WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2) AND o.status IN ('accepted', 'selected', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed', 'completed')`, [orderId, user.id])
    if (!result.rowCount) return { status: 404, body: { error: 'DELIVERY_ADDRESS_NOT_AVAILABLE' } }
    return { status: 200, body: { deliveryAddress: result.rows[0].delivery_address } }
}

export const getOrCreateOfferConversation = async (user: AuthUser, offerId: string) => {
    const offer = await pool.query<{ buyer_id: string; seller_id: string; status: string }>(`SELECT r.buyer_id, o.seller_id, o.status
        FROM offers o JOIN buy_requests r ON r.id = o.buy_request_id WHERE o.id = $1`, [offerId])
    const row = offer.rows[0]
    if (!row || (row.buyer_id !== user.id && row.seller_id !== user.id)) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
    if (await usersAreBlocked(pool, row.buyer_id, row.seller_id)) return { status: 403, body: { error: 'USER_BLOCKED' } }
    const existing = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE offer_id = $1', [offerId])
    if (existing.rowCount) return { status: 200, body: { conversation: existing.rows[0] } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const again = await client.query<{ id: string }>('SELECT id FROM conversations WHERE offer_id = $1 FOR UPDATE', [offerId])
        if (again.rowCount) { await client.query('COMMIT'); return { status: 200, body: { conversation: again.rows[0] } } }
        const conversation = await client.query<{ id: string }>('INSERT INTO conversations (offer_id) VALUES ($1) RETURNING id', [offerId])
        await client.query(`INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1,$2,'buyer'),($1,$3,'seller')`, [conversation.rows[0].id, row.buyer_id, row.seller_id])
        await client.query('COMMIT')
        return { status: 201, body: { conversation: conversation.rows[0] } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
