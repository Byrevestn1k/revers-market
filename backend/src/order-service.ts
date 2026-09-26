import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { createNotification, audit as auditOrder, usersAreBlocked } from './community-service.js'
import { refreshRequestQuantities } from './request-quantities.js'
import { lockDeal, dealEvent } from './deal-events.js'

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
    workflowVersion: row.workflow_version, offerId: row.offer_id, failureReason: row.failure_reason,
    actualQuantity: row.actual_quantity == null ? null : Number(row.actual_quantity), actualTotal: row.actual_total == null ? null : Number(row.actual_total),
    buyerResult: row.buyer_result, sellerResult: row.seller_result, sellerConfirmedAt: row.seller_confirmed_at,
    buyerCompletedAt: row.buyer_completed_at, sellerCompletedAt: row.seller_completed_at,
    myReviewCreated: row.my_review_created ?? false, counterpartReviewCreated: row.counterpart_review_created ?? false,
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
    await queryable.query("INSERT INTO messages (conversation_id, sender_id, body, kind) VALUES ($1,$2,'Пропозицію обрано. Очікуємо підтвердження продавця.','system')", [conversation.id, buyerId])
    await createNotification(queryable, buyerId, 'order', 'Створено угоду', 'Пропозицію обрано, очікуємо підтвердження продавця', orderId, conversation.id)
    await createNotification(queryable, sellerId, 'order', 'Вашу пропозицію обрали', 'Підтвердьте актуальність обраної кількості', orderId, conversation.id)
    return conversation.id
}

export const listOrders = async (user: AuthUser) => {
    const result = await pool.query(`${orderSelect} WHERE o.buyer_id = $1 OR o.seller_id = $1 ORDER BY o.created_at DESC`, [user.id])
    const reviews = await pool.query('SELECT order_id, reviewer_id FROM reviews WHERE order_id = ANY($1::uuid[])', [result.rows.map(row => row.id)])
    for (const row of result.rows) {
        row.my_review_created = reviews.rows.some(review => review.order_id === row.id && review.reviewer_id === user.id)
        row.counterpart_review_created = reviews.rows.some(review => review.order_id === row.id && review.reviewer_id !== user.id)
    }
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
    if (current.workflow_version >= 2) {
        if (status === 'completed') return markDealCompleted(user, orderId)
        if (status === 'cancelled') return cancelDeal(user, orderId, reason)
    }
    if (status === 'cancelled') {
        if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) return { status: 400, body: { error: 'CANCEL_REASON_REQUIRED', message: 'Вкажіть причину скасування (3–1000 символів)' } }
    } else if (reason !== undefined) return { status: 400, body: { error: 'REASON_NOT_ALLOWED' } }
    if (!canUserTransitionOrder(user.id, current.buyer_id, current.seller_id, current.status, status)) return { status: 409, body: { error: 'INVALID_ORDER_TRANSITION', from: current.status, to: status } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const locked = await lockDeal(client, orderId)
        if (!locked || !canUserTransitionOrder(user.id, locked.buyer_id, locked.seller_id, locked.status, status) || locked.dispute_status === 'open') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'INVALID_ORDER_TRANSITION' } } }
        if (status === 'completed') {
            await client.query(`UPDATE products p SET quantity = p.quantity - oi.quantity, reserved_quantity = p.reserved_quantity - oi.quantity,
                status = CASE WHEN p.quantity - oi.quantity = 0 THEN 'sold' ELSE p.status END, updated_at = now()
                FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId])
        }
        if (status === 'cancelled') {
            await releaseDealReservation(client, orderId, locked.offer_id)
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

const releaseDealReservation = async (client: PoolClient, orderId: string, offerId: string | null, actualQuantity = 0) => {
    const order = (await client.query('SELECT quantity FROM orders WHERE id = $1', [orderId])).rows[0]
    const released = Number(order.quantity) - actualQuantity
    await client.query(`UPDATE products p SET reserved_quantity = p.reserved_quantity - oi.quantity,
        quantity = p.quantity - $2, status = CASE WHEN p.quantity - $2 = 0 THEN 'sold' ELSE p.status END,
        updated_at = now() FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId, actualQuantity])
    if (offerId && released > 0) await client.query(`UPDATE offers SET accepted_quantity = GREATEST(accepted_quantity - $1, 0),
        status = CASE WHEN status IN ('withdrawn','rejected','expired') THEN status
            WHEN accepted_quantity - $1 <= 0 THEN 'submitted' ELSE 'partially_accepted' END,
        updated_at = now() WHERE id = $2`, [released, offerId])
}

export const confirmDeal = async (user: AuthUser, orderId: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const order = await lockDeal(client, orderId)
        if (!order || order.seller_id !== user.id) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        if (order.seller_confirmed_at || order.status === 'in_progress') { await client.query('COMMIT'); return getOrder(user, orderId) }
        if (order.status !== 'selected') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_NOT_WAITING_FOR_SELLER' } } }
        await client.query("UPDATE orders SET status = 'in_progress', seller_confirmed_at = now(), updated_at = now() WHERE id = $1", [orderId])
        await dealEvent(client, order, user.id, 'SELLER_CONFIRMED', 'Домовленість підтверджена', `${order.quantity} ${order.unit} × ${order.unit_price} ${order.currency}. Узгодьте передачу товару.`)
        await client.query('COMMIT')
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const cancelDeal = async (user: AuthUser, orderId: string, reason: unknown) => {
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) return { status: 400, body: { error: 'CANCEL_REASON_REQUIRED', message: 'Вкажіть причину (3–1000 символів)' } }
    return finishUnsuccessful(user, orderId, reason.trim(), true)
}

export const failDeal = async (user: AuthUser, orderId: string, reason: unknown, comment: unknown) => {
    if (typeof reason !== 'string' || !dealFailureReasons.includes(reason)) return { status: 400, body: { error: 'INVALID_FAILURE_REASON' } }
    if (comment != null && (typeof comment !== 'string' || comment.length > 800)) return { status: 400, body: { error: 'INVALID_FAILURE_COMMENT' } }
    if (reason === 'OTHER' && (typeof comment !== 'string' || comment.trim().length < 3)) return { status: 400, body: { error: 'FAILURE_COMMENT_REQUIRED' } }
    return finishUnsuccessful(user, orderId, `${reason}${comment ? ': ' + String(comment).trim() : ''}`, false)
}

const finishUnsuccessful = async (user: AuthUser, orderId: string, reason: string, cancel: boolean) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const order = await lockDeal(client, orderId)
        if (!order || !isOrderParticipant(user.id, order.buyer_id, order.seller_id)) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        if (['failed','cancelled','rejected'].includes(order.status) && order.cancelled_by === user.id) { await client.query('COMMIT'); return getOrder(user, orderId) }
        if (!['selected','accepted','in_progress','buyer_marked_completed','seller_marked_completed'].includes(order.status)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_CANNOT_FAIL' } } }
        const byBuyer = user.id === order.buyer_id
        const otherResult = byBuyer ? order.seller_result : order.buyer_result
        const disagreement = otherResult?.outcome === 'completed' || (byBuyer ? order.seller_completed_at : order.buyer_completed_at)
        const status = disagreement ? 'disputed' : cancel ? 'cancelled' : order.status === 'selected' && !byBuyer ? 'rejected' : 'failed'
        if (!disagreement) await releaseDealReservation(client, orderId, order.offer_id)
        await client.query(`UPDATE orders SET status = $2, failure_reason = $3, cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END,
            cancelled_by = $4, ${byBuyer ? 'buyer_result' : 'seller_result'} = $5,
            dispute_status = CASE WHEN $2 = 'disputed' THEN 'open' ELSE dispute_status END,
            dispute_reason = CASE WHEN $2 = 'disputed' THEN 'Сторони по-різному вказали результат угоди' ELSE dispute_reason END,
            updated_at = now() WHERE id = $1`, [orderId, status, reason, user.id, JSON.stringify({ outcome: 'failed', reason })])
        await refreshRequestQuantities(client, order.buy_request_id)
        const title = disagreement ? 'Результати сторін відрізняються' : status === 'rejected' ? 'Продавець відмовився від домовленості' : cancel ? 'Домовленість скасовано' : 'Угода не відбулася'
        await dealEvent(client, order, user.id, disagreement ? 'RESULT_DISAGREEMENT' : cancel ? 'ORDER_CANCELLED' : status === 'rejected' ? 'SELLER_REJECTED' : 'ORDER_FAILED', title, disagreement ? 'Обидві відповіді збережено. Обговоріть результат у чаті.' : 'Кількість знову доступна для вибору пропозицій.')
        await client.query('COMMIT')
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const markDealCompleted = async (user: AuthUser, orderId: string, input: Record<string, unknown> = {}) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const order = await lockDeal(client, orderId)
        if (!order || !isOrderParticipant(user.id, order.buyer_id, order.seller_id)) { await client.query('ROLLBACK'); return { status: order ? 403 : 404, body: { error: order ? 'FORBIDDEN' : 'ORDER_NOT_FOUND' } } }
        const byBuyer = user.id === order.buyer_id
        if (order.status === 'completed' || (byBuyer ? order.buyer_result : order.seller_result)?.outcome === 'completed') { await client.query('COMMIT'); return getOrder(user, orderId) }
        if (!['in_progress','buyer_marked_completed','seller_marked_completed'].includes(order.status) || order.dispute_status === 'open') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'DEAL_CANNOT_COMPLETE' } } }
        const otherResult = byBuyer ? order.seller_result : order.buyer_result
        const quantity = input.actualQuantity ?? otherResult?.quantity ?? Number(order.quantity)
        const total = input.actualTotal ?? otherResult?.total ?? Number(order.subtotal)
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number(order.quantity) || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001 || typeof total !== 'number' || !Number.isFinite(total) || total < 0 || total > 1e12 || (input.comment !== undefined && (typeof input.comment !== 'string' || input.comment.length > 1000))) {
            await client.query('ROLLBACK'); return { status: 400, body: { error: 'INVALID_ACTUAL_RESULT', message: 'Перевірте фактичну кількість та суму. Кількість не може перевищувати домовлену.' } }
        }
        const counterpartMarked = Boolean(otherResult) || (byBuyer ? order.status === 'seller_marked_completed' : order.status === 'buyer_marked_completed')
        const disagreement = counterpartMarked && otherResult && (otherResult.quantity !== quantity || otherResult.total !== total)
        const status = disagreement ? 'disputed' : counterpartMarked ? 'completed' : byBuyer ? 'buyer_marked_completed' : 'seller_marked_completed'
        const result = { outcome: 'completed', quantity, total, comment: input.comment ?? '' }
        if (status === 'completed') await releaseDealReservation(client, orderId, order.offer_id, quantity)
        await client.query(`UPDATE orders SET status = $2, ${byBuyer ? 'buyer_result' : 'seller_result'} = $3,
            ${byBuyer ? 'buyer_completed_at' : 'seller_completed_at'} = now(),
            actual_quantity = CASE WHEN $2 = 'completed' THEN $4 ELSE actual_quantity END,
            actual_total = CASE WHEN $2 = 'completed' THEN $5 ELSE actual_total END,
            dispute_status = CASE WHEN $2 = 'disputed' THEN 'open' ELSE dispute_status END,
            dispute_reason = CASE WHEN $2 = 'disputed' THEN 'Сторони по-різному вказали результат угоди' ELSE dispute_reason END,
            updated_at = now() WHERE id = $1`, [orderId, status, JSON.stringify(result), quantity, total])
        await refreshRequestQuantities(client, order.buy_request_id)
        await dealEvent(client, order, user.id, disagreement ? 'RESULT_DISAGREEMENT' : counterpartMarked ? 'ORDER_COMPLETED_CONFIRMED' : 'ORDER_MARKED_COMPLETED',
            disagreement ? 'Результати сторін відрізняються' : counterpartMarked ? 'Угоду підтверджено обома сторонами' : 'Підтвердьте результат угоди',
            disagreement ? 'Обговоріть фактичну кількість та суму в чаті.' : `${quantity} ${order.unit}, ${total} ${order.currency}. ${counterpartMarked ? 'Тепер можна залишити відгук.' : 'Інша сторона повідомила про отримання товару.'}`)
        if (status === 'completed') await createNotification(client, user.id, 'review', 'Можна залишити відгук', 'Оцініть спілкування та виконання домовленості', orderId)
        await client.query('COMMIT')
        return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const openDispute = async (user: AuthUser, orderId: string, reason: unknown) => {
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 2000) return { status: 400, body: { error: 'DISPUTE_REASON_REQUIRED', message: 'Опишіть проблему (5–2000 символів)' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (!['accepted', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed', 'completed'].includes(current.status)) return { status: 409, body: { error: 'DISPUTE_NOT_ALLOWED', from: current.status } }
    if (current.dispute_status === 'open') return { status: 409, body: { error: 'DISPUTE_ALREADY_OPEN' } }
    const changed = await pool.query("UPDATE orders SET dispute_status = 'open', dispute_reason = $1, updated_at = now() WHERE id = $2 AND status IN ('accepted','in_progress','buyer_marked_completed','seller_marked_completed','completed') AND dispute_status IS DISTINCT FROM 'open' RETURNING id", [reason.trim(), orderId])
    if (!changed.rowCount) return { status: 409, body: { error: 'DISPUTE_NOT_ALLOWED' } }
    const counterpart = current.buyer_id === user.id ? current.seller_id : current.buyer_id
    const conversation = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE order_id = $1', [orderId])
    await createNotification(pool, counterpart, 'order', 'Відкрито спір', `Контрагент відкрив спір по замовленню: ${reason.trim().slice(0, 160)}`, orderId, conversation.rows[0]?.id ?? null)
    await auditOrder(pool, user.id, 'order.dispute_opened', 'order', orderId, { status: current.status })
    return getOrder(user, orderId)
}

export const resolveDispute = async (user: AuthUser, orderId: string, outcome: unknown, resolution: unknown) => {
    if (outcome !== 'completed' && outcome !== 'cancelled') return { status: 400, body: { error: 'INVALID_DISPUTE_OUTCOME' } }
    if (typeof resolution !== 'string' || resolution.trim().length < 5 || resolution.trim().length > 2000) return { status: 400, body: { error: 'RESOLUTION_REQUIRED', message: 'Опишіть рішення по спору (5–2000 символів)' } }
    const current = await findOrder(pool, orderId, user.id)
    if (!current) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (current.dispute_status !== 'open') return { status: 409, body: { error: 'NO_OPEN_DISPUTE' } }
    if (current.workflow_version >= 2) return resolveCurrentDealDispute(user, orderId, outcome, resolution.trim())
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const locked = await lockDeal(client, orderId)
        if (!locked || locked.dispute_status !== 'open') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'NO_OPEN_DISPUTE' } } }
        if (outcome === 'completed') {
            if (locked.status !== 'completed') {
            await client.query(`UPDATE products p SET quantity = p.quantity - oi.quantity, reserved_quantity = p.reserved_quantity - oi.quantity,
                status = CASE WHEN p.quantity - oi.quantity = 0 THEN 'sold' ELSE p.status END, updated_at = now()
                FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [orderId])
            }
            await client.query("UPDATE orders SET status = 'completed' WHERE id = $1", [orderId])
        } else {
            if (locked.status !== 'completed') await releaseDealReservation(client, orderId, locked.offer_id)
            await client.query("UPDATE orders SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3 WHERE id = $1", [orderId, `Спір вирішено: ${resolution.trim()}`, user.id])
        }
        await client.query("UPDATE orders SET dispute_status = 'resolved', dispute_resolution = $2, resolved_by = $3, resolved_at = now(), updated_at = now() WHERE id = $1", [orderId, resolution.trim(), user.id])
        await refreshRequestQuantities(client, current.buy_request_id)
        await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    const counterpart = current.buyer_id === user.id ? current.seller_id : current.buyer_id
    const conversation = await pool.query<{ id: string }>('SELECT id FROM conversations WHERE order_id = $1', [orderId])
    await createNotification(pool, counterpart, 'order', 'Спір вирішено', `Рішення: ${resolution.trim().slice(0, 160)}`, orderId, conversation.rows[0]?.id ?? null)
    await auditOrder(pool, user.id, 'order.dispute_resolved', 'order', orderId, { outcome })
    return getOrder(user, orderId)
}

const resolveCurrentDealDispute = async (user: AuthUser, orderId: string, outcome: string, resolution: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const order = await lockDeal(client, orderId)
        if (!order || !isOrderParticipant(user.id, order.buyer_id, order.seller_id)) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'FORBIDDEN' } } }
        if (order.dispute_status !== 'open') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'NO_OPEN_DISPUTE' } } }
        const byBuyer = user.id === order.buyer_id
        const mine = byBuyer ? order.buyer_result : order.seller_result
        const other = byBuyer ? order.seller_result : order.buyer_result
        const result = { ...mine, resolutionOutcome: outcome, resolutionComment: resolution }
        await client.query(`UPDATE orders SET ${byBuyer ? 'buyer_result' : 'seller_result'} = $2 WHERE id = $1`, [orderId, JSON.stringify(result)])
        if (other?.resolutionOutcome !== outcome) {
            await dealEvent(client, order, user.id, 'DISPUTE_RESOLUTION_PROPOSED', 'Запропоновано узгодити результат', 'Потрібне підтвердження іншої сторони. Обговоріть умови в чаті.')
            await client.query('COMMIT'); return getOrder(user, orderId)
        }
        const completedResult = order.buyer_result?.outcome === 'completed' ? order.buyer_result : order.seller_result?.outcome === 'completed' ? order.seller_result : null
        const quantity = completedResult?.quantity ?? Number(order.quantity)
        const total = completedResult?.total ?? Number(order.subtotal)
        // A post-completion dispute must never commit or release stock twice.
        if (order.status !== 'completed') await releaseDealReservation(client, orderId, order.offer_id, outcome === 'completed' ? quantity : 0)
        await client.query(`UPDATE orders SET status = $2, dispute_status = 'resolved', dispute_resolution = $3,
            resolved_by = $4, resolved_at = now(), updated_at = now(),
            actual_quantity = CASE WHEN $2 = 'completed' THEN $5 ELSE actual_quantity END,
            actual_total = CASE WHEN $2 = 'completed' THEN $6 ELSE actual_total END,
            buyer_completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(buyer_completed_at, now()) ELSE buyer_completed_at END,
            seller_completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(seller_completed_at, now()) ELSE seller_completed_at END
            WHERE id = $1`, [orderId, outcome, resolution, user.id, quantity, total])
        await refreshRequestQuantities(client, order.buy_request_id)
        await dealEvent(client, order, user.id, 'DISPUTE_RESOLVED', 'Результат узгоджено обома сторонами', outcome === 'completed' ? 'Угоду завершено. Можна залишити відгук.' : 'Домовленість скасовано.')
        await client.query('COMMIT'); return getOrder(user, orderId)
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const getOrderConversation = async (user: AuthUser, orderId: string) => {
    const result = await pool.query(`SELECT c.id, c.order_id, c.created_at, c.updated_at FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        LEFT JOIN orders o ON o.id = $1
        WHERE (c.order_id = $1 OR c.offer_id = o.offer_id) AND cp.user_id = $2`, [orderId, user.id])
    if (!result.rowCount) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    return { status: 200, body: { conversation: result.rows[0] } }
}

export const getOrderContact = async (user: AuthUser, orderId: string) => {
    const order = await findOrder(pool, orderId, user.id)
    if (!order) return { status: 404, body: { error: 'ORDER_NOT_FOUND' } }
    if (!['accepted','in_progress','buyer_marked_completed','seller_marked_completed','completed','disputed'].includes(order.status)) return { status: 409, body: { error: 'CONTACT_NOT_AVAILABLE', message: 'Контакти доступні після підтвердження домовленості.' } }
    const counterpart = order.buyer_id === user.id ? order.seller_id : order.buyer_id
    const profile = (await pool.query('SELECT phone, phone_visibility, phone_disclosure_consent FROM users WHERE id=$1', [counterpart])).rows[0]
    const phone = profile?.phone_disclosure_consent && profile.phone_visibility !== 'private' ? profile.phone : null
    if (phone) await auditOrder(pool, user.id, 'CONTACT_REVEALED', 'order', orderId)
    return { status: 200, body: { phone, message: phone ? null : 'Користувач не дозволив показувати телефон. Напишіть у чаті.' } }
}

const conversationForUser = async (user: AuthUser, conversationId: string) => {
    const result = await pool.query('SELECT c.id FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id WHERE c.id = $1 AND cp.user_id = $2', [conversationId, user.id])
    return Boolean(result.rowCount)
}

export const listMessages = async (user: AuthUser, conversationId: string) => {
    if (!(await conversationForUser(user, conversationId))) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    const result = await pool.query('SELECT m.id, m.kind, m.conversation_id AS "conversationId", m.sender_id AS "senderId", u.username AS "senderUsername", u.avatar_url AS "senderAvatarUrl", m.body, m.created_at AS "createdAt" FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = $1 ORDER BY m.created_at, m.id', [conversationId])
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
        await client.query('SELECT id FROM offers WHERE id = $1 FOR UPDATE', [offerId])
        const again = await client.query<{ id: string }>('SELECT id FROM conversations WHERE offer_id = $1 FOR UPDATE', [offerId])
        if (again.rowCount) { await client.query('COMMIT'); return { status: 200, body: { conversation: again.rows[0] } } }
        const conversation = await client.query<{ id: string }>('INSERT INTO conversations (offer_id) VALUES ($1) RETURNING id', [offerId])
        await client.query(`INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1,$2,'buyer'),($1,$3,'seller')`, [conversation.rows[0].id, row.buyer_id, row.seller_id])
        await auditOrder(client, user.id, 'CONVERSATION_STARTED', 'offer', offerId)
        await client.query('COMMIT')
        return { status: 201, body: { conversation: conversation.rows[0] } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const getOrCreateListingConversation = async (user: AuthUser, listingType: 'product' | 'buy-request', listingId: string) => {
    const isProduct = listingType === 'product'
    const listing = isProduct
        ? await pool.query<{ owner_id: string; title: string }>("SELECT owner_id, title FROM products WHERE id = $1 AND status = 'active'", [listingId])
        : await pool.query<{ owner_id: string; title: string }>("SELECT buyer_id AS owner_id, title FROM buy_requests WHERE id = $1 AND status IN ('open','partially_selected','partially_completed','partially_fulfilled')", [listingId])
    const row = listing.rows[0]
    if (!row || row.owner_id === user.id) return { status: 404, body: { error: 'LISTING_NOT_AVAILABLE' } }
    if (await usersAreBlocked(pool, user.id, row.owner_id)) return { status: 403, body: { error: 'USER_BLOCKED' } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const locked = isProduct
            ? await client.query("SELECT owner_id, title FROM products WHERE id = $1 AND status = 'active' FOR UPDATE", [listingId])
            : await client.query("SELECT buyer_id AS owner_id, title FROM buy_requests WHERE id = $1 AND status IN ('open','partially_selected','partially_completed','partially_fulfilled') FOR UPDATE", [listingId])
        const owner = locked.rows[0]
        if (!owner || owner.owner_id === user.id) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'LISTING_NOT_AVAILABLE' } } }
        const reference = isProduct ? 'c.product_id' : 'c.buy_request_id'
        const existing = await client.query<{ id: string }>(`SELECT c.id FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $2
            WHERE ${reference} = $1 LIMIT 1 FOR UPDATE`, [listingId, user.id])
        if (existing.rowCount) { await client.query('COMMIT'); return { status: 200, body: { conversation: existing.rows[0] } } }
        const conversation = await client.query<{ id: string }>(`INSERT INTO conversations (${isProduct ? 'product_id' : 'buy_request_id'}) VALUES ($1) RETURNING id`, [listingId])
        const buyerId = isProduct ? user.id : owner.owner_id
        const sellerId = isProduct ? owner.owner_id : user.id
        await client.query("INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1,$2,'buyer'),($1,$3,'seller')", [conversation.rows[0].id, buyerId, sellerId])
        await auditOrder(client, user.id, 'CONVERSATION_STARTED', listingType, listingId)
        await createNotification(client, owner.owner_id, 'message', 'Розпочато обговорення', `Користувач відкрив чат щодо «${owner.title.slice(0, 120)}»`, null, conversation.rows[0].id)
        await client.query('COMMIT')
        return { status: 201, body: { conversation: conversation.rows[0] } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
