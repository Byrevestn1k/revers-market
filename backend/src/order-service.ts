import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'

type Queryable = Pick<PoolClient, 'query'>
export const orderStatuses = ['draft', 'active', 'offer_received', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected', 'expired'] as const
export type OrderStatus = typeof orderStatuses[number]
export const isOrderParticipant = (userId: string, buyerId: string, sellerId: string) => userId === buyerId || userId === sellerId

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
    draft: ['active', 'cancelled', 'expired'],
    active: ['offer_received', 'cancelled', 'expired'],
    offer_received: ['accepted', 'rejected', 'cancelled', 'expired'],
    accepted: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [], rejected: [], cancelled: [], expired: [],
}

export const canTransitionOrder = (from: string, to: string) => orderStatuses.includes(from as OrderStatus) && transitions[from as OrderStatus].includes(to as OrderStatus)

const orderSelect = `SELECT o.*, r.title AS request_title, bu.username AS buyer_username, su.username AS seller_username
    FROM orders o JOIN buy_requests r ON r.id = o.buy_request_id
    JOIN users bu ON bu.id = o.buyer_id JOIN users su ON su.id = o.seller_id`

const orderDto = (row: any) => ({
    id: row.id, buyRequestId: row.buy_request_id,
    buyer: { id: row.buyer_id, username: row.buyer_username }, seller: { id: row.seller_id, username: row.seller_username },
    quantity: row.quantity === null ? null : Number(row.quantity), unit: row.unit, price: { unit: row.unit_price === null ? null : Number(row.unit_price), currency: row.currency },
    subtotal: Number(row.subtotal), conditionsSnapshot: row.conditions_snapshot, status: row.status,
    acceptedAt: row.accepted_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
})

const findOrder = async (queryable: Queryable, orderId: string, userId: string) => {
    const result = await queryable.query(`${orderSelect} WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)`, [orderId, userId])
    return result.rows[0]
}

export const createOrderConversation = async (queryable: Queryable, orderId: string, buyerId: string, sellerId: string) => {
    const conversation = await queryable.query<{ id: string }>('INSERT INTO conversations (order_id) VALUES ($1) RETURNING id', [orderId])
    await queryable.query('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)', [conversation.rows[0].id, buyerId, 'buyer', sellerId, 'seller'])
    return conversation.rows[0].id
}

export const listOrders = async (user: AuthUser) => {
    const result = await pool.query(`${orderSelect} WHERE o.buyer_id = $1 OR o.seller_id = $1 ORDER BY o.created_at DESC`, [user.id])
    return { status: 200, body: { orders: result.rows.map(orderDto) } }
}

export const getOrder = async (user: AuthUser, orderId: string) => {
    const row = await findOrder(pool, orderId, user.id)
    return row ? { status: 200, body: { order: orderDto(row) } } : { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
}

export const updateOrderStatus = async (user: AuthUser, orderId: string, status: unknown) => {
    if (typeof status !== 'string' || !orderStatuses.includes(status as OrderStatus)) return { status: 400, body: { error: 'INVALID_ORDER_STATUS' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (!canTransitionOrder(current.status, status)) return { status: 409, body: { error: 'INVALID_ORDER_TRANSITION', from: current.status, to: status } }
    await pool.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, orderId])
    return getOrder(user, orderId)
}

export const getOrderConversation = async (user: AuthUser, orderId: string) => {
    const result = await pool.query(`SELECT c.id, c.order_id, c.created_at, c.updated_at FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id WHERE c.order_id = $1 AND cp.user_id = $2`, [orderId, user.id])
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
    const result = await pool.query('INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId", body, created_at AS "createdAt"', [conversationId, user.id, body.trim()])
    await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])
    return { status: 201, body: { message: result.rows[0] } }
}

export const markConversationRead = async (user: AuthUser, conversationId: string) => {
    const result = await pool.query('UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2 RETURNING last_read_at', [conversationId, user.id])
    return result.rowCount ? { status: 200, body: { readAt: result.rows[0].last_read_at } } : { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
}