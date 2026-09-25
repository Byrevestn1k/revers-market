import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { audit, createNotification, usersAreBlocked } from './community-service.js'

const openStatuses = ['open', 'partially_selected', 'partially_completed', 'partially_fulfilled']
export const negotiationDto = (row: any) => ({ id: row.id, createdBy: row.created_by, parentId: row.parent_id,
    price: Number(row.unit_price), quantity: Number(row.quantity), delivery: row.delivery,
    deliveryPrice: Number(row.delivery_price), comment: row.comment, status: row.status, createdAt: row.created_at })

export const getConversationContext = async (user: AuthUser, id: string) => {
    const row = (await pool.query(`SELECT c.offer_id, o.*, r.title, r.buyer_id, r.status AS request_status,
        r.requested_quantity - r.selected_quantity - r.completed_quantity AS remaining,
        r.fulfillment_mode, r.deadline, r.selected_quantity
        FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $2
        LEFT JOIN offers o ON o.id = c.offer_id LEFT JOIN buy_requests r ON r.id = o.buy_request_id WHERE c.id = $1`, [id, user.id])).rows[0]
    if (!row) return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } }
    if (!row.offer_id) return { status: 200, body: { context: null, proposals: [] } }
    const proposals = await pool.query('SELECT * FROM negotiation_proposals WHERE conversation_id = $1 ORDER BY created_at, id', [id])
    const available = openStatuses.includes(row.request_status) && ['submitted','partially_accepted'].includes(row.status)
        && (!row.valid_until || row.valid_until > new Date()) && (!row.deadline || row.deadline > new Date())
    return { status: 200, body: { context: {
        offerId: row.offer_id, requestId: row.buy_request_id, title: row.title, buyerId: row.buyer_id,
        sellerId: row.seller_id, unit: row.unit, currency: row.currency, price: Number(row.unit_price),
        quantity: Number(row.offered_quantity) - Number(row.accepted_quantity), remaining: Number(row.remaining),
        delivery: row.delivery, deliveryPrice: Number(row.delivery_terms?.price ?? 0), fulfillmentMode: row.fulfillment_mode, available,
    }, proposals: proposals.rows.map(proposal => negotiationDto(!available && proposal.status === 'pending' ? { ...proposal, status: 'expired' } : proposal)) } }
}

export const changeNegotiation = async (user: AuthUser, conversationId: string, input: Record<string, unknown>) => {
    const action = input.action ?? 'propose'
    if (!['propose','accept','reject','withdraw'].includes(String(action))) return { status: 400, body: { error: 'INVALID_NEGOTIATION_ACTION' } }
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const linked = (await client.query(`SELECT o.id, o.buy_request_id FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $2
            JOIN offers o ON o.id = c.offer_id WHERE c.id = $1`, [conversationId, user.id])).rows[0]
        if (!linked) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'CONVERSATION_NOT_FOUND' } } }
        const request = (await client.query('SELECT * FROM buy_requests WHERE id = $1 FOR UPDATE', [linked.buy_request_id])).rows[0]
        const offer = (await client.query('SELECT * FROM offers WHERE id = $1 FOR UPDATE', [linked.id])).rows[0]
        if (await usersAreBlocked(client, request.buyer_id, offer.seller_id)) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'USER_BLOCKED' } } }
        if (!openStatuses.includes(request.status) || !['submitted','partially_accepted'].includes(offer.status) || (offer.valid_until && offer.valid_until <= new Date()) || (request.deadline && request.deadline <= new Date())) {
            await client.query("UPDATE negotiation_proposals SET status = 'expired', responded_at = now() WHERE offer_id = $1 AND status = 'pending'", [offer.id])
            await client.query('COMMIT'); return { status: 409, body: { error: 'NEGOTIATION_EXPIRED', message: 'Пропозиція вже неактуальна або запит закрито.' } }
        }
        const latest = (await client.query('SELECT * FROM negotiation_proposals WHERE offer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [offer.id])).rows[0]
        let proposal
        let event: string
        let title: string
        if (action === 'propose') {
            if ((input.parentId ?? null) !== (latest?.id ?? null)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'NEGOTIATION_CHANGED', message: 'Умови вже змінилися. Перегляньте останню пропозицію.' } } }
            const price = input.price ?? latest?.unit_price ?? offer.unit_price
            const quantity = input.quantity ?? latest?.quantity ?? Math.min(Number(offer.offered_quantity) - Number(offer.accepted_quantity), Number(request.requested_quantity) - Number(request.selected_quantity) - Number(request.completed_quantity))
            const delivery = input.delivery ?? latest?.delivery ?? offer.delivery
            const deliveryPrice = input.deliveryPrice ?? latest?.delivery_price ?? offer.delivery_terms?.price ?? 0
            if ((input.price !== undefined && typeof input.price !== 'number') || (input.quantity !== undefined && typeof input.quantity !== 'number') || (input.deliveryPrice !== undefined && typeof input.deliveryPrice !== 'number') || !Number.isFinite(Number(price)) || Number(price) < 0 || Number(price) > 1e12 || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > Number(offer.offered_quantity) - Number(offer.accepted_quantity) || Number(quantity) > Number(request.requested_quantity) - Number(request.selected_quantity) - Number(request.completed_quantity) || Math.abs(Number(quantity) * 1000 - Math.round(Number(quantity) * 1000)) > 0.00001 || !Number.isFinite(Number(deliveryPrice)) || Number(deliveryPrice) < 0 || Number(deliveryPrice) > 1e12 || typeof delivery !== 'string' || !delivery.trim() || delivery.length > 160 || (input.comment !== undefined && (typeof input.comment !== 'string' || input.comment.length > 1000))) {
                await client.query('ROLLBACK'); return { status: 400, body: { error: 'INVALID_NEGOTIATION_TERMS', message: 'Перевірте ціну, кількість і доставку. Кількість має бути в межах доступного залишку.' } }
            }
            await client.query("UPDATE negotiation_proposals SET status = 'countered', responded_at = now() WHERE offer_id = $1 AND status = 'pending'", [offer.id])
            proposal = (await client.query(`INSERT INTO negotiation_proposals (conversation_id,offer_id,created_by,parent_id,unit_price,quantity,delivery,delivery_price,comment)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [conversationId, offer.id, user.id, latest?.id ?? null, price, quantity, delivery.trim(), deliveryPrice, input.comment ?? ''])).rows[0]
            event = latest ? 'NEGOTIATION_COUNTERED' : 'NEGOTIATION_STARTED'
            title = 'Запропоновано нові умови'
        } else {
            if (!latest || latest.id !== input.proposalId || latest.status !== 'pending') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'NEGOTIATION_CHANGED', message: 'Ці умови вже неактуальні.' } } }
            if ((action === 'withdraw') !== (latest.created_by === user.id)) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'FORBIDDEN' } } }
            if (action === 'accept' && (Number(latest.quantity) > Number(offer.offered_quantity) - Number(offer.accepted_quantity) || Number(latest.quantity) > Number(request.requested_quantity) - Number(request.selected_quantity) - Number(request.completed_quantity))) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'QUANTITY_EXCEEDS_REMAINING', message: 'Доступна кількість змінилася. Запропонуйте актуальний обсяг.' } } }
            const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'withdrawn'
            proposal = (await client.query('UPDATE negotiation_proposals SET status = $2, responded_at = now() WHERE id = $1 RETURNING *', [latest.id, status])).rows[0]
            event = `NEGOTIATION_${status.toUpperCase()}`
            title = action === 'accept' ? 'Умови погоджено. Покупець може обрати пропозицію' : action === 'reject' ? 'Умови відхилено' : 'Умови відкликано'
        }
        await audit(client, user.id, event, 'offer', offer.id, { proposalId: proposal.id, requestId: request.id })
        await createNotification(client, user.id === request.buyer_id ? offer.seller_id : request.buyer_id, 'order', title, 'Перегляньте умови в чаті', null, conversationId)
        await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])
        await client.query('COMMIT')
        return { status: 200, body: { proposal: negotiationDto(proposal) } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
